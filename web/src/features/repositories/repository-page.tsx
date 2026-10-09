import { ArrowLeft, ArrowRight, CircleAlert, FlaskConicalOff } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { KindMatrixCard } from '@/components/kind-matrix-card';
import { Page, PageHeader } from '@/components/page';
import { ErrorAlert, LoadingPage } from '@/components/query-state';
import { SeverityMatrix } from '@/components/severity-matrix';
import { StatCard } from '@/components/stat-card';
import { RelativeTime } from '@/components/time';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { findingsHref } from '@/hooks/use-finding-filters';
import { useOverview } from '@/hooks/use-overview';
import { coverageCounts, cutoffOf } from '@/lib/coverage';
import { CATEGORY_LABEL } from '@/lib/domain';
import { formatDateTime, formatDuration, percent, shortSha } from '@/lib/format';
import { CoverageBars } from './coverage-bars';
import { CoverageSinceControl, useCoverageSince } from './coverage-since';

export function RepositoryPage() {
  const { name = '' } = useParams();
  const { data: ov, isLoading, error } = useOverview();
  const [since, setSince] = useCoverageSince();
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
  const repo = ov.repos.find((r) => r.name === name);
  if (!repo) {
    return (
      <Page>
        <ErrorAlert title={`No repository named "${name}" in repos.yaml`} />
      </Page>
    );
  }

  const findings = ov.findings.filter((f) => f.repo === repo.name);
  const open = findings.filter((f) => f.status === 'open');
  const counts = coverageCounts(repo, cutoffOf(since));
  const failure = ov.failures[repo.name];
  const runs = ov.usage
    .filter((u) => u.repo === repo.name)
    .slice(-10)
    .reverse();

  return (
    <Page>
      <Button asChild variant="ghost" size="sm" className="-ml-2 w-fit">
        <Link to="/repositories">
          <ArrowLeft />
          Repositories
        </Link>
      </Button>
      <PageHeader
        title={repo.name}
        description={`${repo.organization} / ${repo.project} · ${repo.branch} · last audited commit ${shortSha(repo.last_commit)}`}
        actions={
          <Button asChild>
            <Link to={findingsHref({ repo: repo.name })}>
              Review findings
              <ArrowRight />
            </Link>
          </Button>
        }
      />

      {failure ? (
        <Alert variant={failure.deferred ? 'default' : 'destructive'}>
          <CircleAlert />
          <AlertTitle>
            {failure.deferred ? 'Deferred' : 'Failed'} on {failure.date}
          </AlertTitle>
          <AlertDescription>{failure.error}</AlertDescription>
        </Alert>
      ) : null}

      {repo.test_command ? null : (
        <Alert>
          <FlaskConicalOff />
          <AlertTitle>Verification is off</AlertTitle>
          <AlertDescription>
            No test_command is set in repos.yaml, so the verifier confirms findings from the code alone and never reproduces one with a test.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Open findings" value={repo.counts.open} to={findingsHref({ repo: repo.name })} />
        <StatCard label="New in the last run" value={repo.counts.new_last_run} to={findingsHref({ repo: repo.name, status: 'new' })} />
        <StatCard label="Awaiting confirmation" value={repo.counts.speculative} to={findingsHref({ repo: repo.name, status: 'speculative' })} />
        <StatCard
          label="Resolved"
          value={repo.counts.resolved}
          to={findingsHref({ repo: repo.name, status: 'resolved' })}
          footer={`${repo.counts.suppressed} suppressed`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <KindMatrixCard findings={open} repo={repo.name} />
          <Card>
            <CardHeader>
              <CardTitle>Open findings by category and severity</CardTitle>
              <CardDescription>Which analyzer found them. Select a number to review those findings.</CardDescription>
            </CardHeader>
            <CardContent>
              {open.length ? <SeverityMatrix findings={open} repo={repo.name} /> : <p className="text-sm text-muted-foreground">No open findings.</p>}
            </CardContent>
          </Card>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Configuration</CardTitle>
            <CardDescription>From repos.yaml.</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Analyzers</dt>
              <dd className="flex flex-wrap gap-1">
                {repo.analyzers.map((a) => (
                  <Badge key={a} variant="secondary">
                    {CATEGORY_LABEL[a]}
                  </Badge>
                ))}
              </dd>
              <dt className="text-muted-foreground">Specialists model</dt>
              <dd>{repo.models.specialists}</dd>
              <dt className="text-muted-foreground">Verifier model</dt>
              <dd>{repo.models.verifier}</dd>
              <dt className="text-muted-foreground">Reproduction tests</dt>
              <dd>{repo.test_command ? 'enabled' : 'off'}</dd>
              <dt className="text-muted-foreground">Last audit</dt>
              <dd>
                <RelativeTime iso={repo.last_run_at} />
              </dd>
              <dt className="text-muted-foreground">Last full audit</dt>
              <dd>
                <RelativeTime iso={repo.last_full_run_at} />
              </dd>
              {repo.last_read_coverage ? (
                <>
                  <dt className="text-muted-foreground">Files opened last run</dt>
                  <dd>
                    {repo.last_read_coverage.read} of {repo.last_read_coverage.selected}
                  </dd>
                </>
              ) : null}
            </dl>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Coverage</CardTitle>
          <CardDescription>
            <CoverageSinceControl since={since} onChange={setSince} />
          </CardDescription>
        </CardHeader>
        <CardContent>
          {counts ? <CoverageBars repo={repo} counts={counts} /> : <p className="text-sm text-muted-foreground">Coverage appears after the first full run.</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent Claude runs</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          {runs.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">When</TableHead>
                  <TableHead>Mode</TableHead>
                  <TableHead className="text-right">Files</TableHead>
                  <TableHead className="text-right">Duration</TableHead>
                  <TableHead className="text-right">5-hour window</TableHead>
                  <TableHead className="pr-6">Result</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((u) => (
                  <TableRow key={u.at}>
                    <TableCell className="pl-6">{formatDateTime(u.at)}</TableCell>
                    <TableCell>{u.mode}</TableCell>
                    <TableCell className="text-right tabular-nums">{u.files}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatDuration(u.wall_ms ?? u.duration_ms)}</TableCell>
                    <TableCell className="text-right tabular-nums">{u.rate_limit?.five_hour != null ? `${percent(u.rate_limit.five_hour)}%` : '—'}</TableCell>
                    <TableCell className="pr-6">
                      <Badge variant="outline" className={u.ok ? 'border-success/30 text-success' : 'border-destructive/30 text-destructive'}>
                        {u.ok ? 'ok' : (u.terminal_reason ?? 'failed')}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="px-6 text-sm text-muted-foreground">No Claude run recorded for this repository.</p>
          )}
        </CardContent>
      </Card>
    </Page>
  );
}
