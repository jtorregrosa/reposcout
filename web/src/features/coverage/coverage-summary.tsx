import { Link } from 'react-router';
import { Meter } from '@/components/meter';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { coverageCounts, coverageTotals, cutoffOf } from '@/lib/coverage';
import { plural, ratio } from '@/lib/format';
import type { Overview } from '@/lib/types';
import { runsLeftText } from './coverage-bars';
import { CoverageSinceControl, useCoverageSince } from './coverage-since';

export function CoverageSummary({ ov }: { ov: Overview }) {
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
