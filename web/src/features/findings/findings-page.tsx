import { MousePointerClick, SearchX } from 'lucide-react';
import { useCallback, useDeferredValue, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { PageHeader } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Kbd } from '@/components/ui/kbd';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { RunLaunchButton } from '@/features/runs/run-launch-dialog';
import { useFindingsView } from '@/hooks/use-findings-view';
import { useHotkeys } from '@/hooks/use-hotkeys';
import { useIsWide } from '@/hooks/use-media-query';
import { useOverview } from '@/hooks/use-overview';
import { applyView, describeScope, findingsHref } from '@/lib/findings-view';
import { plural } from '@/lib/format';
import { QUEUE_HELP, QUEUE_LABEL } from '@/lib/queues';
import { facetCounts, queueCounts, speculativeScope, validationScope } from '@/lib/selectors';
import type { FindingView } from '@/lib/types';
import { BulkBar } from './bulk-bar';
import { DiscardedTable } from './discarded-table';
import { ExportMenu } from './export-menu';
import { FilterBar } from './filter-bar';
import { FindingDetail } from './finding-detail';
import { FindingList, findingKey } from './finding-list';
import { QueueTabs } from './queue-tabs';

function NothingListed({ empty, onReset }: { empty: boolean; onReset: () => void }) {
  return (
    <Empty className="flex-1">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <SearchX />
        </EmptyMedia>
        <EmptyTitle>No findings here</EmptyTitle>
        <EmptyDescription>{empty ? 'Nothing is waiting in this queue. Nice.' : 'Try another queue or clear the filters.'}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button variant="outline" size="sm" onClick={onReset}>
          Clear filters
        </Button>
      </EmptyContent>
    </Empty>
  );
}

function PickAFinding() {
  return (
    <Empty className="h-full">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <MousePointerClick />
        </EmptyMedia>
        <EmptyTitle>Pick a finding to review</EmptyTitle>
        <EmptyDescription>
          <Kbd>J</Kbd> and <Kbd>K</Kbd> move through the list, <Kbd>Space</Kbd> selects, <Kbd>/</Kbd> searches. On a finding, <Kbd>C</Kbd> confirms,{' '}
          <Kbd>X</Kbd> marks it not a bug and <Kbd>O</Kbd> opens it in VS Code. <Kbd>?</Kbd> lists every shortcut.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

// Keeps only the keys still listed, so a finding that leaves the list leaves the selection too.
const prune = (selection: ReadonlySet<string>, listed: FindingView[]) => {
  const keys = new Set(listed.map(findingKey));
  return new Set([...selection].filter((k) => keys.has(k)));
};

export function FindingsPage() {
  const ov = useOverview();
  const { view, update, reset } = useFindingsView();
  const searchRef = useRef<HTMLInputElement>(null);
  const wide = useIsWide();
  // Typing in the search box stays responsive while the list catches up.
  const deferred = useDeferredValue(view);

  const shown = useMemo(() => applyView(ov.findings, deferred), [ov.findings, deferred]);
  const counts = useMemo(() => queueCounts(ov.findings, deferred), [ov.findings, deferred]);
  const facets = useMemo(() => facetCounts(ov.findings, deferred), [ov.findings, deferred]);
  const discarded = useMemo(() => {
    const q = view.q.toLowerCase();
    return ov.discarded.filter((d) => (!view.repo || d.repo === view.repo) && (!q || `${d.title} ${d.file} ${d.reason}`.toLowerCase().includes(q)));
  }, [ov.discarded, view.repo, view.q]);

  const [selection, setSelection] = useState<ReadonlySet<string>>(new Set());
  const [outcome, setOutcome] = useState<string | null>(null);
  const pruned = useMemo(() => prune(selection, shown), [selection, shown]);
  if (pruned.size !== selection.size) setSelection(pruned);
  const selected = useMemo(() => shown.filter((f) => pruned.has(findingKey(f))), [shown, pruned]);

  // Read through refs so the toggle keeps its identity and the memoized rows do not re-render on every change.
  const anchor = useRef<string | null>(null);
  const listed = useRef(shown);
  useLayoutEffect(() => {
    listed.current = shown;
  }, [shown]);
  const toggle = useCallback((f: FindingView, range: boolean) => {
    const key = findingKey(f);
    const list = listed.current;
    const from = anchor.current ? list.findIndex((x) => findingKey(x) === anchor.current) : -1;
    const to = list.indexOf(f);
    setSelection((prev) => {
      const next = new Set(prev);
      if (range && from >= 0 && to >= 0) {
        for (const x of list.slice(Math.min(from, to), Math.max(from, to) + 1)) next.add(findingKey(x));
      } else if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    anchor.current = key;
    setOutcome(null);
  }, []);

  const current = view.id ? ov.findings.find((f) => f.fingerprint === view.id) : undefined;
  const index = current ? shown.indexOf(current) : -1;
  const select = useCallback((id: string | null) => update({ id }, { replace: true }), [update]);
  const step = (delta: number) => {
    if (!shown.length) return;
    const next = index < 0 ? 0 : Math.min(shown.length - 1, Math.max(0, index + delta));
    select(shown[next]?.fingerprint ?? null);
  };

  useHotkeys(
    {
      next: () => step(1),
      previous: () => step(-1),
      search: () => searchRef.current?.focus(),
      close: () => select(null),
      ...(current && index >= 0 ? { select: () => toggle(current, false) } : {}),
    },
    { enabled: !view.discarded },
  );

  const scope = describeScope(view);
  const triage = view.queue === 'triage' && !view.discarded;
  const validation = triage ? validationScope(ov.repos, view.repo) : null;
  const speculative = triage ? speculativeScope(ov.findings, view.repo) : null;

  const detail = current ? (
    <FindingDetail
      key={findingKey(current)}
      finding={current}
      position={index >= 0 ? { index, total: shown.length } : null}
      tab={view.tab}
      onTab={(tab) => update({ tab }, { replace: true })}
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
            view.discarded
              ? 'Candidates the verifier rejected in the last 7 days. They are not in the history; if one looks real, check the code.'
              : `${plural(shown.length, 'finding')} · ${QUEUE_HELP[view.queue]}`
          }
          actions={
            view.discarded ? null : (
              <>
                {validation ? <RunLaunchButton kind="validate" scope={validation} size="sm" /> : null}
                {speculative ? <RunLaunchButton kind="speculative" scope={speculative} size="sm" /> : null}
                <ExportMenu findings={shown} scope={scope} repos={ov.repos.filter((r) => !view.repo || r.name === view.repo)} repoName={view.repo} />
              </>
            )
          }
        />
        <QueueTabs
          value={view.discarded ? null : view.queue}
          counts={counts}
          discardedCount={discarded.length}
          discardedHref={findingsHref({ discarded: true, repo: view.repo, q: view.q })}
          onChange={(queue) => update({ queue, discarded: false, id: null })}
        />
        <FilterBar
          searchRef={searchRef}
          view={view}
          repos={ov.repos.map((r) => r.name)}
          counts={facets}
          onChange={(patch) => update(patch, { replace: 'q' in patch })}
          onReset={reset}
        />
        {selected.length ? <BulkBar findings={selected} repos={ov.repos} onClear={() => setSelection(new Set())} onOutcome={setOutcome} /> : null}
        {outcome ? (
          <p role="status" className="text-xs text-muted-foreground">
            {outcome}
          </p>
        ) : null}
      </div>

      {view.discarded ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-4 md:px-6">
          <DiscardedTable discarded={discarded} />
        </div>
      ) : shown.length === 0 ? (
        <NothingListed empty={counts[view.queue] === 0 && !view.q} onReset={reset} />
      ) : (
        <div className="grid min-h-0 flex-1 lg:grid-cols-5">
          <section aria-label={`${QUEUE_LABEL[view.queue]} queue`} className="min-h-0 overflow-y-auto lg:col-span-2 lg:border-r">
            <FindingList
              findings={shown}
              selected={view.id}
              checked={pruned}
              showRepo={!view.repo}
              showStatus={view.queue === 'all' || view.queue === 'closed' || view.queue === 'triage'}
              onToggle={toggle}
            />
          </section>
          {wide ? <div className="min-h-0 lg:col-span-3">{detail ?? <PickAFinding />}</div> : null}
        </div>
      )}

      {!wide ? (
        <Sheet open={!!current && !view.discarded} onOpenChange={(open) => !open && select(null)}>
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
