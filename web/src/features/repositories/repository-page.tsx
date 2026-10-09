import { ArrowRight, CircleAlert, FlaskConicalOff } from 'lucide-react';
import { useMemo } from 'react';
import { Link, useParams } from 'react-router';
import { MatrixCard } from '@/components/matrix-card';
import { Page, PageHeader } from '@/components/page';
import { ErrorAlert } from '@/components/query-state';
import { RelativeTime } from '@/components/time';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CoverageBars } from '@/features/coverage/coverage-bars';
import { CoverageSinceControl, useCoverageSince } from '@/features/coverage/coverage-since';
import { StagePipeline } from '@/features/pipeline/stage-pipeline';
import { useOverview } from '@/hooks/use-overview';
import { useSearchParam } from '@/hooks/use-search-param';
import { coverageCounts, cutoffOf } from '@/lib/coverage';
import { CATEGORY_LABEL, modeShort } from '@/lib/domain';
import { findingsHref } from '@/lib/findings-view';
import { formatDateTime, formatDuration, percent, shortSha } from '@/lib/format';
import { openFindings, repoFindings } from '@/lib/selectors';
import type { RepoView, UsageRow } from '@/lib/types';

const TABS = ['findings', 'coverage', 'runs', 'configuration'] as const;
type Tab = (typeof TABS)[number];
const TAB_LABEL: Record<Tab, string> = { findings: 'Findings', coverage: 'Coverage', runs: 'Runs', configuration: 'Configuration' };

function VerificationNotice({ repo }: { repo: RepoView }) {
  if (repo.verification === 'on') return null;
  return (
    <Alert>
      <FlaskConicalOff />
      <AlertTitle>Verification is off</AlertTitle>
      <AlertDescription>
        {repo.verification === 'no-sandbox'
          ? 'Claude Code has no sandbox on this platform, so test_command is ignored and the verifier confirms findings from the code alone. Set test_command_unsandboxed: true to run it with your rights and network anyway.'
          : 'No test_command is set in repos.yaml, so the verifier confirms findings from the code alone and never reproduces one with a test.'}
      </AlertDescription>
    </Alert>
  );
}

function CoverageTab({ repo }: { repo: RepoView }) {
  const [since, setSince] = useCoverageSince();
  const counts = coverageCounts(repo, cutoffOf(since));
  return (
    <Card>
      <CardHeader>
        <CardTitle>Coverage per analyzer</CardTitle>
        <CardDescription>
          <CoverageSinceControl since={since} onChange={setSince} />
        </CardDescription>
      </CardHeader>
      <CardContent>
        {counts ? <CoverageBars repo={repo} counts={counts} /> : <p className="text-sm text-muted-foreground">Coverage appears after the first full run.</p>}
      </CardContent>
    </Card>
  );
}

function RunsTab({ runs }: { runs: UsageRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent Claude runs</CardTitle>
        <CardDescription>The last ten sessions on this repository.</CardDescription>
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
                  <TableCell>{modeShort(u.mode)}</TableCell>
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
  );
}

function ConfigurationTab({ repo }: { repo: RepoView }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Configuration</CardTitle>
        <CardDescription>From repos.yaml.</CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid max-w-xl grid-cols-2 gap-y-2 text-sm">
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
          <dd>{repo.verification === 'on' ? 'enabled' : 'off'}</dd>
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
  );
}

export function RepositoryPage() {
  const { name = '' } = useParams();
  const ov = useOverview();
  const [tab, setTab] = useSearchParam('tab', TABS, 'findings');
  const repo = ov.repos.find((r) => r.name === name);
  const findings = useMemo(() => repoFindings(ov.findings, name), [ov.findings, name]);
  const open = useMemo(() => openFindings(findings), [findings]);
  if (!repo) {
    return (
      <Page>
        <ErrorAlert title={`No repository named "${name}" in repos.yaml`}>
          <Button asChild variant="outline" size="sm" className="mt-3">
            <Link to="/repositories">All repositories</Link>
          </Button>
        </ErrorAlert>
      </Page>
    );
  }
  const failure = ov.failures[repo.name];
  const runs = ov.usage
    .filter((u) => u.repo === repo.name)
    .slice(-10)
    .reverse();

  return (
    <Page>
      <PageHeader
        title={repo.name}
        description={`${repo.organization} / ${repo.project} · ${repo.branch} · last audited commit ${shortSha(repo.last_commit)}`}
        actions={
          <Button asChild>
            <Link to={findingsHref({ queue: 'triage', repo: repo.name })}>
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
      <VerificationNotice repo={repo} />
      <StagePipeline findings={ov.findings} repos={ov.repos} repo={repo.name} />
      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList>
          {TABS.map((t) => (
            <TabsTrigger key={t} value={t}>
              {TAB_LABEL[t]}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="findings" className="pt-2">
          <MatrixCard findings={open} repo={repo.name} />
        </TabsContent>
        <TabsContent value="coverage" className="pt-2">
          <CoverageTab repo={repo} />
        </TabsContent>
        <TabsContent value="runs" className="pt-2">
          <RunsTab runs={runs} />
        </TabsContent>
        <TabsContent value="configuration" className="pt-2">
          <ConfigurationTab repo={repo} />
        </TabsContent>
      </Tabs>
    </Page>
  );
}
