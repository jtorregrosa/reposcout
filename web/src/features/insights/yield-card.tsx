import { CategoryLabel } from '@/components/category';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { isCategory } from '@/lib/domain';
import { formatTokens, formatUsd, percent } from '@/lib/format';
import { yieldByAnalyzer } from '@/lib/metrics';
import type { YieldRow } from '@/lib/types';

export function YieldCard({ rows, totalCost }: { rows: YieldRow[]; totalCost: number | null }) {
  const summary = yieldByAnalyzer(rows, totalCost);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Yield per analyzer</CardTitle>
        <CardDescription>
          What each analyzer's specialists proposed over the last 7 days, and what the verifier made of it. Candidates come from the specialists' own replies; a
          run whose replies could not be read is left out of that column. A candidate several specialists proposed counts for each. Cost is the run's cost in
          proportion to the analyzer's tokens; its share is of everything the period's runs cost, orchestrator and verifier included.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-6">Analyzer</TableHead>
              <TableHead className="text-right">Runs</TableHead>
              <TableHead className="text-right">Candidates</TableHead>
              <TableHead className="text-right">Kept</TableHead>
              <TableHead className="text-right">Speculative</TableHead>
              <TableHead className="text-right">Discarded</TableHead>
              <TableHead className="text-right">Tokens</TableHead>
              <TableHead className="text-right">Cost</TableHead>
              <TableHead className="pr-6 text-right">Cost share</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {summary.length ? (
              summary.map((y) => (
                <TableRow key={y.analyzer}>
                  <TableCell className="pl-6">
                    {isCategory(y.analyzer) ? <CategoryLabel category={y.analyzer} className="text-foreground" /> : y.analyzer}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{y.runs}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {y.candidates ?? '—'}
                    {y.unparsed ? <span className="ml-1 text-xs text-muted-foreground">({y.unparsed} unread)</span> : null}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{y.kept}</TableCell>
                  <TableCell className="text-right tabular-nums">{y.speculative}</TableCell>
                  <TableCell className="text-right tabular-nums">{y.discarded}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatTokens(y.tokens)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatUsd(y.cost_usd)}</TableCell>
                  <TableCell className="pr-6 text-right tabular-nums">{y.cost_share == null ? '—' : `${percent(y.cost_share)}%`}</TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={9} className="py-10 text-center text-muted-foreground">
                  No audit with specialists recorded its yield in this period.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
