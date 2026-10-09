import { MousePointerClick, SearchX } from 'lucide-react';
import { useCallback, useDeferredValue, useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router';
import { PageHeader } from '@/components/page';
import { ErrorAlert, LoadingPage } from '@/components/query-state';
import { Button } from '@/components/ui/button';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Kbd } from '@/components/ui/kbd';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useFindingFilters } from '@/hooks/use-finding-filters';
import { useIsWide } from '@/hooks/use-media-query';
import { useOverview } from '@/hooks/use-overview';
import { STATUS_LABEL } from '@/lib/domain';
import { applyFilters, countBy, describeScope, matchesScope, matchesStatus, STATUS_VIEWS, type StatusView } from '@/lib/findings';
import { plural } from '@/lib/format';
import type { FindingView } from '@/lib/types';
import { DiscardedTable } from './discarded-table';
import { ExportMenu } from './export-menu';
import { FindingDetail } from './finding-detail';
import { FindingFiltersBar } from './finding-filters';
import { FindingList } from './finding-list';

const VIEW_LABEL: Record<StatusView, string> = { ...STATUS_LABEL, new: 'New', all: 'All' };
const DISCARDED = 'discarded';

const typingInField = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

export function FindingsPage() {
  const { data, isLoading, error } = useOverview();
  const { filters, selected, update, reset } = useFindingFilters();
  const [params, setParams] = useSearchParams();
  const discardedView = params.get('view') === DISCARDED;
  const searchRef = useRef<HTMLInputElement>(null);
  const wide = useIsWide();
  // Typing in the search box stays responsive while the list catches up.
  const deferred = useDeferredValue(filters);

  const all = data?.findings ?? [];
  const inScope = useMemo(() => all.filter((f) => matchesScope(f, deferred)), [all, deferred]);
  const shown = useMemo(() => applyFilters(all, deferred), [all, deferred]);
  const statusCounts = useMemo(
    () => Object.fromEntries(STATUS_VIEWS.map((v) => [v, inScope.filter((f) => matchesStatus(f, v)).length])) as Record<StatusView, number>,
    [inScope],
  );
  const inStatus = useMemo(() => all.filter((f) => matchesStatus(f, deferred.status)), [all, deferred.status]);
  const severityCounts = useMemo(
    () =>
      countBy(
        inStatus.filter((f) => matchesScope(f, { ...deferred, severities: [] })),
        (f) => f.severity,
      ),
    [inStatus, deferred],
  );
  const categoryCounts = useMemo(
    () =>
      countBy(
        inStatus.filter((f) => matchesScope(f, { ...deferred, categories: [] })),
        (f) => f.category,
      ),
    [inStatus, deferred],
  );
  const kindCounts = useMemo(
    () =>
      countBy(
        inStatus.filter((f) => matchesScope(f, { ...deferred, kinds: [] })),
        (f) => f.kind ?? 'unset',
      ),
    [inStatus, deferred],
  );
  const personalDataCount = useMemo(
    () => inStatus.filter((f) => f.personal_data && matchesScope(f, { ...deferred, personalData: false })).length,
    [inStatus, deferred],
  );
  const discarded = useMemo(
    () =>
      (data?.discarded ?? []).filter(
        (d) => (!filters.repo || d.repo === filters.repo) && (!filters.q || `${d.title} ${d.file} ${d.reason}`.toLowerCase().includes(filters.q.toLowerCase())),
      ),
    [data, filters.repo, filters.q],
  );

  const current: FindingView | undefined = selected ? all.find((f) => f.fingerprint === selected) : undefined;
  const index = current ? shown.indexOf(current) : -1;

  const select = useCallback((id: string | null) => update({ id }, { replace: true }), [update]);
  const step = useCallback(
    (delta: number) => {
      if (!shown.length) return;
      const next = index < 0 ? 0 : Math.min(shown.length - 1, Math.max(0, index + delta));
      select(shown[next]?.fingerprint ?? null);
    },
    [index, shown, select],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === '/' && !typingInField(e.target)) {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (typingInField(e.target) || document.querySelector('[role="dialog"]')) return;
      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault();
        step(1);
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault();
        step(-1);
      } else if (e.key === 'Escape' && selected) select(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step, select, selected]);

  if (isLoading) {
    return (
      <div className="p-6">
        <LoadingPage />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="p-6">
        <ErrorAlert error={error} />
      </div>
    );
  }

  const setView = (view: string) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('id');
      if (view === DISCARDED) next.set('view', DISCARDED);
      else {
        next.delete('view');
        if (view === 'open') next.delete('status');
        else next.set('status', view);
      }
      return next;
    });
  };

  const detail = current ? (
    <FindingDetail
      finding={current}
      position={index >= 0 ? { index, total: shown.length } : null}
      onPrevious={() => step(-1)}
      onNext={() => step(1)}
      onClose={() => select(null)}
    />
  ) : null;

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-4 border-b p-4 md:px-6">
        <PageHeader
          title="Findings"
          description={
            discardedView
              ? 'Candidates the verifier rejected in the last 7 days. They are not in the history; if one looks real, check the code.'
              : `${plural(shown.length, 'finding')} · ${describeScope(filters)}`
          }
          actions={
            discardedView ? null : (
              <ExportMenu
                findings={shown}
                scope={describeScope(filters)}
                repos={data.repos.filter((r) => !filters.repo || r.name === filters.repo)}
                repoName={filters.repo}
              />
            )
          }
        />
        <Tabs value={discardedView ? DISCARDED : filters.status} onValueChange={setView}>
          <TabsList className="h-auto flex-wrap">
            {STATUS_VIEWS.map((v) => (
              <TabsTrigger key={v} value={v} className="gap-1.5">
                {VIEW_LABEL[v]}
                <span className="text-xs tabular-nums text-muted-foreground">{statusCounts[v]}</span>
              </TabsTrigger>
            ))}
            <TabsTrigger value={DISCARDED} className="gap-1.5">
              Discarded by verifier
              <span className="text-xs tabular-nums text-muted-foreground">{discarded.length}</span>
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <FindingFiltersBar
          ref={searchRef}
          filters={filters}
          repos={data.repos.map((r) => r.name)}
          severityCounts={severityCounts}
          categoryCounts={categoryCounts}
          kindCounts={kindCounts}
          personalDataCount={personalDataCount}
          onChange={(patch) => update(patch, { replace: 'q' in patch })}
          onReset={reset}
        />
      </div>

      {discardedView ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-4 md:px-6">
          <DiscardedTable discarded={discarded} />
        </div>
      ) : shown.length === 0 ? (
        <Empty className="flex-1">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SearchX />
            </EmptyMedia>
            <EmptyTitle>No findings match</EmptyTitle>
            <EmptyDescription>
              {filters.status === 'open' && !inScope.length ? 'Nothing open in this scope. Nice.' : 'Try another status tab or clear the filters.'}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" size="sm" onClick={reset}>
              Clear filters
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <div className="grid min-h-0 flex-1 lg:grid-cols-5">
          <div className="min-h-0 overflow-y-auto lg:col-span-2 lg:border-r">
            <FindingList findings={shown} selected={selected} showRepo={!filters.repo} showStatus={filters.status === 'all' || filters.status === 'new'} />
          </div>
          <div className="hidden min-h-0 lg:col-span-3 lg:block">
            {detail ?? (
              <Empty className="h-full">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <MousePointerClick />
                  </EmptyMedia>
                  <EmptyTitle>Pick a finding to review</EmptyTitle>
                  <EmptyDescription>
                    Use <Kbd>J</Kbd> and <Kbd>K</Kbd> to move through the list, <Kbd>/</Kbd> to search, <Kbd>Esc</Kbd> to close.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
          </div>
        </div>
      )}

      {!wide ? (
        <Sheet open={!!current && !discardedView} onOpenChange={(open) => !open && select(null)}>
          <SheetContent
            side="right"
            showCloseButton={false}
            onOpenAutoFocus={(e) => e.preventDefault()}
            className="gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-xl"
          >
            <SheetTitle className="sr-only">{current?.title ?? 'Finding'}</SheetTitle>
            {detail}
          </SheetContent>
        </Sheet>
      ) : null}
    </div>
  );
}
