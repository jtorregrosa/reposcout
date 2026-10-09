import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { CATEGORIES, KINDS, SEVERITIES } from '@/lib/domain';
import { DEFAULT_FILTERS, type FindingFilters, type KindFilter, type SortKey, STATUS_VIEWS, type StatusView } from '@/lib/findings';
import type { Category, Severity } from '@/lib/types';

const list = <T extends string>(raw: string | null, allowed: readonly T[]): T[] =>
  (raw ?? '').split(',').filter((v): v is T => (allowed as readonly string[]).includes(v));

const SORTS: SortKey[] = ['severity', 'newest', 'location'];

// The filters and the selected finding live in the URL, so a view can be bookmarked, shared with another auditor,
// and walked back with the browser's back button.
export function useFindingFilters() {
  const [params, setParams] = useSearchParams();

  const filters = useMemo<FindingFilters>(() => {
    const status = params.get('status');
    const sort = params.get('sort');
    return {
      status: STATUS_VIEWS.includes(status as StatusView) ? (status as StatusView) : DEFAULT_FILTERS.status,
      repo: params.get('repo') || null,
      severities: list<Severity>(params.get('severity'), SEVERITIES),
      categories: list<Category>(params.get('category'), CATEGORIES),
      kinds: list<KindFilter>(params.get('kind'), [...KINDS, 'unset']),
      personalData: params.get('pd') === '1',
      q: params.get('q') ?? '',
      sort: SORTS.includes(sort as SortKey) ? (sort as SortKey) : DEFAULT_FILTERS.sort,
    };
  }, [params]);

  const selected = params.get('id');

  const update = useCallback(
    (patch: Partial<FindingFilters> & { id?: string | null }, { replace = false } = {}) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          const set = (key: string, value: string | null | undefined, fallback?: string) => {
            if (!value || value === fallback) next.delete(key);
            else next.set(key, value);
          };
          if ('status' in patch) set('status', patch.status, DEFAULT_FILTERS.status);
          if ('repo' in patch) set('repo', patch.repo);
          if ('severities' in patch) set('severity', patch.severities?.join(','));
          if ('categories' in patch) set('category', patch.categories?.join(','));
          if ('kinds' in patch) set('kind', patch.kinds?.join(','));
          if ('personalData' in patch) set('pd', patch.personalData ? '1' : null);
          if ('q' in patch) set('q', patch.q);
          if ('sort' in patch) set('sort', patch.sort, DEFAULT_FILTERS.sort);
          if ('id' in patch) set('id', patch.id);
          return next;
        },
        { replace },
      );
    },
    [setParams],
  );

  const reset = useCallback(() => setParams(new URLSearchParams()), [setParams]);

  return { filters, selected, update, reset };
}

export function findingsHref(patch: Partial<Record<'status' | 'repo' | 'severity' | 'category' | 'kind' | 'pd' | 'id', string>>): string {
  const p = new URLSearchParams(Object.entries(patch).filter((e): e is [string, string] => !!e[1]));
  const qs = p.toString();
  return `/findings${qs ? `?${qs}` : ''}`;
}
