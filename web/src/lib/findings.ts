import { CATEGORIES, KIND_LABEL, KINDS, SEVERITIES, severityRank } from './domain';
import type { Category, FindingStatus, FindingView, Kind, Severity } from './types';

// "new" is a view over open findings, not a status of its own; "all" drops the status filter.
export type StatusView = 'open' | 'new' | 'speculative' | 'suppressed' | 'resolved' | 'refuted' | 'duplicate' | 'all';
export const STATUS_VIEWS: StatusView[] = ['open', 'new', 'speculative', 'suppressed', 'resolved', 'refuted', 'duplicate', 'all'];

// 'unset' finds what no audit or backfill has labelled yet.
export type KindFilter = Kind | 'unset';

export type SortKey = 'severity' | 'newest' | 'location';

export interface FindingFilters {
  status: StatusView;
  repo: string | null;
  severities: Severity[];
  categories: Category[];
  kinds: KindFilter[];
  personalData: boolean;
  q: string;
  sort: SortKey;
}

export const DEFAULT_FILTERS: FindingFilters = {
  status: 'open',
  repo: null,
  severities: [],
  categories: [],
  kinds: [],
  personalData: false,
  q: '',
  sort: 'severity',
};

export function matchesStatus(f: FindingView, view: StatusView): boolean {
  if (view === 'all') return true;
  if (view === 'new') return f.status === 'open' && f.new_last_run;
  return f.status === (view satisfies FindingStatus);
}

const haystack = (f: FindingView) => `${f.title} ${f.file} ${f.description} ${f.fingerprint} ${f.repo}`.toLowerCase();

// Everything but the status: the status tabs show how many findings each would hold under the other filters.
export function matchesScope(f: FindingView, filters: FindingFilters): boolean {
  if (filters.repo && f.repo !== filters.repo) return false;
  if (filters.severities.length && !filters.severities.includes(f.severity)) return false;
  if (filters.categories.length && !filters.categories.includes(f.category)) return false;
  if (filters.kinds.length && !filters.kinds.includes(f.kind ?? 'unset')) return false;
  if (filters.personalData && !f.personal_data) return false;
  const q = filters.q.trim().toLowerCase();
  return !q || haystack(f).includes(q);
}

const byLocation = (a: FindingView, b: FindingView) => a.repo.localeCompare(b.repo) || a.file.localeCompare(b.file) || a.line - b.line;

const SORTS: Record<SortKey, (a: FindingView, b: FindingView) => number> = {
  severity: (a, b) => severityRank(a.severity) - severityRank(b.severity) || byLocation(a, b),
  newest: (a, b) => b.first_seen.localeCompare(a.first_seen) || severityRank(a.severity) - severityRank(b.severity),
  location: byLocation,
};

export function applyFilters(all: FindingView[], filters: FindingFilters): FindingView[] {
  return all.filter((f) => matchesStatus(f, filters.status) && matchesScope(f, filters)).sort(SORTS[filters.sort]);
}

export function countBy<K extends string>(items: FindingView[], key: (f: FindingView) => K): Record<K, number> {
  const out = {} as Record<K, number>;
  for (const f of items) out[key(f)] = (out[key(f)] ?? 0) + 1;
  return out;
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

export function describeScope(filters: FindingFilters): string {
  const status = filters.status === 'new' ? 'new in the last run' : filters.status === 'all' ? 'any status' : filters.status;
  return [
    `repository: ${filters.repo ?? 'all'}`,
    `status: ${status}`,
    filters.severities.length ? `severity: ${filters.severities.join(', ')}` : null,
    filters.kinds.length ? `type: ${filters.kinds.map((k) => (k === 'unset' ? 'not classified' : KIND_LABEL[k])).join(', ')}` : null,
    filters.categories.length ? `category: ${filters.categories.join(', ')}` : null,
    filters.personalData ? 'personal data only' : null,
    filters.q ? `search: "${filters.q}"` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}
