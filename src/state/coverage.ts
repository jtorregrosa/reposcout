import { ANALYZERS, type Analyzer } from '../config/analyzers.js';
import type { AuditsByAnalyzer, FileAudits, RepoState, UsageRow } from './types.js';

// Audit times are kept per analyzer: a run with only `security` must not make the full-mode rotation skip a
// file that `logic` has never seen. Older state kept one map for all analyzers; it counts for every one of them.
export function auditsByAnalyzer(state: Pick<RepoState, 'file_audits' | 'file_audits_by_analyzer'> | null | undefined): AuditsByAnalyzer {
  const out = Object.fromEntries(ANALYZERS.map((a) => [a, { ...(state?.file_audits_by_analyzer?.[a] ?? {}) }])) as AuditsByAnalyzer;
  if (state?.file_audits && !state.file_audits_by_analyzer) {
    for (const a of ANALYZERS) Object.assign(out[a], state.file_audits);
  }
  return out;
}

// The oldest audit time across the selected analyzers; a file one of them never saw sorts first ('').
export function lastAuditedFor(byAnalyzer: Partial<AuditsByAnalyzer>, analyzers: readonly Analyzer[]): FileAudits {
  const paths = new Set(analyzers.flatMap((a) => Object.keys(byAnalyzer[a] ?? {})));
  const out: FileAudits = {};
  for (const p of paths) {
    const times = analyzers.map((a) => byAnalyzer[a]?.[p] ?? '');
    out[p] = times.includes('') ? '' : (times.sort()[0] as string);
  }
  return out;
}

export type FilesByAnalyzer = Partial<Record<Analyzer, string[]>>;

// files: per analyzer, the files it audited this run; an analyzer left out audited nothing. eligible: the
// auditable tree a full run just listed. Audits of files outside it (newly excluded, removed) are dropped, or they
// would keep counting towards coverage of a tree they no longer belong to.
export function recordAudits(
  byAnalyzer: Partial<AuditsByAnalyzer>,
  { files, deleted, runAt, eligible = null }: { files: FilesByAnalyzer; deleted: string[]; runAt: string; eligible?: string[] | null },
): AuditsByAnalyzer {
  const gone = new Set(deleted);
  const keep = eligible ? new Set(eligible) : null;
  const out = {} as AuditsByAnalyzer;
  for (const a of ANALYZERS) {
    const audits: FileAudits = Object.fromEntries(Object.entries(byAnalyzer[a] ?? {}).filter(([p]) => !gone.has(p) && (!keep || keep.has(p))));
    for (const p of files[a] ?? []) audits[p] = runAt;
    out[a] = audits;
  }
  return out;
}

// The files each analyzer left unread last time. Older state kept one list for all analyzers; it counts for each.
export function unreadOnceByAnalyzer(state: Pick<RepoState, 'unread_once' | 'unread_once_by_analyzer'> | null | undefined): FilesByAnalyzer {
  if (state?.unread_once_by_analyzer) return state.unread_once_by_analyzer;
  const legacy = state?.unread_once ?? [];
  return legacy.length ? Object.fromEntries(ANALYZERS.map((a) => [a, [...legacy]])) : {};
}

// What each analyzer audited this run: the selected files its own specialists opened. A file the verifier or the
// orchestrator opened does not count for a specialist that never did. A file an analyzer was given and did not
// open is retried once by the next run; unread a second time it is recorded anyway, so a file no specialist finds
// worth opening cannot hold the head of the full-mode rotation forever.
export function auditedByAnalyzer({
  analyzers,
  selected,
  readBy,
  unreadBefore,
}: {
  analyzers: readonly Analyzer[];
  selected: readonly string[];
  readBy: ReadonlyMap<string, ReadonlySet<string>>;
  unreadBefore: FilesByAnalyzer;
}): { audited: FilesByAnalyzer; unreadOnce: FilesByAnalyzer } {
  const audited: FilesByAnalyzer = {};
  // An analyzer that did not run keeps its list for the next run that includes it.
  const unreadOnce: FilesByAnalyzer = Object.fromEntries(Object.entries(unreadBefore).filter(([a]) => !analyzers.includes(a as Analyzer)));
  for (const a of analyzers) {
    const read = readBy.get(a);
    const before = new Set(unreadBefore[a] ?? []);
    audited[a] = selected.filter((f) => read?.has(f) || before.has(f));
    const pending = selected.filter((f) => !read?.has(f) && !before.has(f));
    if (pending.length) unreadOnce[a] = pending;
  }
  return { audited, unreadOnce };
}

// Files every analyzer has audited at least once.
export function fullyAudited(byAnalyzer: Partial<AuditsByAnalyzer>): number {
  const [first, ...rest] = ANALYZERS;
  return Object.keys(byAnalyzer[first] ?? {}).filter((p) => rest.every((a) => byAnalyzer[a]?.[p])).length;
}

interface ReportLike {
  r: { mode?: string; read_coverage?: { selected: number; read: number } };
}

// Files a full run of this repository actually gets through, from the last few that ran: only files an agent
// opened count as audited, so the configured cap overstates progress.
export function fullRunPace(reports: ReportLike[], last = 5): { files: number; runs: number } | null {
  const runs = reports.filter(({ r }) => r.mode === 'full' && r.read_coverage?.selected).slice(0, last);
  if (!runs.length) return null;
  const files = runs.reduce((s, { r }) => s + (r.read_coverage?.read ?? 0), 0) / runs.length;
  return { files: Math.max(1, Math.round(files)), runs: runs.length };
}

// Subscription window share per audited file, from the runs whose cost was measured inside one window.
export function costPerFile(usage: Partial<UsageRow>[], last = 10): { five_hour: number; seven_day: number; runs: number } | null {
  const rows = usage.filter((u) => u.mode === 'full' && (u.files ?? 0) > 0 && (u.window_cost?.five_hour ?? 0) > 0).slice(-last);
  if (!rows.length) return null;
  const files = rows.reduce((s, u) => s + (u.files ?? 0), 0);
  return {
    five_hour: rows.reduce((s, u) => s + (u.window_cost?.five_hour ?? 0), 0) / files,
    seven_day: rows.reduce((s, u) => s + (u.window_cost?.seven_day ?? 0), 0) / files,
    runs: rows.length,
  };
}
