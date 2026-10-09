import { CATEGORIES, KINDS, SEVERITIES } from './domain';
import { type Facet, type FindingsView, type KindFilter, matchesFilters } from './findings-view';
import { inQueue, QUEUE_VIEWS, type QueueView, queueOf } from './queues';
import type { Category, FindingView, Overview, RepoView, Severity, UsageRow } from './types';

export const openFindings = (findings: FindingView[]) => findings.filter((f) => f.status === 'open');

export const repoFindings = (findings: FindingView[], repo: string | null) => (repo ? findings.filter((f) => f.repo === repo) : findings);

export function countBy<K extends string>(items: FindingView[], key: (f: FindingView) => K): Partial<Record<K, number>> {
  const out: Partial<Record<K, number>> = {};
  for (const f of items) {
    const k = key(f);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

// How many findings each queue would hold under every other filter.
export function queueCounts(findings: FindingView[], view: FindingsView): Record<QueueView, number> {
  const scoped = findings.filter((f) => matchesFilters(f, view));
  return Object.fromEntries(QUEUE_VIEWS.map((q) => [q, scoped.filter((f) => inQueue(f, q)).length])) as Record<QueueView, number>;
}

export interface FacetCounts {
  severities: Partial<Record<Severity, number>>;
  categories: Partial<Record<Category, number>>;
  kinds: Partial<Record<KindFilter, number>>;
  stages: Partial<Record<FindingView['stage'], number>>;
  statuses: Partial<Record<FindingView['status'], number>>;
  newOnly: number;
  personalData: number;
}

// Each facet is counted within the current queue and every other filter, with its own filter released, so an
// option shows how many findings ticking it would leave.
export function facetCounts(findings: FindingView[], view: FindingsView): FacetCounts {
  const inView = findings.filter((f) => inQueue(f, view.queue));
  const released = (facet: Facet) => inView.filter((f) => matchesFilters(f, view, facet));
  return {
    severities: countBy(released('severities'), (f) => f.severity),
    categories: countBy(released('categories'), (f) => f.category),
    kinds: countBy(released('kinds'), (f) => f.kind ?? 'unset'),
    stages: countBy(released('stages'), (f) => f.stage),
    statuses: countBy(released('statuses'), (f) => f.status),
    newOnly: released('newOnly').filter((f) => f.status === 'open' && f.new_last_run).length,
    personalData: released('personalData').filter((f) => f.personal_data).length,
  };
}

export type MatrixAxis = 'category' | 'kind';
export type MatrixRow = { by: 'category'; key: Category } | { by: 'kind'; key: KindFilter };

export interface Matrix {
  rows: (MatrixRow & { cells: number[]; total: number })[];
  totals: number[];
  max: number;
}

// Every category is a row even when empty; findings not classified yet get a row only while there are some.
export function severityMatrix(findings: FindingView[], by: MatrixAxis = 'category'): Matrix {
  const keys: MatrixRow[] = by === 'category' ? CATEGORIES.map((key) => ({ by, key })) : ([...KINDS, 'unset'] as const).map((key) => ({ by, key }));
  const keyOf = (f: FindingView) => (by === 'category' ? f.category : (f.kind ?? 'unset'));
  const rows = keys
    .map((row) => {
      const cells = SEVERITIES.map((s) => findings.filter((f) => keyOf(f) === row.key && f.severity === s).length);
      return { ...row, cells, total: cells.reduce((a, b) => a + b, 0) };
    })
    .filter((r) => r.key !== 'unset' || r.total);
  const totals = SEVERITIES.map((s) => findings.filter((f) => f.severity === s).length);
  return { rows, totals, max: Math.max(1, ...rows.flatMap((r) => r.cells)) };
}

export type PipelineStage = 'detect' | 'validate' | 'report' | 'fix';

export interface Pipeline {
  detect: { open: number; fresh: number };
  validate: { total: number; detected: number; speculative: number };
  report: { total: number };
}

export function pipeline(findings: FindingView[]): Pipeline {
  const p: Pipeline = { detect: { open: 0, fresh: 0 }, validate: { total: 0, detected: 0, speculative: 0 }, report: { total: 0 } };
  for (const f of findings) {
    if (f.status === 'open') {
      p.detect.open++;
      if (f.new_last_run) p.detect.fresh++;
    }
    const q = queueOf(f);
    if (q === 'triage') {
      p.validate.total++;
      if (f.status === 'speculative') p.validate.speculative++;
      else p.validate.detected++;
    } else if (q === 'report') p.report.total++;
  }
  return p;
}

// The CLI's default caps per repository when no limit is given.
export const VALIDATION_CAP = 10;
export const SPECULATIVE_CAP = 30;

export interface LaunchScope {
  repos: string[];
  // What the pass will try, after the per-repository cap.
  tries: number;
  // What is waiting, before the cap.
  waiting: number;
}

// The server counts per repository what a validation pass would pick (to_validate); only repositories that can
// run test_command take part.
export function validationScope(repos: RepoView[], repo: string | null): LaunchScope {
  const eligible = repos.filter((r) => r.verification === 'on' && r.counts.to_validate > 0 && (!repo || r.name === repo));
  return {
    repos: eligible.map((r) => r.name),
    tries: eligible.reduce((a, r) => a + Math.min(r.counts.to_validate, VALIDATION_CAP), 0),
    waiting: eligible.reduce((a, r) => a + r.counts.to_validate, 0),
  };
}

// A speculative review re-examines the undecided speculative candidates.
export function speculativeScope(findings: FindingView[], repo: string | null): LaunchScope {
  const byRepo = countBy(
    findings.filter((f) => f.status === 'speculative' && !f.decision && (!repo || f.repo === repo)),
    (f) => f.repo,
  );
  const counts = Object.values(byRepo) as number[];
  return {
    repos: Object.keys(byRepo).sort(),
    tries: counts.reduce((a, n) => a + Math.min(n, SPECULATIVE_CAP), 0),
    waiting: counts.reduce((a, n) => a + n, 0),
  };
}

export interface RunHistoryEntry {
  runId: string;
  date: string;
  mode: string | null;
  ok: boolean | null;
  repos: string[];
  wallMs: number | null;
}

// Sweep passes record their usage under the run id with a pass suffix.
const baseRun = (id: string) => id.replace(/-p\d+$/, '');

// Run ids carry their UTC start time: run-2026-10-08T04-47-09-846Z.
export function runStart(runId: string): string | null {
  const m = /^run-(\d{4}-\d\d-\d\d)T(\d\d)-(\d\d)-(\d\d)-(\d+)Z/.exec(runId);
  return m ? `${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z` : null;
}

// The recorded runs, newest first, with what their usage rows tell of them. A row names its run when it was
// written after rows carried one; an older row belongs to the latest run that had started by then. A run with no
// Claude session, such as one that only prepared, has no usage row and shows its date alone.
export function runHistory(ov: Pick<Overview, 'runs' | 'usage'>): RunHistoryEntry[] {
  const starts = ov.runs
    .map((r) => ({ id: r.run_id, at: runStart(r.run_id) }))
    .filter((r): r is { id: string; at: string } => r.at != null)
    .sort((a, b) => b.at.localeCompare(a.at));
  const owner = (u: UsageRow) => {
    if (u.run_id) return baseRun(u.run_id);
    // Rows from before `at` existed carry only their date.
    const at = Date.parse(u.at ?? u.date);
    if (Number.isNaN(at)) return null;
    const iso = new Date(at).toISOString();
    return starts.find((r) => r.at <= iso)?.id ?? null;
  };
  const byRun = new Map<string, UsageRow[]>();
  for (const u of ov.usage) {
    const id = owner(u);
    if (id) byRun.set(id, [...(byRun.get(id) ?? []), u]);
  }
  return ov.runs.map((r) => {
    const rows = byRun.get(r.run_id) ?? [];
    return {
      runId: r.run_id,
      date: r.date,
      mode: rows[0]?.mode ?? null,
      ok: rows.length ? rows.every((u) => u.ok) : null,
      repos: [...new Set(rows.map((u) => u.repo))],
      wallMs: rows.length ? rows.reduce((a, u) => a + (u.wall_ms ?? u.duration_ms ?? 0), 0) : null,
    };
  });
}

export const triageCount = (ov: Overview) => ov.findings.filter((f) => queueOf(f) === 'triage').length;
