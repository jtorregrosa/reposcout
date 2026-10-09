import { ArrowRight, CircleAlert, CircleHelp, FolderGit2, ListChecks, Radar, Sparkles } from 'lucide-react';
import { Link } from 'react-router';
import { useLive } from '@/app/live';
import { KindMatrixCard } from '@/components/kind-matrix-card';
import { Meter } from '@/components/meter';
import { Page, PageHeader } from '@/components/page';
import { ErrorAlert, LoadingPage } from '@/components/query-state';
import { SeverityBadge, SeverityDot } from '@/components/severity';
import { SeverityMatrix } from '@/components/severity-matrix';
import { StatCard } from '@/components/stat-card';
import { SubscriptionCard } from '@/components/subscription-card';
import { RelativeTime } from '@/components/time';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { findingsHref } from '@/hooks/use-finding-filters';
import { useOverview } from '@/hooks/use-overview';
import { coverageTotals } from '@/lib/coverage';
import { SEVERITIES, severityRank } from '@/lib/domain';
import { plural, ratio } from '@/lib/format';
import type { Overview } from '@/lib/types';
import { RunSummaryCard } from './run-summary-card';

const ATTENTION_LIMIT = 8;

function NeedsAttention({ ov }: { ov: Overview }) {
  const urgent = ov.findings
    .filter((f) => f.status === 'open' && (f.severity === 'critical' || f.severity === 'high'))
    .sort(
      (a, b) =>
        Number(b.new_last_run) - Number(a.new_last_run) || severityRank(a.severity) - severityRank(b.severity) || b.first_seen.localeCompare(a.first_seen),
    );
  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle>Needs attention</CardTitle>
        <CardDescription>Open critical and high findings, new ones first.</CardDescription>
        <CardAction>
          <Button asChild variant="ghost" size="sm">
            <Link to={findingsHref({ severity: 'critical,high' })}>
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
                <Link
                  to={findingsHref({ severity: 'critical,high', id: f.fingerprint })}
                  className="flex items-start gap-3 px-6 py-3 transition-colors hover:bg-muted/60"
                >
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

function RepositoriesGlance({ ov }: { ov: Overview }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Repositories</CardTitle>
        <CardDescription>Open findings, coverage and the last audit of each configured repository.</CardDescription>
        <CardAction>
          <Button asChild variant="ghost" size="sm">
            <Link to="/repositories">
              Details
              <ArrowRight />
            </Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="px-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-6">Repository</TableHead>
              <TableHead>Open by severity</TableHead>
              <TableHead className="text-right">New</TableHead>
              <TableHead className="w-48">Coverage</TableHead>
              <TableHead>Last audit</TableHead>
              <TableHead className="pr-6">Health</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ov.repos.map((r) => {
              const failure = ov.failures[r.name];
              const cov = r.coverage.eligible ? ratio(r.coverage.audited, r.coverage.eligible) : null;
              return (
                <TableRow key={r.name}>
                  <TableCell className="pl-6 font-medium">
                    <Link to={`/repositories/${encodeURIComponent(r.name)}`} className="hover:underline">
                      {r.name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    {r.counts.open ? (
                      <Link to={findingsHref({ repo: r.name })} className="flex items-center gap-3 tabular-nums hover:underline">
                        {SEVERITIES.filter((s) => r.counts.by_severity[s]).map((s) => (
                          <span key={s} className="inline-flex items-center gap-1" title={s}>
                            <SeverityDot severity={s} />
                            {r.counts.by_severity[s]}
                          </span>
                        ))}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">none</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{r.counts.new_last_run || '—'}</TableCell>
                  <TableCell>
                    {cov == null ? <span className="text-xs text-muted-foreground">no full run yet</span> : <Meter value={cov} detail={`${cov}%`} size="sm" />}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    <RelativeTime iso={r.last_run_at} />
                  </TableCell>
                  <TableCell className="pr-6">
                    {failure ? (
                      <Badge
                        variant="outline"
                        className={failure.deferred ? 'border-warning/30 text-warning' : 'border-destructive/30 text-destructive'}
                        title={failure.error}
                      >
                        {failure.deferred ? 'Deferred' : 'Failed'}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="border-success/30 text-success">
                        OK
                      </Badge>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

export function OverviewPage() {
  const { data: ov, isLoading, error } = useOverview();
  const { live } = useLive();
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

  const open = ov.findings.filter((f) => f.status === 'open');
  const fresh = open.filter((f) => f.new_last_run);
  const speculative = ov.findings.filter((f) => f.status === 'speculative');
  const critical = open.filter((f) => f.severity === 'critical').length;
  const high = open.filter((f) => f.severity === 'high').length;
  const coverage = coverageTotals(ov, null);
  const failures = Object.entries(ov.failures);

  return (
    <Page>
      <PageHeader title="Overview" description={`Where the audit stands across ${plural(ov.repos.length, 'repository', 'repositories')}.`} />

      {ov.config_error ? (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertTitle>repos.yaml does not load</AlertTitle>
          <AlertDescription>{ov.config_error}</AlertDescription>
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

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Open findings"
          value={open.length}
          icon={ListChecks}
          to="/findings"
          footer={
            <span className="flex flex-wrap gap-x-3">
              <span className="inline-flex items-center gap-1">
                <SeverityDot severity="critical" />
                {critical} critical
              </span>
              <span className="inline-flex items-center gap-1">
                <SeverityDot severity="high" />
                {high} high
              </span>
            </span>
          }
        />
        <StatCard
          label="New in the last run"
          value={fresh.length}
          icon={Sparkles}
          to={findingsHref({ status: 'new' })}
          footer="Confirmed for the first time by each repository's latest run."
        />
        <StatCard
          label="Awaiting confirmation"
          value={speculative.length}
          icon={CircleHelp}
          to={findingsHref({ status: 'speculative' })}
          footer="Speculative candidates. A speculative review settles them."
        />
        <StatCard
          label="Coverage"
          value={coverage.eligible ? `${ratio(coverage.done, coverage.eligible)}%` : '—'}
          icon={Radar}
          to="/repositories"
          footer={
            coverage.eligible
              ? `${coverage.done} of ${coverage.eligible} files audited by every analyzer${coverage.pending ? ` · ≈ ${plural(coverage.runsLeft, 'full run')} left` : ''}`
              : 'Appears after the first full run.'
          }
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <NeedsAttention ov={ov} />
        <div className="flex flex-col gap-4">
          <RunSummaryCard live={live} />
          <SubscriptionCard rate={live.rateLimit ?? ov.rate_limit} />
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <KindMatrixCard findings={open} />
        <Card>
          <CardHeader>
            <CardTitle>Open findings by category and severity</CardTitle>
            <CardDescription>Which analyzer found them. Select a number to review those findings.</CardDescription>
          </CardHeader>
          <CardContent>{open.length ? <SeverityMatrix findings={open} /> : <p className="text-sm text-muted-foreground">No open findings.</p>}</CardContent>
        </Card>
      </div>

      {ov.repos.length ? (
        <RepositoriesGlance ov={ov} />
      ) : (
        <Empty>
          <EmptyHeader>
            <FolderGit2 />
            <EmptyTitle>No repositories configured</EmptyTitle>
            <EmptyDescription>Add them to repos.yaml.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </Page>
  );
}
