import { CodeXml, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useAction } from '@/hooks/use-actions';
import { runLabel } from '@/lib/format';
import type { DiscardView } from '@/lib/types';

export function DiscardedTable({ discarded }: { discarded: DiscardView[] }) {
  const open = useAction('openInEditor');
  if (!discarded.length) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Trash2 />
          </EmptyMedia>
          <EmptyTitle>Nothing discarded</EmptyTitle>
          <EmptyDescription>The verifier rejected no candidate in the last 7 days that matches these filters.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Candidate</TableHead>
          <TableHead>Why the verifier dropped it</TableHead>
          <TableHead className="w-28" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {discarded.map((d) => (
          <TableRow key={`${d.repo}:${d.file}:${d.title}`}>
            <TableCell className="max-w-md whitespace-normal">
              <div className="font-medium">{d.title ?? '—'}</div>
              <div className="font-mono text-xs text-muted-foreground">
                {d.repo} · {d.file ?? '—'}
              </div>
              <div className="text-xs text-muted-foreground">
                {d.run ? runLabel(d.run) : d.date}
                {Array.isArray(d.specialists) && d.specialists.length ? ` · proposed by ${d.specialists.join(', ')}` : ''}
              </div>
            </TableCell>
            <TableCell className="max-w-md whitespace-normal">
              <Badge variant="outline">{d.reason ?? 'no reason given'}</Badge>
            </TableCell>
            <TableCell className="text-right">
              {d.file ? (
                <Button variant="ghost" size="sm" onClick={() => open.mutate({ repo: d.repo, file: d.file as string, line: 1 })}>
                  <CodeXml />
                  Open
                </Button>
              ) : null}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
