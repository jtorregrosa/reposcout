import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ANALYZERS } from '../config/analyzers.js';
import { loadConfig, type RepoConfig } from '../config/config.js';
import { errorMessage } from '../errors.js';
import { MAX_UNSUCCESSFUL_ATTEMPTS } from '../findings/validation.js';
import { layout as layoutOf } from '../paths.js';
import { verificationState } from '../security/sandbox.js';
import { auditsByAnalyzer, costPerFile, fullRunPace, fullyAudited } from '../state/coverage.js';
import { activeRun } from '../state/lock.js';
import type { Census } from '../state/types.js';
import type { Store } from '../store/index.js';
import type { DiscardView, FindingCounts, FindingView, Overview, RepoView } from './api.js';
import { precisionCells } from './metrics.js';

const RUN_ID = /^run-[0-9TZ-]+$/;
const DATE_DIR = /^\d{4}-\d{2}-\d{2}$/;

export interface RunListing {
  run_id: string;
  date: string;
  file: string;
  bytes: number;
}

function dateDirs(root: string): string[] {
  const reports = join(root, 'reports');
  if (!existsSync(reports)) return [];
  return readdirSync(reports)
    .filter((d) => DATE_DIR.test(d))
    .sort()
    .reverse();
}

export function listRuns(root: string, limit = 40): RunListing[] {
  const runs: RunListing[] = [];
  for (const date of dateDirs(root)) {
    const logs = join(root, 'reports', date, 'logs');
    if (!existsSync(logs)) continue;
    for (const f of readdirSync(logs)) {
      const m = /^(run-[0-9TZ-]+)\.events\.jsonl$/.exec(f);
      if (m) runs.push({ run_id: m[1] as string, date, file: join(logs, f), bytes: statSync(join(logs, f)).size });
    }
    if (runs.length >= limit) break;
  }
  return runs.sort((a, b) => b.run_id.localeCompare(a.run_id)).slice(0, limit);
}

export function runEventsFile(root: string, runId: string): string | null {
  if (!RUN_ID.test(runId)) return null;
  return listRuns(root, 1000).find((r) => r.run_id === runId)?.file ?? null;
}

function repoRow(store: Store, repo: RepoConfig, census: Census, findings: FindingView[], discarded: DiscardView[]): RepoView {
  const last = store.latestReport(repo.name);
  const sources = store.recentReports(repo.name);
  // Discards deduplicated by file and title across the week's runs.
  const seen = new Set<string>();
  for (const { date, run, r } of sources.length ? sources : last ? [last] : []) {
    for (const d of r.discarded ?? []) {
      const key = `${d.file}\n${d.title}`;
      if (seen.has(key)) continue;
      seen.add(key);
      discarded.push({ repo: repo.name, date, run, commit: r.commit, ...d });
    }
  }
  const state = store.readRepoState(repo.name);
  const counts: FindingCounts = {
    open: 0,
    resolved: 0,
    suppressed: 0,
    speculative: 0,
    refuted: 0,
    duplicate: 0,
    new_last_run: 0,
    to_validate: 0,
    by_severity: { critical: 0, high: 0, medium: 0, low: 0 },
  };
  // repos.yaml is the source of truth for suppressions; state catches up on the next run, so the UI shows
  // an edit made from the dashboard at once and marks it pending.
  const configured = new Map((repo.suppressed ?? []).map((s) => [s.fingerprint, s.reason]));
  const decisions = store.decisionsFor(repo.name);
  const labels = store.labelsFor(repo.name);
  const stages = store.stagesFor(repo.name);
  const attempts = store.attemptsFor(repo.name);
  for (const [fingerprint, entry] of Object.entries(state?.findings ?? {})) {
    let status = entry.status;
    let pending = false;
    if ((status === 'open' || status === 'speculative') && configured.has(fingerprint)) [status, pending] = ['suppressed', true];
    else if (status === 'suppressed' && !configured.has(fingerprint)) [status, pending] = [entry.status_before_suppression ?? 'open', true];
    // A reopened finding keeps its first sighting but is new to whoever resolved it.
    const isNew = status === 'open' && !!state?.last_run_at && (entry.first_seen === state.last_run_at || entry.reopened_at === state.last_run_at);
    counts[status] = (counts[status] ?? 0) + 1;
    if (status === 'open') counts.by_severity[entry.finding.severity] = (counts.by_severity[entry.finding.severity] ?? 0) + 1;
    if (isNew) counts.new_last_run++;
    const tries = (attempts.get(fingerprint) ?? []).filter((a) => a.outcome !== 'reproduced').length;
    if (
      status === 'open' &&
      (stages.get(fingerprint)?.stage ?? 'detected') === 'detected' &&
      !decisions.has(fingerprint) &&
      tries < MAX_UNSUCCESSFUL_ATTEMPTS
    ) {
      counts.to_validate++;
    }
    findings.push({
      ...entry.finding,
      fingerprint,
      repo: repo.name,
      status,
      status_pending: pending,
      new_last_run: isNew,
      first_seen: entry.first_seen,
      last_seen: entry.last_seen,
      resolved_at: entry.resolved_at ?? null,
      resolution: entry.resolution ?? null,
      review_note: entry.review_note ?? null,
      suppressed_reason: status === 'suppressed' ? (configured.get(fingerprint) ?? entry.reason ?? null) : null,
      decision: decisions.get(fingerprint) ?? null,
      labels_override: labels.get(fingerprint) ?? null,
      stage: stages.get(fingerprint)?.stage ?? 'detected',
      stage_since: stages.get(fingerprint)?.since ?? null,
      stage_source: stages.get(fingerprint)?.source ?? null,
    });
  }

  // A file counts as covered once every analyzer has audited it.
  const by = auditsByAnalyzer(state);
  const eligible = state?.eligible_files ?? census[repo.name]?.eligible ?? null;
  const cap = (n: number) => (eligible ? Math.min(n, eligible) : n);
  const first = ANALYZERS[0];
  return {
    name: repo.name,
    organization: repo.organization,
    project: repo.project,
    branch: repo.branch,
    models: repo.claude?.models,
    test_command: !!repo.test_command,
    verification: verificationState(repo),
    last_commit: state?.last_commit ?? null,
    last_run_at: state?.last_run_at ?? null,
    last_full_run_at: state?.last_full_run_at ?? null,
    analyzers: repo.analyzers,
    last_read_coverage: last?.r.read_coverage ? { read: last.r.read_coverage.read, selected: last.r.read_coverage.selected } : null,
    coverage: {
      audited: cap(fullyAudited(by)),
      eligible,
      per_run: repo.max_files_full_run ?? repo.max_files_per_run ?? null,
      pace: fullRunPace(sources),
      counted_only: !state?.eligible_files && census[repo.name] ? census[repo.name]?.at : null,
      by_analyzer: Object.fromEntries(ANALYZERS.map((a) => [a, cap(Object.keys(by[a] ?? {}).length)])),
      // Raw audit times, so the UI can count coverage since any moment (a sweep started today, the last week).
      times: Object.fromEntries(ANALYZERS.map((a) => [a, Object.values(by[a] ?? {})])),
      oldest_times: Object.keys(by[first] ?? {}).map((f) => ANALYZERS.map((a) => by[a]?.[f] ?? '').sort()[0]),
    },
    counts,
  };
}

export function readOverview(root: string, configPath: string, store: Store): Overview {
  let repos: RepoConfig[] = [];
  let configError: string | null = null;
  try {
    repos = loadConfig(configPath);
  } catch (e) {
    configError = errorMessage(e);
  }

  const findings: FindingView[] = [];
  const discarded: DiscardView[] = [];
  const census = store.census();
  const repoRows = repos.map((repo) => repoRow(store, repo, census, findings, discarded));

  // A failure stops counting once the repository has been audited successfully since, or it lingers for a week.
  const lastRun = new Map(repoRows.map((r) => [r.name, r.last_run_at]));
  const failures: Overview['failures'] = {};
  for (const { repo, ...v } of store.recentFailures()) {
    const since = lastRun.get(repo);
    if (since && v.at && since > v.at) continue;
    failures[repo] ??= v;
  }

  const usage = store.usage(200);
  return {
    generated_at: new Date().toISOString(),
    analyzers: ANALYZERS,
    config_error: configError,
    active: activeRun(layoutOf(root).lockFile),
    repos: repoRows,
    findings,
    discarded,
    failures,
    usage,
    cost_per_file: costPerFile(usage),
    rate_limit: [...usage].reverse().find((u) => u.rate_limit)?.rate_limit ?? null,
    runs: listRuns(root).map(({ run_id, date, bytes }) => ({ run_id, date, bytes })),
    precision: precisionCells(store.precisionFacts(), new Map(repos.map((r) => [r.name, new Set((r.suppressed ?? []).map((s) => s.fingerprint))]))),
    yields: store.yields(),
    run_results: store.runResults(),
  };
}

// Cheap change detector: the UI refetches the overview only when one of these moves. The database's data version
// changes whenever a run commits.
export function overviewSignature(root: string, configPath: string, store: Store): string {
  const parts: number[] = [store.dataVersion()];
  for (const p of [layoutOf(root).lockFile, configPath]) {
    try {
      parts.push(statSync(p).mtimeMs);
    } catch {
      parts.push(0);
    }
  }
  return parts.join(':');
}
