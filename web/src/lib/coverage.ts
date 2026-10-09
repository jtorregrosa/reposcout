import type { Overview, RepoView } from './types';

export type SinceMode = 'all' | '24h' | '7d' | 'custom';
export interface CoverageSince {
  mode: SinceMode;
  custom: string;
}

export function cutoffOf(since: CoverageSince, now = Date.now()): string | null {
  if (since.mode === '24h') return new Date(now - 864e5).toISOString();
  if (since.mode === '7d') return new Date(now - 7 * 864e5).toISOString();
  if (since.mode === 'custom' && since.custom) return new Date(since.custom).toISOString();
  return null;
}

export interface RepoCoverageCounts {
  // Files every analyzer has audited (since the cutoff, when there is one).
  every: number;
  byAnalyzer: Record<string, number>;
  eligible: number;
}

export function coverageCounts(repo: RepoView, cutoff: string | null): RepoCoverageCounts | null {
  const eligible = repo.coverage.eligible;
  if (!eligible) return null;
  const cap = (n: number) => Math.min(n, eligible);
  if (!cutoff) return { every: repo.coverage.audited, byAnalyzer: repo.coverage.by_analyzer, eligible };
  return {
    every: cap(repo.coverage.oldest_times.filter((t) => t && t >= cutoff).length),
    byAnalyzer: Object.fromEntries(Object.entries(repo.coverage.times).map(([a, ts]) => [a, cap(ts.filter((t) => t >= cutoff).length)])),
    eligible,
  };
}

// Measured pace first: a full run audits only the files its agents actually open, usually fewer than the cap.
export const paceOf = (repo: RepoView): number | null => repo.coverage.pace?.files ?? repo.coverage.per_run;

export const runsFor = (pending: number, pace: number | null): number | null => (pace ? Math.ceil(pending / pace) : null);

export function paceNote(repo: RepoView): string {
  if (repo.coverage.pace) return `~${repo.coverage.pace.files} files per full run, measured over ${repo.coverage.pace.runs}`;
  if (repo.coverage.per_run) return `${repo.coverage.per_run} files per full run, the configured cap`;
  return '';
}

export interface CoverageTotals {
  done: number;
  eligible: number;
  pending: number;
  runsLeft: number;
  windows: { fiveHour: number; weekly: number; runs: number } | null;
  uncounted: string[];
}

export function coverageTotals(ov: Overview, cutoff: string | null): CoverageTotals {
  let done = 0;
  let eligible = 0;
  let pending = 0;
  let runsLeft = 0;
  const uncounted: string[] = [];
  for (const r of ov.repos) {
    const c = coverageCounts(r, cutoff);
    if (!c) {
      uncounted.push(r.name);
      continue;
    }
    const left = Math.max(0, c.eligible - c.every);
    done += c.every;
    eligible += c.eligible;
    pending += left;
    runsLeft += runsFor(left, paceOf(r)) ?? 0;
  }
  const cpf = ov.cost_per_file;
  return {
    done,
    eligible,
    pending,
    runsLeft,
    windows: cpf ? { fiveHour: pending * cpf.five_hour, weekly: pending * cpf.seven_day, runs: cpf.runs } : null,
    uncounted,
  };
}
