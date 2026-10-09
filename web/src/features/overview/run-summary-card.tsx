import { Activity, ArrowRight } from 'lucide-react';
import { Link } from 'react-router';
import { Elapsed } from '@/components/time';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { RunStatusBadge } from '@/features/runs/run-status-badge';
import { formatDateTime, runLabel } from '@/lib/format';
import { exitMeaning, type LiveState } from '@/lib/live';

export function RunSummaryCard({ live }: { live: LiveState }) {
  const done = [...live.repos.values()].filter((r) => r.stage === 'done').length;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="size-4 text-muted-foreground" />
          {live.active ? 'Audit in progress' : 'Latest run'}
        </CardTitle>
        <CardDescription>{live.runId ? runLabel(live.runId) : 'No run recorded yet.'}</CardDescription>
        <CardAction>
          <div className="flex gap-1">
            {live.prepareOnly ? <Badge variant="outline">prepare only</Badge> : null}
            <RunStatusBadge live={live} />
          </div>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {live.runId ? (
          <dl className="grid grid-cols-2 gap-y-1">
            <dt className="text-muted-foreground">Started</dt>
            <dd>{formatDateTime(live.startedAt)}</dd>
            <dt className="text-muted-foreground">{live.active ? 'Elapsed' : 'Duration'}</dt>
            <dd>
              <Elapsed from={live.startedAt} to={live.finishedAt} running={live.active} />
            </dd>
            <dt className="text-muted-foreground">Repositories</dt>
            <dd>
              {done} of {live.repos.size} done{live.current && live.active ? ` · now ${live.current}` : ''}
            </dd>
            {!live.active && live.exit != null ? (
              <>
                <dt className="text-muted-foreground">Outcome</dt>
                <dd>{exitMeaning(live.exit)}</dd>
              </>
            ) : null}
          </dl>
        ) : null}
        <Button asChild variant="outline" size="sm" className="w-full">
          <Link to="/runs">
            {live.active ? 'Follow the run' : 'Start or review runs'}
            <ArrowRight />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
