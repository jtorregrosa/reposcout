import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { toPosix } from '../claude/settings.js';
import type { StreamTracker } from '../claude/stream.js';
import { type Analyzer, isAnalyzer } from '../config/analyzers.js';
import { type RepoConfig, remoteUrl } from '../config/config.js';
import { CancelledError } from '../errors.js';
import { classify } from '../findings/classify.js';
import { FINGERPRINT_VERSION } from '../findings/fingerprint.js';
import { migrateFingerprints } from '../findings/migrate.js';
import { processFindings } from '../findings/process.js';
import { speculativeVerdicts } from '../findings/speculative.js';
import { applyValidation, type ValidationCandidate } from '../findings/validation.js';
import { writeJson } from '../fs.js';
import { authHeaderFor, type Git, gitEnv, prepareClone, writeDiff } from '../git/git.js';
import { writeReportSarif } from '../report/sarif-file.js';
import { REPORT_SCHEMA, type ReadCoverage, type RepoReport } from '../report/types.js';
import { readOptionalPat, readPat } from '../security/env.js';
import { verificationFor } from '../security/sandbox.js';
import { redactDeep } from '../security/secrets.js';
import { type Candidate, selectFiles } from '../selection/select.js';
import { auditedByAnalyzer, auditsByAnalyzer, lastAuditedFor, recordAudits, unreadOnceByAnalyzer } from '../state/coverage.js';
import type { RepoState } from '../state/types.js';
import type { Store } from '../store/index.js';
import type { AuditOptions, RepoOutcome, RunContext } from './context.js';
import { buildManifest, knownFalsePositives, knownFindings } from './manifest.js';
import { planAudit } from './plan.js';
import { runAuditSession } from './session.js';
import { analyzerYield, normalizeDiscards } from './specialists.js';

const MAX_DIFF_BYTES = 600_000;

// specialist_candidates as the orchestrator wrote it: an object of counts, or nothing usable.
const isPlainCounts = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

const suppressionsOf = (repo: RepoConfig) => new Map(repo.suppressed.map((s) => [s.fingerprint, s.reason.trim()]));
const refutedByAuditorIn = (store: Store, repo: string) =>
  new Set([...store.decisionsFor(repo)].filter(([, d]) => d.decided_on === 'open' && d.verdict === 'refuted').map(([fp]) => fp));

export function scmAuthHeader(repo: RepoConfig): string | null {
  if (repo.provider === 'local') return null;
  if (repo.provider === 'github') {
    const pat = readOptionalPat(repo.pat_env);
    return pat ? authHeaderFor({ pat, user: 'x-access-token' }) : null;
  }
  // Phase 2: the pipeline maps System.AccessToken into REPOSCOUT_ADO_BEARER instead of providing a PAT.
  if (process.env.REPOSCOUT_ADO_BEARER) return authHeaderFor({ bearer: process.env.REPOSCOUT_ADO_BEARER });
  return authHeaderFor({ pat: readPat(repo.pat_env) });
}

const advanceCommits = (lastByAnalyzer: RepoState['last_commit_by_analyzer'], analyzers: readonly Analyzer[], head: string) => ({
  ...lastByAnalyzer,
  ...Object.fromEntries(analyzers.map((a) => [a, head])),
});

// Which files each specialist type opened, relative to the clone: a file assigned but never read was not audited.
// What the verifier or the orchestrator opened audits nothing for a specialist.
function readsByAnalyzer(tracker: StreamTracker, cloneDir: string) {
  const cloneRoot = `${toPosix(cloneDir).toLowerCase()}/`;
  const relative = (p: string) => {
    const posix = toPosix(p);
    return posix.toLowerCase().startsWith(cloneRoot) ? posix.slice(cloneRoot.length) : null;
  };
  const byCategory = new Map<string, Set<string>>();
  const bySpecialist = new Set<string>();
  const any = new Set<string>();
  for (const [agent, paths] of tracker.reads) {
    const rel = [...paths].map(relative).filter((p): p is string => !!p);
    for (const p of rel) any.add(p);
    if (!isAnalyzer(agent)) continue;
    for (const p of rel) bySpecialist.add(p);
    byCategory.set(agent, new Set([...(byCategory.get(agent) ?? []), ...rel]));
  }
  return { byCategory, bySpecialist, any };
}

export async function auditRepo({ repo, opts, ctx }: { repo: RepoConfig; opts: AuditOptions; ctx: RunContext }): Promise<RepoOutcome> {
  const { layout, log, events, runId } = ctx;
  const runAt = new Date().toISOString();
  // Every status a finding reaches in this run is recorded against the run and its start.
  const written = { runId, at: runAt };
  const stored = ctx.store.readRepoState(repo.name);
  const cloneDir = join(layout.workspaceDir, repo.name);
  // Per run, so several runs on the same day never overwrite each other's manifest, diff or raw findings.
  const workDir = join(ctx.dateDir, '.work', runId, repo.name);
  rmSync(workDir, { recursive: true, force: true });
  mkdirSync(workDir, { recursive: true });

  const hooksDir = join(layout.workspaceDir, '.no-hooks');
  mkdirSync(hooksDir, { recursive: true });
  const env = gitEnv({ authHeader: scmAuthHeader(repo), hooksDir, allowFileProtocol: repo.provider === 'local' });

  const { git, head } = prepareClone({ dir: cloneDir, url: remoteUrl(repo), branch: repo.branch, env, log });
  log.info('fetched', { repo: repo.name, head });
  events.emit('repo_stage', { repo: repo.name, stage: 'fetched', head });

  const migration = migrateFingerprints({ state: stored, repoName: repo.name, cloneDir });
  const previous = migration.state;
  if (migration.remapped.size || migration.merged) {
    log.info('fingerprints migrated to the line-anchored version', { repo: repo.name, remapped: migration.remapped.size, merged_duplicates: migration.merged });
    const stale = repo.suppressed.filter((s) => migration.remapped.has(s.fingerprint));
    if (stale.length) {
      log.warn('suppressed fingerprints changed; update them in repos.yaml', {
        repo: repo.name,
        changes: stale.map((s) => ({ old: s.fingerprint, new: migration.remapped.get(s.fingerprint) })),
      });
    }
  }

  const validating = (opts.mode ?? repo.mode) === 'validate';
  const planned = planAudit({
    repo,
    opts,
    previous,
    git,
    head,
    cloneDir,
    log,
    ...(validating
      ? {
          validation: {
            stages: ctx.store.stagesFor(repo.name),
            decisions: ctx.store.decisionsFor(repo.name),
            suppressed: new Set(suppressionsOf(repo).keys()),
            attempts: ctx.store.attemptsFor(repo.name),
          },
        }
      : {}),
  });
  if ('skip' in planned) return { status: 'skipped', reason: planned.skip };
  if (planned.plan.mode === 'validate') {
    return validateRepo({ repo, opts, ctx, previous, git, head, cloneDir, workDir, candidates: planned.plan.validationCandidates, runAt, written });
  }
  const { mode, analyzers, lastByAnalyzer, base, fromBases, candidates, deleted, speculativeCandidates } = planned.plan;
  const speculativeMode = mode === 'speculative';
  const audits = auditsByAnalyzer(previous);

  const selection = speculativeMode
    ? {
        selected: [...new Set(speculativeCandidates.map((c) => c.file))].map((path): Candidate => ({ path, status: 'speculative' })),
        skipped: [],
        omitted: [] as string[],
        eligibleCount: undefined,
        eligiblePaths: undefined,
      }
    : selectFiles({
        cloneDir,
        candidates,
        excluded: repo.excluded_paths,
        focusPaths: repo.focus_paths,
        maxFiles: opts.maxFiles ?? (mode === 'full' ? (repo.max_files_full_run ?? repo.max_files_per_run) : repo.max_files_per_run),
        maxBytes: repo.max_file_bytes,
        lastAudited: lastAuditedFor(audits, analyzers),
        order: mode === 'full' ? 'coverage' : 'priority',
        auditedBefore: mode === 'full' ? (opts.sweepStart ?? null) : null,
      });
  const { selected, skipped, omitted, eligibleCount, eligiblePaths } = selection;
  log.info('files selected', {
    repo: repo.name,
    mode,
    analyzers,
    selected: selected.length,
    skipped: skipped.length,
    omitted: omitted.length,
    deleted: deleted.length,
  });
  events.emit('files_selected', {
    repo: repo.name,
    mode,
    analyzers,
    base,
    head,
    selected: selected.length,
    omitted: omitted.length,
    skipped: skipped.length,
    deleted: deleted.length,
    files: selected.slice(0, 200).map((f) => f.path),
  });
  if (mode === 'full') ctx.store.recordCensus(repo.name, { eligible: eligibleCount ?? selected.length + omitted.length, head });
  if (omitted.length) {
    log.warn('file cap reached; omitted files are audited first on the next full run', { repo: repo.name, count: omitted.length, first: omitted.slice(0, 15) });
  }

  if (speculativeMode && selected.length === 0) {
    log.info('no speculative candidates to review; skipping', { repo: repo.name });
    return { status: 'skipped', reason: 'no speculative candidates' };
  }
  if (opts.sweepStart && mode === 'full' && selected.length === 0) {
    log.info('sweep complete: every eligible file was audited since the sweep started', { repo: repo.name, since: opts.sweepStart });
    return { status: 'skipped', reason: 'sweep complete', complete: true };
  }
  if (selected.length === 0) {
    log.info('nothing auditable changed; recording the commit and skipping', { repo: repo.name });
    if (!opts.prepareOnly) {
      const { nextState } = classify({
        findings: [],
        previous,
        auditedFiles: [],
        deletedFiles: deleted,
        reviews: [],
        runAt,
        suppressed: suppressionsOf(repo),
        refutedByAuditor: refutedByAuditorIn(ctx.store, repo.name),
        auditedCategories: analyzers,
      });
      const { file_audits: _legacy, ...rest } = previous ?? ({} as Partial<RepoState>);
      ctx.store.writeRepoState(
        repo.name,
        {
          ...rest,
          repo: repo.name,
          branch: repo.branch,
          last_commit: head,
          last_commit_by_analyzer: advanceCommits(lastByAnalyzer, analyzers, head),
          last_run_at: runAt,
          file_audits_by_analyzer: recordAudits(audits, { files: {}, deleted, runAt }),
          fingerprint_version: FINGERPRINT_VERSION,
          findings: nextState,
        },
        written,
      );
    }
    return { status: 'skipped', reason: 'no auditable files changed' };
  }

  const auditedFiles = selected.map((f) => f.path);
  const diffPath = join(workDir, 'changes.diff');
  if (mode === 'incremental') {
    const parts = fromBases.map((from) => {
      const diff = writeDiff({ git, from, to: head, files: auditedFiles, maxBytes: Math.floor(MAX_DIFF_BYTES / fromBases.length) });
      return fromBases.length > 1 ? `# reposcout: changes since ${from}\n${diff}` : diff;
    });
    writeFileSync(diffPath, parts.join('\n'));
  }

  const verification = verificationFor(repo);
  if (verification.warning) log.warn(verification.warning, { repo: repo.name });
  const verifyDir = verification.testCommand ? join(layout.workspaceDir, '.verify', repo.name) : null;
  const rawOutput = join(workDir, 'raw-findings.json');
  const manifest = buildManifest({
    repo,
    cloneDir,
    mode,
    base,
    head,
    analyzers,
    diffPath,
    selected,
    deleted,
    omitted,
    known: speculativeMode ? [] : knownFindings(previous?.findings, new Set(auditedFiles), analyzers),
    falsePositives: speculativeMode ? [] : knownFalsePositives(previous?.findings, suppressionsOf(repo), analyzers),
    speculative: speculativeMode ? speculativeCandidates : null,
    verifyDir,
    outputPath: rawOutput,
  });
  const manifestPath = join(workDir, 'manifest.json');
  writeJson(manifestPath, manifest);
  log.info('manifest written', { repo: repo.name, manifest: manifestPath });
  if (opts.prepareOnly) return { status: 'prepared', manifest: manifestPath };
  if (opts.isCancelled()) throw new CancelledError('cancelled before the Claude audit started');

  const { run, tracker, usage, raw, captured, promptVersion } = await runAuditSession({
    ctx,
    repo,
    opts,
    git,
    head,
    cloneDir,
    workDir,
    manifestPath,
    rawOutput,
    verifyDir,
    mode,
    range: mode === 'incremental' ? `${base}..${head}` : head,
    analyzers,
    runAt,
    fileCount: auditedFiles.length,
  });

  const { accepted, speculative, rejected } = processFindings({ raw, repoName: repo.name, commit: head, cloneDir, auditedFiles, log });
  const verdicts = speculativeMode
    ? speculativeVerdicts(speculativeCandidates, raw, new Set(accepted.map((f) => f.fingerprint)))
    : { reviews: Array.isArray(raw.speculative_review) ? raw.speculative_review : [], unreviewed: [] };
  if (verdicts.unreviewed.length) {
    log.warn('the verifier gave no verdict for some speculative candidates; they stay speculative', { repo: repo.name, fingerprints: verdicts.unreviewed });
  }
  const reads = readsByAnalyzer(tracker, cloneDir);
  // A file counts as read once a specialist opened it; a speculative review has none, so there it is the verifier.
  const readSet = speculativeMode ? reads.any : reads.bySpecialist;
  const unread = auditedFiles.filter((f) => !readSet.has(f));
  // Audit times are stamped per analyzer, from what that analyzer's specialists opened.
  const perAnalyzer = auditedByAnalyzer({ analyzers, selected: auditedFiles, readBy: reads.byCategory, unreadBefore: unreadOnceByAnalyzer(previous) });
  const readCoverage: ReadCoverage = {
    selected: auditedFiles.length,
    read: auditedFiles.length - unread.length,
    unread,
    ...(speculativeMode
      ? {}
      : { by_analyzer: Object.fromEntries(analyzers.map((a) => [a, auditedFiles.filter((f) => reads.byCategory.get(a)?.has(f)).length])) }),
  };
  if (unread.length)
    log.warn(speculativeMode ? 'candidate files the verifier did not open' : 'files in the audit set that no specialist opened', {
      repo: repo.name,
      count: unread.length,
      first: unread.slice(0, 15),
    });

  const { reported, resolved, carried, missed, confirmed, suppressedHits, speculativeNew, refuted, nextState } = classify({
    findings: accepted,
    speculative,
    speculativeReviews: verdicts.reviews,
    previous,
    // A speculative review looks at candidates only: it must not resolve the open findings in those files.
    auditedFiles: speculativeMode ? [] : auditedFiles,
    deletedFiles: deleted,
    reviews: Array.isArray(raw.known_findings_review) ? raw.known_findings_review : [],
    runAt,
    suppressed: suppressionsOf(repo),
    refutedByAuditor: refutedByAuditorIn(ctx.store, repo.name),
    auditedCategories: analyzers,
    readByCategory: reads.byCategory,
  });

  const discarded = normalizeDiscards(raw.discarded);
  // A speculative review runs no specialists, so it has no yield to measure.
  const yields = speculativeMode
    ? []
    : analyzerYield({
        analyzers,
        captured,
        kept: reported,
        speculative,
        discarded,
        usage,
        reported: isPlainCounts(raw.specialist_candidates) ? raw.specialist_candidates : {},
      });
  if (!verifyDir) log.info('reproduction is off for this repository: no test_command, so nothing is verified by a test', { repo: repo.name });
  const report = redactDeep<RepoReport>({
    schema: REPORT_SCHEMA,
    run_id: runId,
    repo: repo.name,
    organization: repo.organization,
    project: repo.project,
    branch: repo.branch,
    commit: head,
    previous_commit: mode === 'incremental' ? base : (previous?.last_commit ?? null),
    mode,
    analyzers,
    generated_at: new Date().toISOString(),
    audited_files: auditedFiles,
    omitted_files_count: omitted.length,
    findings: reported,
    resolved,
    open_total: Object.values(nextState).filter((e) => e.status === 'open').length,
    carried_open: carried.length,
    confirmed_known: confirmed.length,
    speculative_new: speculativeNew,
    speculative_total: Object.values(nextState).filter((e) => e.status === 'speculative').length,
    refuted,
    speculative_unreviewed: verdicts.unreviewed,
    suppressed_count: suppressedHits.length,
    read_coverage: readCoverage,
    discarded_count: discarded.length,
    discarded,
    rejected,
    notes: typeof raw.notes === 'string' ? raw.notes : '',
    usage,
    prompt_version: promptVersion,
    specialist_model: repo.claude.models.specialists,
    verification: { enabled: !!verifyDir, reason: verifyDir ? null : (verification.warning ?? 'no test_command configured') },
    ...(speculativeMode ? {} : { yield: yields }),
  });
  const nextRepoState: RepoState = speculativeMode
    ? { ...(previous as RepoState), fingerprint_version: FINGERPRINT_VERSION, last_speculative_review_at: runAt, findings: nextState }
    : {
        repo: repo.name,
        branch: repo.branch,
        fingerprint_version: FINGERPRINT_VERSION,
        last_commit: head,
        last_run_at: runAt,
        last_commit_by_analyzer: advanceCommits(lastByAnalyzer, analyzers, head),
        last_full_run_at: mode === 'full' ? runAt : (previous?.last_full_run_at ?? null),
        eligible_files: mode === 'full' ? (eligibleCount ?? selected.length + omitted.length) : (previous?.eligible_files ?? null),
        file_audits_by_analyzer: recordAudits(audits, {
          files: perAnalyzer.audited,
          deleted,
          runAt,
          eligible: mode === 'full' ? (eligiblePaths ?? null) : null,
        }),
        unread_once: [],
        unread_once_by_analyzer: perAnalyzer.unreadOnce,
        findings: nextState,
      };
  // The database is the record, and the report and the state it describes commit together: a crash between them
  // would leave a report announcing findings as new against a state that never advanced, so the next run would
  // announce them again. The dated file and the per-run copy are readable output beside summary.md, written only
  // once the record holds.
  ctx.store.transaction(() => {
    ctx.store.saveReport(report, ctx.date);
    ctx.store.saveYield({ runId, repo: repo.name, at: runAt, mode, promptVersion, model: repo.claude.models.specialists }, yields);
    ctx.store.writeRepoState(repo.name, nextRepoState, written);
  });
  writeJson(join(ctx.dateDir, `${repo.name}.json`), report);
  writeJson(join(ctx.dateDir, 'runs', runId, `${repo.name}.json`), report);
  writeReportSarif(join(ctx.dateDir, 'runs', runId, `${repo.name}.sarif`), report, repo);

  if (speculativeMode) {
    const promoted = reported.filter((f) => f.promoted).length;
    log.info('speculative review done', {
      repo: repo.name,
      reviewed: speculativeCandidates.length,
      confirmed: promoted,
      refuted: refuted.filter((f) => f.status === 'refuted').length,
      duplicates: refuted.filter((f) => f.status === 'duplicate').length,
      no_verdict: verdicts.unreviewed.length,
    });
    return {
      status: 'ok',
      new: reported.filter((f) => f.status === 'new').length,
      resolved: 0,
      confirmed: promoted,
      refuted: refuted.length,
      speculative: speculativeNew.length,
    };
  }
  const fresh = reported.filter((f) => f.status === 'new').length;
  log.info('repo done', {
    repo: repo.name,
    new: fresh,
    reopened: reported.filter((f) => f.reopened).length,
    existing: reported.length - fresh,
    resolved: resolved.length,
    missed_once: missed.length,
    rejected: rejected.length,
  });
  return {
    status: 'ok',
    new: fresh,
    resolved: resolved.length,
    confirmed: confirmed.length,
    speculative: speculativeNew.length,
    files_read: readCoverage.read,
    files_selected: readCoverage.selected,
    pending: omitted.length,
    rate_limit: run.rateLimit ?? null,
  };
}

// A validation pass: the verifier tries to reproduce each candidate with a test, and only its reproductions and the
// attempts are written. It goes around classify, so nothing is resolved, missed or seen again, and it leaves the
// audited commits and file coverage as they were.
async function validateRepo({
  repo,
  opts,
  ctx,
  previous,
  git,
  head,
  cloneDir,
  workDir,
  candidates,
  runAt,
  written,
}: {
  repo: RepoConfig;
  opts: AuditOptions;
  ctx: RunContext;
  previous: RepoState | null;
  git: Git;
  head: string;
  cloneDir: string;
  workDir: string;
  candidates: ValidationCandidate[];
  runAt: string;
  written: { runId: string; at: string };
}): Promise<RepoOutcome> {
  const { layout, log, events, runId } = ctx;
  const files = [...new Set(candidates.map((c) => c.file))];
  log.info('findings selected for validation', { repo: repo.name, findings: candidates.length, files: files.length });
  events.emit('files_selected', {
    repo: repo.name,
    mode: 'validate',
    analyzers: [],
    base: null,
    head,
    selected: candidates.length,
    omitted: 0,
    skipped: 0,
    deleted: 0,
    files: files.slice(0, 200),
  });
  if (!previous || candidates.length === 0) {
    log.info('no open findings at the detected stage to validate; skipping', { repo: repo.name });
    return { status: 'skipped', reason: 'no findings to validate' };
  }

  const verification = verificationFor(repo);
  if (verification.warning) log.warn(verification.warning, { repo: repo.name });
  const verifyDir = join(layout.workspaceDir, '.verify', repo.name);
  const rawOutput = join(workDir, 'raw-findings.json');
  const manifest = buildManifest({
    repo,
    cloneDir,
    mode: 'validate',
    base: null,
    head,
    analyzers: [],
    diffPath: join(workDir, 'changes.diff'),
    selected: files.map((path): Candidate => ({ path, status: 'validate' })),
    deleted: [],
    omitted: [],
    known: [],
    falsePositives: [],
    speculative: null,
    validation: candidates,
    verifyDir,
    outputPath: rawOutput,
  });
  const manifestPath = join(workDir, 'manifest.json');
  writeJson(manifestPath, manifest);
  log.info('manifest written', { repo: repo.name, manifest: manifestPath });
  if (opts.prepareOnly) return { status: 'prepared', manifest: manifestPath };
  if (opts.isCancelled()) throw new CancelledError('cancelled before the Claude validation started');

  const { run, tracker, usage, raw, promptVersion } = await runAuditSession({
    ctx,
    repo,
    opts,
    git,
    head,
    cloneDir,
    workDir,
    manifestPath,
    rawOutput,
    verifyDir,
    mode: 'validate',
    range: head,
    analyzers: [],
    runAt,
    fileCount: candidates.length,
  });
  if (raw.findings.length) log.warn('the verifier returned findings in a validation pass; they are ignored', { repo: repo.name, count: raw.findings.length });

  const { nextState, attempts, block } = applyValidation({ previous: previous.findings ?? {}, candidates, review: raw.validation_review, runId, at: runAt });
  if (block.unreviewed.length) {
    log.warn('the verifier gave no verdict for some findings; they were not counted as attempts', { repo: repo.name, fingerprints: block.unreviewed });
  }
  const reads = readsByAnalyzer(tracker, cloneDir);
  const unread = files.filter((f) => !reads.any.has(f));
  const report = redactDeep<RepoReport>({
    schema: REPORT_SCHEMA,
    run_id: runId,
    repo: repo.name,
    organization: repo.organization,
    project: repo.project,
    branch: repo.branch,
    commit: head,
    previous_commit: previous.last_commit ?? null,
    mode: 'validate',
    analyzers: [],
    generated_at: new Date().toISOString(),
    audited_files: files,
    omitted_files_count: 0,
    findings: [],
    resolved: [],
    open_total: Object.values(nextState).filter((e) => e.status === 'open').length,
    carried_open: 0,
    confirmed_known: 0,
    speculative_new: [],
    speculative_total: Object.values(nextState).filter((e) => e.status === 'speculative').length,
    refuted: [],
    suppressed_count: 0,
    read_coverage: { selected: files.length, read: files.length - unread.length, unread },
    discarded_count: 0,
    discarded: [],
    rejected: [],
    notes: typeof raw.notes === 'string' ? raw.notes : '',
    usage,
    prompt_version: promptVersion,
    specialist_model: repo.claude.models.specialists,
    verification: { enabled: true, reason: null },
    validation: block,
  });
  ctx.store.transaction(() => {
    ctx.store.saveReport(report, ctx.date);
    ctx.store.writeRepoState(repo.name, { ...previous, fingerprint_version: FINGERPRINT_VERSION, findings: nextState }, written);
    ctx.store.recordAttempts(repo.name, attempts);
  });
  writeJson(join(ctx.dateDir, `${repo.name}.json`), report);
  writeJson(join(ctx.dateDir, 'runs', runId, `${repo.name}.json`), report);
  writeReportSarif(join(ctx.dateDir, 'runs', runId, `${repo.name}.sarif`), report, repo);

  const outcome = {
    tried: block.tried,
    reproduced: block.reproduced.length,
    not_reproduced: block.not_reproduced.length,
    not_testable: block.not_testable.length,
    unreviewed: block.unreviewed.length,
  };
  log.info('validation done', { repo: repo.name, ...outcome });
  return { status: 'ok', new: 0, resolved: 0, speculative: 0, ...outcome, rate_limit: run.rateLimit ?? null };
}
