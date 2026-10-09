import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ANALYZERS, type Analyzer, type Mode } from '../config/analyzers.js';
import type { RepoConfig } from '../config/config.js';
import { type Finding, SEVERITY_RANK } from '../findings/types.js';
import { DEFAULT_VALIDATION_LIMIT, pickValidationCandidates, type ValidationCandidate } from '../findings/validation.js';
import { changedFiles, ensureBaseCommit, type Git, trackedFiles } from '../git/git.js';
import type { Candidate } from '../selection/select.js';
import type { RepoState } from '../state/types.js';
import type { Logger } from '../telemetry/logger.js';
import type { AuditOptions } from './context.js';

export type SpeculativeCandidate = Finding;

export interface AuditPlan {
  mode: Mode;
  analyzers: Analyzer[];
  lastByAnalyzer: Partial<Record<Analyzer, string | null>>;
  // The single commit every selected analyzer last audited, when they agree.
  base: string | null;
  // Every distinct earlier commit the selected analyzers last audited; an incremental diff covers each.
  fromBases: string[];
  candidates: Candidate[];
  deleted: string[];
  speculativeCandidates: SpeculativeCandidate[];
  validationCandidates: ValidationCandidate[];
}

// What a validation pass needs beyond the repository's state to pick its findings.
export type ValidationInputs = Omit<Parameters<typeof pickValidationCandidates>[0], 'findings' | 'fileExists' | 'limit'>;

export type PlanResult = { skip: string } | { plan: AuditPlan };

const DEFAULT_SPECULATIVE_LIMIT = 30;

// Decides what this run looks at: the mode it really runs in, the commits it diffs from, and the candidate files.
export function planAudit({
  repo,
  opts,
  previous,
  git,
  head,
  cloneDir,
  log,
  validation,
}: {
  repo: RepoConfig;
  opts: AuditOptions;
  previous: RepoState | null;
  git: Git;
  head: string;
  cloneDir: string;
  log: Logger;
  validation?: ValidationInputs;
}): PlanResult {
  let mode: Mode = opts.mode ?? repo.mode ?? 'incremental';
  // Speculative mode re-examines only the candidates the verifier could not confirm, and validate mode tries to
  // reproduce the open findings still at detected: neither runs specialists.
  const speculative = mode === 'speculative';
  const validating = mode === 'validate';
  const analyzers = speculative || validating ? [] : (opts.analyzers ?? repo.analyzers);
  // Each analyzer remembers the commit it last audited, so a run with a subset never hides changes from the rest.
  const lastByAnalyzer = previous?.last_commit_by_analyzer ?? Object.fromEntries(ANALYZERS.map((a) => [a, previous?.last_commit ?? null]));
  const bases = [...new Set(analyzers.map((a) => lastByAnalyzer[a] ?? null))];
  const base = bases.length === 1 ? (bases[0] ?? null) : null;
  if (mode === 'incremental' && bases.includes(null)) {
    log.info('an analyzer has no previous audit; running a full audit as its baseline', { repo: repo.name, analyzers });
    mode = 'full';
  }
  if (mode === 'incremental' && bases.every((b) => b === head)) {
    log.info('no new commits since the last audit by these analyzers; skipping', { repo: repo.name, commit: head, analyzers });
    return { skip: 'no changes' };
  }
  if (mode === 'incremental' && !bases.every((b) => b === head || (b && ensureBaseCommit({ git, sha: b, log })))) mode = 'full';

  const fromBases = bases.filter((b): b is string => !!b && b !== head);
  const plan: AuditPlan = {
    mode,
    analyzers,
    lastByAnalyzer,
    base,
    fromBases,
    candidates: [],
    deleted: [],
    speculativeCandidates: [],
    validationCandidates: [],
  };

  if (validating) {
    plan.validationCandidates = pickValidationCandidates({
      stages: new Map(),
      decisions: new Map(),
      suppressed: new Set(repo.suppressed.map((s) => s.fingerprint)),
      attempts: new Map(),
      ...validation,
      findings: previous?.findings,
      fileExists: (file) => existsSync(join(cloneDir, file)),
      limit: opts.maxFiles ?? DEFAULT_VALIDATION_LIMIT,
    });
  } else if (speculative) {
    plan.speculativeCandidates = Object.entries(previous?.findings ?? {})
      .filter(([, e]) => e.status === 'speculative' && existsSync(join(cloneDir, e.finding.file)))
      .sort(
        ([, a], [, b]) =>
          (SEVERITY_RANK[a.finding.severity] ?? 9) - (SEVERITY_RANK[b.finding.severity] ?? 9) || String(a.first_seen).localeCompare(String(b.first_seen)),
      )
      .slice(0, opts.maxFiles ?? DEFAULT_SPECULATIVE_LIMIT)
      .map(([fp, e]) => ({ ...e.finding, fingerprint: fp }));
  } else if (mode === 'incremental') {
    const byPath = new Map<string, Candidate>();
    const deleted: string[] = [];
    for (const from of fromBases) {
      for (const c of changedFiles({ git, from, to: head })) {
        if (c.status === 'D') deleted.push(c.path);
        if (c.status === 'R' && c.old_path) deleted.push(c.old_path);
        if (c.status !== 'D' && !byPath.has(c.path)) byPath.set(c.path, c);
      }
    }
    plan.deleted = [...new Set(deleted)].filter((p) => !byPath.has(p));
    plan.candidates = [...byPath.values()];
  } else {
    const tracked = trackedFiles(git);
    plan.candidates = tracked.map((path) => ({ path, status: 'tracked' }));
    plan.deleted = goneFiles(previous, new Set(tracked));
  }
  return { plan };
}

// A full run has no diff to list deletions, including one that fell back from incremental: the files of open and
// speculative findings that are no longer in the tree are deleted.
export function goneFiles(previous: Pick<RepoState, 'findings'> | null, tracked: Set<string>): string[] {
  const files = Object.values(previous?.findings ?? {})
    .filter((e) => e.status === 'open' || e.status === 'speculative')
    .map((e) => e.finding.file);
  return [...new Set(files)].filter((f) => !tracked.has(f)).sort();
}
