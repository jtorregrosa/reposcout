import { useQuery } from '@tanstack/react-query';
import { History } from 'lucide-react';
import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useLive } from '@/app/live';
import { Page, PageHeader } from '@/components/page';
import { ErrorAlert, LoadingPage } from '@/components/query-state';
import { SubscriptionCard } from '@/components/subscription-card';
import { Elapsed } from '@/components/time';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useOverview } from '@/hooks/use-overview';
import { api } from '@/lib/api';
import { formatDateTime, runLabel } from '@/lib/format';
import { applyEvents, emptyLive, exitMeaning, type LiveState } from '@/lib/live';
import { CancelRun } from './cancel-run';
import { ActivityPanel, AgentsPanel, DenialsPanel, RepositoriesPanel } from './run-panels';
import { RunStatusBadge } from './run-status-badge';
import { StartAuditDialog } from './start-audit-dialog';

const LIVE = '__live';

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

export function RunsPage() {
  const { runId } = useParams();
  const navigate = useNavigate();
  const { data: ov, isLoading, error } = useOverview();
  const { live: current } = useLive();
  const past = useQuery({ queryKey: ['run-events', runId], queryFn: () => api.runEvents(runId as string), enabled: !!runId });
  const viewed = useMemo(() => (runId && past.data ? applyEvents(emptyLive(runId), past.data) : null), [runId, past.data]);
  const live = runId ? viewed : current;
  const running = current.active || !!ov?.active;

  if (isLoading) {
    return (
      <Page>
        <LoadingPage />
      </Page>
    );
  }
  if (error || !ov) {
    return (
      <Page>
        <ErrorAlert error={error} />
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader
        title="Runs"
        description={runId ? 'A recorded run, replayed from its event log.' : 'The run in progress, or the latest one.'}
        actions={
          <>
            <Select value={runId ?? LIVE} onValueChange={(v) => navigate(v === LIVE ? '/runs' : `/runs/${encodeURIComponent(v)}`)}>
              <SelectTrigger className="w-64" aria-label="Run to show">
                <History />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={LIVE}>Current or latest run</SelectItem>
                {ov.runs.map((r) => (
                  <SelectItem key={r.run_id} value={r.run_id}>
                    {runLabel(r.run_id)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {running && !runId ? <CancelRun runId={current.runId} /> : null}
            <StartAuditDialog repos={ov.repos} disabled={running} />
          </>
        }
      />

      {past.isLoading ? <LoadingPage /> : null}
      {past.error ? <ErrorAlert title="Could not load that run" error={past.error} /> : null}

      {live ? (
        <>
          <RunHeader live={live} />
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="flex flex-col gap-4 lg:col-span-2">
              <RepositoriesPanel live={live} />
              <AgentsPanel live={live} />
            </div>
            <div className="flex flex-col gap-4">
              {!runId ? <SubscriptionCard rate={live.rateLimit ?? ov.rate_limit} /> : null}
              <ActivityPanel live={live} />
            </div>
          </div>
          <DenialsPanel live={live} />
        </>
      ) : null}
    </Page>
  );
}
