import { FlaskConical, MoreHorizontal, Play } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { Meter } from '@/components/meter';
import { Page, PageHeader } from '@/components/page';
import { ErrorAlert } from '@/components/query-state';
import { SeverityDot } from '@/components/severity';
import { RelativeTime } from '@/components/time';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { runsLeftText } from '@/features/coverage/coverage-bars';
import { CoverageSinceControl, useCoverageSince } from '@/features/coverage/coverage-since';
import { NewAuditButton, useNewAudit } from '@/features/runs/new-audit';
import { LAUNCH_LABEL, RunLaunchDialog } from '@/features/runs/run-launch-dialog';
import { useOverview } from '@/hooks/use-overview';
import { useRunInProgress } from '@/hooks/use-run-in-progress';
import { type CoverageSince, coverageCounts, cutoffOf } from '@/lib/coverage';
import { SEVERITIES } from '@/lib/domain';
import { findingsHref } from '@/lib/findings-view';
import { plural, ratio } from '@/lib/format';
import { queueOf } from '@/lib/queues';
import { countBy, validationScope } from '@/lib/selectors';
import type { FailureView, FindingView, RepoView } from '@/lib/types';
import { AddRepository } from './add-repository';

function Health({ failure }: { failure: FailureView | undefined }) {
  if (!failure)
    return (
      <Badge variant="outline" className="border-success/30 text-success">
        OK
      </Badge>
    );
  return (
    <Badge variant="outline" className={failure.deferred ? 'border-warning/40 text-warning' : 'border-destructive/30 text-destructive'} title={failure.error}>
      {failure.deferred ? 'Deferred' : 'Failed'} · {failure.date}
    </Badge>
  );
}

function RowMenu({ repo }: { repo: RepoView }) {
  const openAudit = useNewAudit();
  const running = useRunInProgress();
  const [validating, setValidating] = useState(false);
  const scope = validationScope([repo], repo.name);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${repo.name}`}>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem disabled={running} onSelect={() => openAudit({ repos: [repo.name] })}>
            <Play />
            Audit this repository…
          </DropdownMenuItem>
          {scope.repos.length ? (
            <DropdownMenuItem disabled={running} onSelect={() => setValidating(true)}>
              <FlaskConical />
              {LAUNCH_LABEL.validate}…
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <RunLaunchDialog kind="validate" scope={scope} open={validating} onOpenChange={setValidating} />
    </>
  );
}

function CountLink({ n, to, label }: { n: number; to: string; label: string }) {
  return n ? (
    <Link to={to} className="font-medium tabular-nums hover:underline" aria-label={`${n} ${label}`}>
      {n}
    </Link>
  ) : (
    <span className="text-muted-foreground">—</span>
  );
}

function RepoRow({ repo: r, findings, failure, since }: { repo: RepoView; findings: FindingView[]; failure: FailureView | undefined; since: CoverageSince }) {
  const queues = countBy(findings, queueOf);
  const c = coverageCounts(r, cutoffOf(since));
  return (
    <TableRow>
      <TableCell className="pl-6">
        <Link to={`/repositories/${encodeURIComponent(r.name)}`} className="font-medium hover:underline">
          {r.name}
        </Link>
        <div className="text-xs text-muted-foreground">
          {r.project} · {r.branch}
        </div>
      </TableCell>
      <TableCell className="text-right">
        <CountLink n={queues.triage ?? 0} to={findingsHref({ queue: 'triage', repo: r.name })} label={`in Triage for ${r.name}`} />
      </TableCell>
      <TableCell className="text-right">
        <CountLink n={queues.report ?? 0} to={findingsHref({ queue: 'report', repo: r.name })} label={`to report for ${r.name}`} />
      </TableCell>
      <TableCell>
        {r.counts.open ? (
          <Link to={findingsHref({ queue: 'all', statuses: ['open'], repo: r.name })} className="flex items-center gap-3 tabular-nums hover:underline">
            <span className="font-medium">{r.counts.open}</span>
            {SEVERITIES.filter((s) => r.counts.by_severity[s]).map((s) => (
              <span key={s} className="inline-flex items-center gap-1 text-muted-foreground" title={s}>
                <SeverityDot severity={s} />
                {r.counts.by_severity[s]}
              </span>
            ))}
          </Link>
        ) : (
          <span className="text-muted-foreground">none</span>
        )}
      </TableCell>
      <TableCell className="w-56">
        {c ? (
          <Meter
            value={ratio(c.every, c.eligible)}
            detail={`${ratio(c.every, c.eligible)}%`}
            size="sm"
            tone={c.every >= c.eligible ? 'success' : 'default'}
            hint={c.every >= c.eligible ? undefined : runsLeftText(c.every, r)}
          />
        ) : (
          <span className="text-xs text-muted-foreground">no full run yet</span>
        )}
      </TableCell>
      <TableCell>
        <RelativeTime iso={r.last_run_at} />
        <div className="text-xs text-muted-foreground">
          {r.last_full_run_at ? (
            <>
              full <RelativeTime iso={r.last_full_run_at} />
            </>
          ) : (
            'no full run yet'
          )}
        </div>
      </TableCell>
      <TableCell>
        <Health failure={failure} />
      </TableCell>
      <TableCell className="pr-4 text-right">
        <RowMenu repo={r} />
      </TableCell>
    </TableRow>
  );
}

export function RepositoriesPage() {
  const ov = useOverview();
  const [since, setSince] = useCoverageSince();
  return (
    <Page>
      <PageHeader
        title="Repositories"
        description={`${plural(ov.repos.length, 'repository', 'repositories')} configured in repos.yaml.`}
        actions={
          <>
            <CoverageSinceControl since={since} onChange={setSince} />
            <AddRepository />
            <NewAuditButton />
          </>
        }
      />
      {ov.config_error ? <ErrorAlert title="repos.yaml does not load">{ov.config_error}</ErrorAlert> : null}
      <Card>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Repository</TableHead>
                <TableHead className="text-right">Triage</TableHead>
                <TableHead className="text-right">To report</TableHead>
                <TableHead>Open by severity</TableHead>
                <TableHead>Coverage</TableHead>
                <TableHead>Last audit</TableHead>
                <TableHead>Health</TableHead>
                <TableHead className="pr-4">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ov.repos.map((r) => (
                <RepoRow key={r.name} repo={r} findings={ov.findings.filter((f) => f.repo === r.name)} failure={ov.failures[r.name]} since={since} />
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </Page>
  );
}
