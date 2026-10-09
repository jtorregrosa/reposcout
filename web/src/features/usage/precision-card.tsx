import { CategoryLabel } from '@/components/category';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { isCategory } from '@/lib/domain';
import { percent } from '@/lib/format';
import { type PrecisionDimension, type PrecisionRow, precisionBy } from '@/lib/metrics';
import type { PrecisionCell } from '@/lib/types';

// Below this many judged findings a precision says little; the row says so.
const SMALL_SAMPLE = 10;

function PrecisionTable({ rows, label, dimension }: { rows: PrecisionRow[]; label: string; dimension: PrecisionDimension }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="pl-6">{label}</TableHead>
          <TableHead className="text-right">Kept</TableHead>
          <TableHead className="text-right">Suppressed</TableHead>
          <TableHead className="text-right">Refuted</TableHead>
          <TableHead className="pr-6 text-right">Precision</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length ? (
          rows.map((r) => {
            const judged = r.kept + r.dismissed;
            return (
              <TableRow key={String(r.key)}>
                <TableCell className="pl-6">
                  {dimension === 'category' && isCategory(r.key) ? (
                    <CategoryLabel category={r.key} className="text-foreground" />
                  ) : (
                    <span className={dimension === 'prompt_version' ? 'font-mono text-xs' : undefined}>{r.key ?? 'not recorded'}</span>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">{r.kept}</TableCell>
                <TableCell className="text-right tabular-nums">{r.suppressed}</TableCell>
                <TableCell className="text-right tabular-nums">{r.refuted}</TableCell>
                <TableCell className="pr-6 text-right tabular-nums">
                  <span className="inline-flex items-center justify-end gap-2">
                    {judged < SMALL_SAMPLE ? (
                      <Badge variant="outline" className="text-muted-foreground">
                        {judged} judged
                      </Badge>
                    ) : null}
                    {r.precision == null ? '—' : `${percent(r.precision)}%`}
                  </span>
                </TableCell>
              </TableRow>
            );
          })
        ) : (
          <TableRow>
            <TableCell colSpan={5} className="py-6 text-center text-muted-foreground">
              Nothing kept or dismissed yet.
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}

export function PrecisionCard({ cells, repo }: { cells: PrecisionCell[]; repo: string | null }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Precision</CardTitle>
        <CardDescription>
          Of the findings people have judged, the share they kept. Kept: reached open, including those resolved since, and never suppressed. Dismissed:
          suppressed, or refuted after being speculative. Candidates still speculative count in neither. All time.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6 px-0">
        <PrecisionTable rows={precisionBy(cells, 'category', repo)} label="Analyzer" dimension="category" />
        <div className="grid gap-6 lg:grid-cols-2">
          <PrecisionTable rows={precisionBy(cells, 'model', repo)} label="Specialists model" dimension="model" />
          <PrecisionTable rows={precisionBy(cells, 'prompt_version', repo)} label="Prompt version" dimension="prompt_version" />
        </div>
      </CardContent>
    </Card>
  );
}
