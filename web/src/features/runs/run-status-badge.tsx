import { Badge } from '@/components/ui/badge';
import { type LiveState, type RunStatus, runStatus } from '@/lib/live';
import { cn } from '@/lib/utils';

const LOOK: Record<RunStatus, [string, string]> = {
  running: ['Running', 'border-info/40 text-info'],
  finished: ['Finished', 'border-success/30 text-success'],
  failed: ['Finished with problems', 'border-warning/40 text-warning'],
  interrupted: ['Interrupted', 'border-warning/40 text-warning'],
  idle: ['Idle', 'text-muted-foreground'],
};

export function RunStatusBadge({ live }: { live: LiveState }) {
  const status = runStatus(live);
  const [label, tone] = LOOK[status];
  return (
    <Badge variant="outline" className={cn('gap-1.5', tone)}>
      {status === 'running' ? <span className="size-1.5 animate-pulse rounded-full bg-info" /> : null}
      {label}
    </Badge>
  );
}
