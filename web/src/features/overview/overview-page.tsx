import { ArrowRight, CircleAlert } from 'lucide-react';
import { useMemo } from 'react';
import { Link } from 'react-router';
import { useRun } from '@/app/live';
import { MatrixCard } from '@/components/matrix-card';
import { Page, PageHeader } from '@/components/page';
import { SeverityBadge } from '@/components/severity';
import { SubscriptionCard } from '@/components/subscription-card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { StagePipeline } from '@/features/pipeline/stage-pipeline';
import { useOverview } from '@/hooks/use-overview';
import { severityRank } from '@/lib/domain';
import { findingsHref } from '@/lib/findings-view';
import { plural } from '@/lib/format';
import { openFindings } from '@/lib/selectors';
import type { FailureView, FindingView } from '@/lib/types';
import { RunSummaryCard } from './run-summary-card';

const ATTENTION_LIMIT = 8;

const urgentFirst = (a: FindingView, b: FindingView) =>
  Number(b.new_last_run) - Number(a.new_last_run) || severityRank(a.severity) - severityRank(b.severity) || b.first_seen.localeCompare(a.first_seen);

function NeedsAttention({ open }: { open: FindingView[] }) {
  const urgent = useMemo(() => open.filter((f) => f.severity === 'critical' || f.severity === 'high').sort(urgentFirst), [open]);
  const listView = { queue: 'all' as const, statuses: ['open' as const], severities: ['critical' as const, 'high' as const] };
  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle>Needs attention</CardTitle>
        <CardDescription>Open critical and high findings, new ones first.</CardDescription>
        <CardAction>
          <Button asChild variant="ghost" size="sm">
            <Link to={findingsHref(listView)}>
              All {urgent.length}
              <ArrowRight />
            </Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="px-0">
        {urgent.length ? (
          <ul className="divide-y">
            {urgent.slice(0, ATTENTION_LIMIT).map((f) => (
              <li key={`${f.repo}:${f.fingerprint}`}>
                <Link to={findingsHref({ ...listView, id: f.fingerprint })} className="flex items-start gap-3 px-6 py-3 transition-colors hover:bg-muted/60">
                  <SeverityBadge severity={f.severity} className="mt-0.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{f.title}</div>
                    <div className="truncate font-mono text-xs text-muted-foreground">
                      {f.repo} · {f.file}:{f.line}
                    </div>
                  </div>
                  {f.new_last_run ? <Badge className="bg-info text-primary-foreground">New</Badge> : null}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>Nothing critical or high is open</EmptyTitle>
              <EmptyDescription>Lower severities are still in the findings list.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </CardContent>
    </Card>
  );
}

function ProblemsAlerts({ configError, failures }: { configError: string | null; failures: [string, FailureView][] }) {
  return (
    <>
      {configError ? (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertTitle>repos.yaml does not load</AlertTitle>
          <AlertDescription>{configError}</AlertDescription>
        </Alert>
      ) : null}
      {failures.length ? (
        <Alert className="border-warning/40">
          <CircleAlert className="text-warning" />
          <AlertTitle>{plural(failures.length, 'repository', 'repositories')} did not complete their last audit</AlertTitle>
          <AlertDescription>
            <ul className="list-inside list-disc">
              {failures.map(([name, f]) => (
                <li key={name}>
                  <Link to={`/repositories/${encodeURIComponent(name)}`} className="font-medium underline-offset-4 hover:underline">
                    {name}
                  </Link>{' '}
                  {f.deferred ? 'was deferred' : 'failed'} on {f.date}: {f.error}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}
    </>
  );
}

export function OverviewPage() {
  const ov = useOverview();
  const live = useRun();
  const open = useMemo(() => openFindings(ov.findings), [ov.findings]);

  return (
    <Page>
      <PageHeader title="Overview" description={`Where the findings of ${plural(ov.repos.length, 'repository', 'repositories')} stand, stage by stage.`} />
      <ProblemsAlerts configError={ov.config_error} failures={Object.entries(ov.failures)} />
      {ov.repos.length ? (
        <StagePipeline findings={ov.findings} repos={ov.repos} />
      ) : (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No repositories configured</EmptyTitle>
            <EmptyDescription>Add them to repos.yaml, then start an audit.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        <NeedsAttention open={open} />
        <div className="flex flex-col gap-4">
          <RunSummaryCard live={live} />
          <SubscriptionCard rate={live.rateLimit ?? ov.rate_limit} />
        </div>
      </div>
      <MatrixCard findings={open} />
    </Page>
  );
}
