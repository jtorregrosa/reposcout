import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatClock } from '@/lib/format';
import type { LiveState } from '@/lib/live';

export function DenialsPanel({ live }: { live: LiveState }) {
  if (!live.denials.length) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Blocked by policy · {live.denials.length}</CardTitle>
        <CardDescription>
          Tool calls the permission rules refused. Each costs the subagent a turn; a repeated pattern usually means a prompt should steer it away.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>Agent</TableHead>
              <TableHead>Tool</TableHead>
              <TableHead>Rule</TableHead>
              <TableHead>Command</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {[...live.denials]
              .reverse()
              .slice(0, 50)
              .map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="font-mono text-xs">{formatClock(d.ts)}</TableCell>
                  <TableCell>{d.agent ?? '—'}</TableCell>
                  <TableCell>{d.tool}</TableCell>
                  <TableCell>{d.reason ?? '—'}</TableCell>
                  <TableCell className="max-w-md truncate font-mono text-xs">{d.command ?? '(not recorded)'}</TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
