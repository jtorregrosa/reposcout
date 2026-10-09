import { CATEGORIES, KIND_LABEL, KINDS, SEVERITIES, STAGE_LABEL, STAGES, STATUS_LABEL, severityRank } from './domain';
import { inQueue, QUEUE_LABEL, QUEUE_VIEWS, type QueueView } from './queues';
import type { Category, FindingStatus, FindingView, Severity, Stage } from './types';

export const STATUSES = ['open', 'speculative', 'suppressed', 'resolved', 'refuted', 'duplicate'] as const satisfies readonly FindingStatus[];

// 'unset' finds what no audit or backfill has labelled yet.
export type KindFilter = (typeof KINDS)[number] | 'unset';
export const KIND_FILTERS: KindFilter[] = [...KINDS, 'unset'];

export const SORT_KEYS = ['severity', 'newest', 'location'] as const;
export type SortKey = (typeof SORT_KEYS)[number];

export const DETAIL_TABS = ['overview', 'evidence', 'history'] as const;
export type DetailTab = (typeof DETAIL_TABS)[number];

export interface FindingsView {
  queue: QueueView;
  repo: string | null;
  severities: Severity[];
  categories: Category[];
  kinds: KindFilter[];
  stages: Stage[];
  statuses: FindingStatus[];
  newOnly: boolean;
  personalData: boolean;
  q: string;
  sort: SortKey;
  id: string | null;
  tab: DetailTab;
  discarded: boolean;
}

export const DEFAULT_VIEW: FindingsView = {
  queue: 'triage',
  repo: null,
  severities: [],
  categories: [],
  kinds: [],
  stages: [],
  statuses: [],
  newOnly: false,
  personalData: false,
  q: '',
  sort: 'severity',
  id: null,
  tab: 'overview',
  discarded: false,
};

const list = <T extends string>(raw: string | null, allowed: readonly T[]): T[] => {
  const values = (raw ?? '').split(',');
  return allowed.filter((v) => values.includes(v));
};

const one = <T extends string>(raw: string | null, allowed: readonly T[], fallback: T): T => (allowed.includes(raw as T) ? (raw as T) : fallback);

// Values the URL does not know are dropped, so an old or hand-edited link still opens a valid view. Links from
// before the queues carried a status tab: they open All with that status as a filter.
export function parseFindingsView(params: URLSearchParams): FindingsView {
  const rawStatus = params.get('status');
  const legacyNew = rawStatus === 'new';
  const statuses = list(rawStatus, STATUSES);
  const legacy = !params.has('queue') && rawStatus != null;
  return {
    queue: legacy ? 'all' : one(params.get('queue'), QUEUE_VIEWS, DEFAULT_VIEW.queue),
    repo: params.get('repo') || null,
    severities: list(params.get('severity'), SEVERITIES),
    categories: list(params.get('category'), CATEGORIES),
    kinds: list(params.get('kind'), KIND_FILTERS),
    stages: list(params.get('stage'), STAGES),
    statuses,
    newOnly: legacyNew || params.get('new') === '1',
    personalData: params.get('pd') === '1',
    q: params.get('q') ?? '',
    sort: one(params.get('sort'), SORT_KEYS, DEFAULT_VIEW.sort),
    id: params.get('id') || null,
    tab: one(params.get('tab'), DETAIL_TABS, DEFAULT_VIEW.tab),
    discarded: params.get('view') === 'discarded',
  };
}

// Writes only what differs from the default, in the current form, so links stay short and stable.
export function serializeFindingsView(view: Partial<FindingsView>): URLSearchParams {
  const v = { ...DEFAULT_VIEW, ...view };
  const p = new URLSearchParams();
  const set = (key: string, value: string | null, fallback?: string) => {
    if (value && value !== fallback) p.set(key, value);
  };
  set('view', v.discarded ? 'discarded' : null);
  set('queue', v.queue, DEFAULT_VIEW.queue);
  set('repo', v.repo);
  set('severity', v.severities.join(','));
  set('category', v.categories.join(','));
  set('kind', v.kinds.join(','));
  set('stage', v.stages.join(','));
  set('status', v.statuses.join(','));
  set('new', v.newOnly ? '1' : null);
  set('pd', v.personalData ? '1' : null);
  set('q', v.q);
  set('sort', v.sort, DEFAULT_VIEW.sort);
  set('id', v.id);
  set('tab', v.tab, DEFAULT_VIEW.tab);
  return p;
}

export function findingsHref(view: Partial<FindingsView> = {}): string {
  const qs = serializeFindingsView(view).toString();
  return `/findings${qs ? `?${qs}` : ''}`;
}

export type Facet = 'severities' | 'categories' | 'kinds' | 'stages' | 'statuses' | 'newOnly' | 'personalData';

const haystack = (f: FindingView) => `${f.title} ${f.file} ${f.description} ${f.fingerprint} ${f.repo}`.toLowerCase();

// Every filter but the queue, optionally releasing one facet so its own options can be counted.
export function matchesFilters(f: FindingView, v: FindingsView, release?: Facet): boolean {
  if (v.repo && f.repo !== v.repo) return false;
  if (release !== 'severities' && v.severities.length && !v.severities.includes(f.severity)) return false;
  if (release !== 'categories' && v.categories.length && !v.categories.includes(f.category)) return false;
  if (release !== 'kinds' && v.kinds.length && !v.kinds.includes(f.kind ?? 'unset')) return false;
  if (release !== 'stages' && v.stages.length && !v.stages.includes(f.stage)) return false;
  if (release !== 'statuses' && v.statuses.length && !v.statuses.includes(f.status)) return false;
  if (release !== 'newOnly' && v.newOnly && !(f.status === 'open' && f.new_last_run)) return false;
  if (release !== 'personalData' && v.personalData && !f.personal_data) return false;
  const q = v.q.trim().toLowerCase();
  return !q || haystack(f).includes(q);
}

const byLocation = (a: FindingView, b: FindingView) => a.repo.localeCompare(b.repo) || a.file.localeCompare(b.file) || a.line - b.line;

const SORTS: Record<SortKey, (a: FindingView, b: FindingView) => number> = {
  severity: (a, b) => severityRank(a.severity) - severityRank(b.severity) || byLocation(a, b),
  newest: (a, b) => b.first_seen.localeCompare(a.first_seen) || severityRank(a.severity) - severityRank(b.severity),
  location: byLocation,
};

export function applyView(all: FindingView[], v: FindingsView): FindingView[] {
  return all.filter((f) => inQueue(f, v.queue) && matchesFilters(f, v)).sort(SORTS[v.sort]);
}

export const SORT_LABEL: Record<SortKey, string> = { severity: 'Most severe first', newest: 'Newest first', location: 'By file' };

// One removable entry per active filter beyond search, repository and severity, which have their own controls.
export interface Chip {
  key: string;
  label: string;
  patch: Partial<FindingsView>;
}

export function filterChips(v: FindingsView): Chip[] {
  const chips: Chip[] = [];
  const each = <T extends string>(facet: 'kinds' | 'categories' | 'stages' | 'statuses', values: T[], name: string, label: (x: T) => string) => {
    for (const x of values) chips.push({ key: `${facet}:${x}`, label: `${name}: ${label(x)}`, patch: { [facet]: values.filter((y) => y !== x) } });
  };
  each('kinds', v.kinds, 'Type', (k) => (k === 'unset' ? 'not classified' : KIND_LABEL[k]));
  each('categories', v.categories, 'Category', (c) => c);
  each('stages', v.stages, 'Stage', (s) => STAGE_LABEL[s].toLowerCase());
  each('statuses', v.statuses, 'Status', (s) => STATUS_LABEL[s].toLowerCase());
  if (v.newOnly) chips.push({ key: 'new', label: 'New in the last run', patch: { newOnly: false } });
  if (v.personalData) chips.push({ key: 'pd', label: 'Personal data', patch: { personalData: false } });
  return chips;
}

export const isFiltered = (v: FindingsView) =>
  !!(v.repo || v.severities.length || v.q || filterChips(v).length || v.sort !== DEFAULT_VIEW.sort || v.queue !== DEFAULT_VIEW.queue);

export function describeScope(v: FindingsView): string {
  return [
    `repository: ${v.repo ?? 'all'}`,
    `queue: ${QUEUE_LABEL[v.queue].toLowerCase()}`,
    v.statuses.length ? `status: ${v.statuses.join(', ')}` : null,
    v.newOnly ? 'new in the last run' : null,
    v.severities.length ? `severity: ${v.severities.join(', ')}` : null,
    v.kinds.length ? `type: ${v.kinds.map((k) => (k === 'unset' ? 'not classified' : KIND_LABEL[k])).join(', ')}` : null,
    v.categories.length ? `category: ${v.categories.join(', ')}` : null,
    v.stages.length ? `stage: ${v.stages.map((s) => STAGE_LABEL[s].toLowerCase()).join(', ')}` : null,
    v.personalData ? 'personal data only' : null,
    v.q ? `search: "${v.q}"` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}
