import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useNow } from '@/hooks/use-now';
import { formatDateTime, formatDuration, formatRelative } from '@/lib/format';

export function RelativeTime({ iso, fallback = 'never' }: { iso: string | null | undefined; fallback?: string }) {
  const now = useNow(!!iso, 30_000);
  if (!iso) return <span className="text-muted-foreground">{fallback}</span>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <time dateTime={iso} className="cursor-default">
          {formatRelative(iso, now)}
        </time>
      </TooltipTrigger>
      <TooltipContent>{formatDateTime(iso)}</TooltipContent>
    </Tooltip>
  );
}

// Ticks while `running`; otherwise shows the fixed span between start and end.
export function Elapsed({ from, to, running }: { from: string | null; to?: string | null; running: boolean }) {
  const now = useNow(running);
  if (!from) return <>—</>;
  const end = to ? Date.parse(to) : running ? now : null;
  return <span className="tabular-nums">{end == null ? '—' : formatDuration(end - Date.parse(from))}</span>;
}
