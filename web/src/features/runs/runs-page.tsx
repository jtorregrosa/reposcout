import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useParams } from 'react-router';
import { useRun } from '@/app/live';
import { Page, PageHeader } from '@/components/page';
import { ErrorAlert, LoadingPage } from '@/components/query-state';
import { SubscriptionCard } from '@/components/subscription-card';
import { Elapsed } from '@/components/time';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { useOverview } from '@/hooks/use-overview';
import { useRunInProgress } from '@/hooks/use-run-in-progress';
import { modeShort } from '@/lib/domain';
import { formatDateTime, runLabel } from '@/lib/format';
import { applyEvents, emptyLive, exitMeaning, type LiveState } from '@/lib/live';
import { runEventsQuery } from '@/lib/queries';
import { runHistory } from '@/lib/selectors';
import { CancelRun } from './cancel-run';
import { NewAuditButton } from './new-audit';
import { ActivityPanel } from './panels/activity-panel';
import { AgentsPanel } from './panels/agents-panel';
import { DenialsPanel } from './panels/denials-panel';
import { RepositoriesPanel } from './panels/repositories-panel';
import { RunHistoryList } from './run-history-list';
import { RunStatusBadge } from './run-status-badge';

function RunHeader({ live }: { live: LiveState }) {
  return (
    <Card>
      <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">Status</div>
          <div className="flex flex-wrap items-center gap-2">
            <RunStatusBadge live={live} />
            {live.prepareOnly ? <Badge variant="outline">prepare only</Badge> : null}
          </div>
        </div>
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">Started</div>
          <div className="text-sm">{formatDateTime(live.startedAt)}</div>
        </div>
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">{live.active ? 'Elapsed' : 'Duration'}</div>
          <div className="text-sm">
            <Elapsed from={live.startedAt} to={live.finishedAt} running={live.active} />
          </div>
        </div>
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">{live.active ? 'Now auditing' : 'Outcome'}</div>
          <div className="text-sm">{live.active ? (live.current ?? '—') : (exitMeaning(live.exit) ?? 'no outcome recorded')}</div>
        </div>
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">Blocked tool calls</div>
          <div className="text-sm tabular-nums">{live.denials.length}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function RunView({ live, showSubscription, rate }: { live: LiveState; showSubscription: boolean; rate: Parameters<typeof SubscriptionCard>[0]['rate'] }) {
  return (
    <>
      <RunHeader live={live} />
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="flex flex-col gap-4 xl:col-span-2">
          <RepositoriesPanel live={live} />
          <AgentsPanel live={live} />
        </div>
        <div className="flex flex-col gap-4">
          {showSubscription ? <SubscriptionCard rate={rate} /> : null}
          <ActivityPanel live={live} />
        </div>
      </div>
      <DenialsPanel live={live} />
    </>
  );
}

// A past run, replayed from its event log once it has loaded.
function PastRun({ runId }: { runId: string }) {
  const { data, isLoading, error } = useQuery(runEventsQuery(runId));
  const live = useMemo(() => (data ? applyEvents(emptyLive(runId), data) : null), [runId, data]);
  if (isLoading) return <LoadingPage />;
  if (error) return <ErrorAlert title="Could not load that run" error={error} />;
  return live ? <RunView live={live} showSubscription={false} rate={null} /> : null;
}

export function RunsPage() {
  const { runId } = useParams();
  const ov = useOverview();
  const current = useRun();
  const running = useRunInProgress();
  const history = useMemo(() => runHistory(ov), [ov]);
  const title = runId ? runLabel(runId) : current.runId ? runLabel(current.runId) : null;

  return (
    <Page>
      <PageHeader
        title="Runs"
        description={
          runId
            ? `${title}, replayed from its event log.`
            : current.active
              ? `${current.mode ? modeShort(current.mode) : 'A run'} in progress since ${formatDateTime(current.startedAt)}.`
              : 'The latest run, and every run on record.'
        }
        actions={
          <>
            {running && !runId ? <CancelRun runId={current.runId} /> : null}
            <NewAuditButton />
          </>
        }
      />
      <div className="grid gap-6 lg:grid-cols-4">
        <RunHistoryList runs={history} selected={runId ?? null} liveRunId={current.runId} active={current.active} />
        <div className="flex min-w-0 flex-col gap-4 lg:col-span-3">
          {runId ? (
            <PastRun runId={runId} />
          ) : current.runId ? (
            <RunView live={current} showSubscription rate={current.rateLimit ?? ov.rate_limit} />
          ) : (
            <p className="text-sm text-muted-foreground">No run recorded yet. Start one with New audit.</p>
          )}
        </div>
      </div>
    </Page>
  );
}
