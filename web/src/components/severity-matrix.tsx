import { Link } from 'react-router';
import { CategoryLabel } from '@/components/category';
import { KIND_ICON } from '@/components/kind';
import { SeverityDot } from '@/components/severity';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { findingsHref } from '@/hooks/use-finding-filters';
import { KIND_LABEL, SEVERITIES } from '@/lib/domain';
import { type MatrixAxis, type MatrixRow, severityMatrix } from '@/lib/findings';
import type { FindingView, Severity } from '@/lib/types';
import { cn } from '@/lib/utils';

// Fixed steps rather than a computed alpha, so every class exists at build time. The text stays the foreground
// colour, so the top step is kept light enough to read in both themes.
const HEAT: Record<Severity, string[]> = {
  critical: ['bg-severity-critical/10', 'bg-severity-critical/20', 'bg-severity-critical/30', 'bg-severity-critical/40'],
  high: ['bg-severity-high/10', 'bg-severity-high/20', 'bg-severity-high/30', 'bg-severity-high/40'],
  medium: ['bg-severity-medium/10', 'bg-severity-medium/20', 'bg-severity-medium/30', 'bg-severity-medium/40'],
  low: ['bg-severity-low/10', 'bg-severity-low/20', 'bg-severity-low/30', 'bg-severity-low/40'],
};

function RowLabel({ row }: { row: MatrixRow }) {
  if (row.by === 'category') return <CategoryLabel category={row.key} className="text-foreground" />;
  if (row.key === 'unset') return <span className="text-muted-foreground">Not classified</span>;
  const Icon = KIND_ICON[row.key];
  return (
    <span className="inline-flex items-center gap-1.5">
      <Icon aria-hidden className="size-3.5 text-muted-foreground" />
      {KIND_LABEL[row.key]}
    </span>
  );
}

const rowName = (row: MatrixRow) => (row.by === 'category' ? row.key : row.key === 'unset' ? 'unclassified' : row.key);

// Open findings by category or by type, and severity; every number opens the findings it counts.
export function SeverityMatrix({
  findings,
  repo,
  status = 'open',
  by = 'category',
}: {
  findings: FindingView[];
  repo?: string;
  status?: string;
  by?: MatrixAxis;
}) {
  const m = severityMatrix(findings, by);
  const href = (row: MatrixRow, severity?: string) => findingsHref({ status: status === 'open' ? undefined : status, repo, severity, [row.by]: row.key });
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{by === 'category' ? 'Category' : 'Type'}</TableHead>
          {SEVERITIES.map((s) => (
            <TableHead key={s} className="text-center capitalize">
              <span className="inline-flex items-center gap-1.5">
                <SeverityDot severity={s} />
                {s}
              </span>
            </TableHead>
          ))}
          <TableHead className="text-right">Total</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {m.rows.map((row) => (
          <TableRow key={row.key}>
            <TableCell>
              <Link to={href(row)} className="hover:underline">
                <RowLabel row={row} />
              </Link>
            </TableCell>
            {row.cells.map((n, i) => {
              const severity = SEVERITIES[i] as (typeof SEVERITIES)[number];
              const steps = HEAT[severity];
              const level = Math.min(steps.length - 1, Math.floor((n / m.max) * steps.length));
              return (
                <TableCell key={severity} className="p-1 text-center">
                  {n ? (
                    <Link
                      to={href(row, severity)}
                      className={cn('block rounded-md py-1.5 font-medium tabular-nums hover:ring-2 hover:ring-ring/40', steps[level])}
                      aria-label={`${n} ${severity} ${rowName(row)} findings`}
                    >
                      {n}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">·</span>
                  )}
                </TableCell>
              );
            })}
            <TableCell className="text-right font-medium tabular-nums">{row.total || '—'}</TableCell>
          </TableRow>
        ))}
      </TableBody>
      <TableFooter>
        <TableRow>
          <TableCell>Total</TableCell>
          {m.totals.map((n, i) => (
            <TableCell key={SEVERITIES[i]} className="text-center tabular-nums">
              {n}
            </TableCell>
          ))}
          <TableCell className="text-right tabular-nums">{findings.length}</TableCell>
        </TableRow>
      </TableFooter>
    </Table>
  );
}
