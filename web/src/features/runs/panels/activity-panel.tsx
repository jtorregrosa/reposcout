import { useMemo, useState } from 'react';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { formatClock } from '@/lib/format';
import type { LiveState, Tone } from '@/lib/live';
import { cn } from '@/lib/utils';

const TONE_TEXT: Record<Exclude<Tone, null>, string> = {
  ok: 'text-success',
  warn: 'text-warning',
  danger: 'text-destructive',
};

export function ActivityPanel({ live }: { live: LiveState }) {
  const [problemsOnly, setProblemsOnly] = useState(false);
  const lines = useMemo(
    () =>
      [...live.feed]
        .reverse()
        .filter((l) => !problemsOnly || l.tone === 'warn' || l.tone === 'danger')
        .slice(0, 300),
    [live.feed, problemsOnly],
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>Activity</CardTitle>
        <CardDescription>Newest first.</CardDescription>
        <CardAction className="flex items-center gap-2">
          <Switch id="problems-only" checked={problemsOnly} onCheckedChange={setProblemsOnly} />
          <Label htmlFor="problems-only" className="text-xs font-normal">
            Warnings and errors only
          </Label>
        </CardAction>
      </CardHeader>
      <CardContent>
        {lines.length ? (
          <ol className="max-h-96 space-y-1 overflow-y-auto font-mono text-xs">
            {lines.map((l) => (
              <li key={l.id} className="flex gap-3">
                <time className="shrink-0 text-muted-foreground">{formatClock(l.ts)}</time>
                <span className={cn('min-w-0 break-words', l.tone ? TONE_TEXT[l.tone] : '')}>{l.text}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-muted-foreground">No events.</p>
        )}
      </CardContent>
    </Card>
  );
}
