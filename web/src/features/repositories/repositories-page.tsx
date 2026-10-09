import { Link } from 'react-router';
import { Meter } from '@/components/meter';
import { Page, PageHeader } from '@/components/page';
import { ErrorAlert, LoadingPage } from '@/components/query-state';
import { SeverityDot } from '@/components/severity';
import { RelativeTime } from '@/components/time';
import { Badge } from '@/components/ui/badge';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { findingsHref } from '@/hooks/use-finding-filters';
import { useOverview } from '@/hooks/use-overview';
import { coverageCounts, coverageTotals, cutoffOf } from '@/lib/coverage';
import { SEVERITIES } from '@/lib/domain';
import { plural, ratio, shortSha } from '@/lib/format';
import type { Overview } from '@/lib/types';
import { runsLeftText } from './coverage-bars';
import { CoverageSinceControl, useCoverageSince } from './coverage-since';

function CoverageSummary({ ov }: { ov: Overview }) {
  const [since, setSince] = useCoverageSince();
  const cutoff = cutoffOf(since);
  const totals = coverageTotals(ov, cutoff);
  const pct = ratio(totals.done, totals.eligible);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Coverage</CardTitle>
        <CardDescription>
          A file counts once every analyzer has opened it, measured against the auditable files of each repository's last full run.
        </CardDescription>
        <CardAction>
          <CoverageSinceControl since={since} onChange={setSince} />
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-6">
        {totals.eligible ? (
          <Meter
            label={<span className="font-medium">All repositories</span>}
            detail={`${pct}% · ${totals.done} / ${totals.eligible} files`}
            value={pct}
            tone={totals.pending ? 'default' : 'success'}
            hint={
              totals.pending
                ? `${totals.pending} files pending · ≈ ${plural(totals.runsLeft, 'full run')} left${
                    totals.windows
                      ? ` · about ${Math.round(totals.windows.fiveHour * 100)}% of a 5-hour window and ${Math.round(totals.windows.weekly * 100)}% of the weekly one, measured over ${plural(totals.windows.runs, 'run')}`
                      : ''
                  }`
                : 'Every eligible file has been audited.'
            }
          />
        ) : (
          <p className="text-sm text-muted-foreground">Coverage appears after the first full run.</p>
        )}
        <div className="grid gap-x-8 gap-y-4 md:grid-cols-2">
          {ov.repos.map((r) => {
            const c = coverageCounts(r, cutoff);
            return c ? (
              <Meter
                key={r.name}
                label={
                  <Link to={`/repositories/${encodeURIComponent(r.name)}`} className="hover:underline">
                    {r.name}
                  </Link>
                }
                detail={`${ratio(c.every, c.eligible)}%`}
                value={ratio(c.every, c.eligible)}
                tone={c.every >= c.eligible ? 'success' : 'default'}
                hint={runsLeftText(c.every, r)}
              />
            ) : null;
          })}
        </div>
        {totals.uncounted.length ? (
          <p className="text-xs text-muted-foreground">
            Not counted yet: {totals.uncounted.join(', ')}. Count them without a Claude call with{' '}
            <code className="font-mono">pnpm audit:full --prepare-only</code>.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function RepositoriesPage() {
  const { data: ov, isLoading, error } = useOverview();
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
      <PageHeader title="Repositories" description={`${plural(ov.repos.length, 'repository', 'repositories')} configured in repos.yaml.`} />
      {ov.config_error ? <ErrorAlert title="repos.yaml does not load">{ov.config_error}</ErrorAlert> : null}
      <CoverageSummary ov={ov} />
      <Card>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Repository</TableHead>
                <TableHead>Open findings</TableHead>
                <TableHead className="text-right">New</TableHead>
                <TableHead className="text-right">Speculative</TableHead>
                <TableHead className="text-right">Suppressed</TableHead>
                <TableHead>Last audit</TableHead>
                <TableHead>Commit</TableHead>
                <TableHead className="pr-6">Health</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ov.repos.map((r) => {
                const failure = ov.failures[r.name];
                return (
                  <TableRow key={r.name}>
                    <TableCell className="pl-6">
                      <Link to={`/repositories/${encodeURIComponent(r.name)}`} className="font-medium hover:underline">
                        {r.name}
                      </Link>
                      <div className="text-xs text-muted-foreground">
                        {r.project} · {r.branch}
                      </div>
                    </TableCell>
                    <TableCell>
                      {r.counts.open ? (
                        <Link to={findingsHref({ repo: r.name })} className="flex items-center gap-3 tabular-nums hover:underline">
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
                    <TableCell className="text-right tabular-nums">{r.counts.new_last_run || '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.counts.speculative || '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.counts.suppressed || '—'}</TableCell>
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
                    <TableCell className="font-mono text-xs">{shortSha(r.last_commit)}</TableCell>
                    <TableCell className="pr-6">
                      {failure ? (
                        <Badge
                          variant="outline"
                          className={failure.deferred ? 'border-warning/40 text-warning' : 'border-destructive/30 text-destructive'}
                          title={failure.error}
                        >
                          {failure.deferred ? 'Deferred' : 'Failed'} · {failure.date}
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
    </Page>
  );
}
