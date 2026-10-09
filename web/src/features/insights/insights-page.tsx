import { useMemo, useState } from 'react';
import { Page, PageHeader } from '@/components/page';
import { StatCard } from '@/components/stat-card';
import { SubscriptionCard } from '@/components/subscription-card';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { CoverageSummary } from '@/features/coverage/coverage-summary';
import { useOverview } from '@/hooks/use-overview';
import { formatDateTime, formatDuration, formatTokens, formatUsd, percent } from '@/lib/format';
import { type CostSummary, costSummary } from '@/lib/metrics';
import type { UsageRow } from '@/lib/types';
import { PrecisionCard } from './precision-card';
import { YieldCard } from './yield-card';

const ALL = '__all';
const WEEK_MS = 7 * 864e5;

type ModelUsage = Record<string, { input?: number; output?: number }>;
const tokens = (u: UsageRow, key: 'input' | 'output') => Object.values((u.models ?? {}) as ModelUsage).reduce((acc, m) => acc + (m[key] ?? 0), 0);
const subagentRuns = (u: UsageRow) =>
  typeof u.subagent_runs === 'number' ? u.subagent_runs : Object.values((u.subagents ?? {}) as Record<string, number>).reduce((a, b) => a + b, 0);

// What one finding cost to find, the number this page exists to answer.
function CostHeadline({ cost }: { cost: CostSummary }) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>Last 7 days, API-equivalent cost</CardDescription>
        <CardTitle className="flex flex-wrap items-baseline gap-x-8 gap-y-2">
          <span>
            <span className="text-3xl font-semibold tabular-nums">{formatUsd(cost.per_confirmed)}</span>
            <span className="ml-2 text-sm font-normal text-muted-foreground">per confirmed finding</span>
          </span>
          <span>
            <span className="text-2xl font-semibold tabular-nums">{formatUsd(cost.per_finding)}</span>
            <span className="ml-2 text-sm font-normal text-muted-foreground">per finding, speculative included</span>
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="text-xs text-muted-foreground">
        {cost.findings
          ? `${cost.confirmed} confirmed and ${cost.findings - cost.confirmed} speculative findings were new in this period. Every run counts toward the cost, including the ones that found nothing.`
          : 'No new finding in this period.'}
      </CardContent>
    </Card>
  );
}

export function InsightsPage() {
  const ov = useOverview();
  const [repo, setRepo] = useState(ALL);
  const rows = useMemo(() => [...ov.usage].reverse().filter((u) => repo === ALL || u.repo === repo), [ov, repo]);
  const week = useMemo(() => {
    const since = Date.now() - WEEK_MS;
    const recent = rows.filter((u) => Date.parse(u.at ?? u.date) >= since);
    const inScope = <T extends { repo: string }>(list: readonly T[], at: (x: T) => string) =>
      list.filter((x) => (repo === ALL || x.repo === repo) && Date.parse(at(x)) >= since);
    return {
      cost: costSummary(
        recent,
        inScope(ov.run_results, (r) => r.generated_at),
      ),
      yields: inScope(ov.yields, (y) => y.at),
      runs: recent.length,
      failed: recent.filter((u) => !u.ok).length,
      files: recent.reduce((a, u) => a + (u.files ?? 0), 0),
      wall: recent.reduce((a, u) => a + (u.wall_ms ?? u.duration_ms ?? 0), 0),
      input: recent.reduce((a, u) => a + tokens(u, 'input'), 0),
      output: recent.reduce((a, u) => a + tokens(u, 'output'), 0),
    };
  }, [rows, ov, repo]);

  return (
    <Page>
      <PageHeader
        title="Insights"
        description="What the audits cost, what they found and how often people kept it. Totals cover the last 7 days; precision covers every finding people have judged."
        actions={
          <Select value={repo} onValueChange={setRepo}>
            <SelectTrigger className="w-56" aria-label="Repository">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All repositories</SelectItem>
              {ov.repos.map((r) => (
                <SelectItem key={r.name} value={r.name}>
                  {r.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />
      <CostHeadline cost={week.cost} />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="grid gap-4 sm:grid-cols-2 lg:col-span-2">
          <StatCard label="Claude runs" value={week.runs} footer={week.failed ? `${week.failed} did not complete` : 'all completed'} />
          <StatCard label="Files audited" value={week.files} />
          <StatCard label="Time spent" value={formatDuration(week.wall)} />
          <StatCard
            label="Tokens"
            value={formatTokens(week.input + week.output)}
            footer={`${formatTokens(week.input)} in · ${formatTokens(week.output)} out`}
          />
          <StatCard
            label="Cost (API equivalent)"
            value={formatUsd(week.cost.total)}
            footer={week.cost.runs < week.runs ? `${week.cost.runs} of ${week.runs} runs reported a cost` : 'what the runs would cost billed through the API'}
          />
          <StatCard
            label="New findings"
            value={week.cost.findings}
            footer={`${week.cost.confirmed} confirmed, ${week.cost.findings - week.cost.confirmed} speculative`}
          />
        </div>
        <SubscriptionCard rate={ov.rate_limit} />
      </div>
      <YieldCard rows={week.yields} totalCost={week.cost.total} />
      <PrecisionCard cells={ov.precision} repo={repo === ALL ? null : repo} />
      <Card>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">When</TableHead>
                <TableHead>Repository</TableHead>
                <TableHead>Mode</TableHead>
                <TableHead className="text-right">Files</TableHead>
                <TableHead className="text-right">Duration</TableHead>
                <TableHead className="text-right">Subagents</TableHead>
                <TableHead className="text-right">Input</TableHead>
                <TableHead className="text-right">Output</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead>Models</TableHead>
                <TableHead className="text-right">5-hour window</TableHead>
                <TableHead className="pr-6">Result</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length ? (
                rows.map((u) => (
                  <TableRow key={`${u.at}-${u.repo}`}>
                    <TableCell className="pl-6">{u.at ? formatDateTime(u.at) : u.date}</TableCell>
                    <TableCell>{u.repo}</TableCell>
                    <TableCell>{u.mode}</TableCell>
                    <TableCell className="text-right tabular-nums">{u.files ?? '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatDuration(u.wall_ms ?? u.duration_ms)}</TableCell>
                    <TableCell className="text-right tabular-nums">{subagentRuns(u)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatTokens(tokens(u, 'input'))}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatTokens(tokens(u, 'output'))}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatUsd(u.cost_usd_equivalent)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {Object.keys((u.models ?? {}) as ModelUsage)
                        .map((m) => m.replace(/^claude-/, ''))
                        .join(', ')}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{u.rate_limit?.five_hour != null ? `${percent(u.rate_limit.five_hour)}%` : '—'}</TableCell>
                    <TableCell className="pr-6">
                      <Badge variant="outline" className={u.ok ? 'border-success/30 text-success' : 'border-destructive/30 text-destructive'}>
                        {u.ok ? 'ok' : (u.terminal_reason ?? 'failed')}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={12} className="py-10 text-center text-muted-foreground">
                    No Claude runs recorded yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <CoverageSummary ov={ov} />
    </Page>
  );
}
