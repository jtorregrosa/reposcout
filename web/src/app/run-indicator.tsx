import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router';
import { Elapsed } from '@/components/time';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { CancelRun } from '@/features/runs/cancel-run';
import { modeShort } from '@/lib/domain';
import { REPO_STAGE_LABEL } from '@/lib/live';
import { cn } from '@/lib/utils';
import { useRun } from './live';

// While a run holds the lock: what it is doing, and a way to stop it, from any page.
export function RunIndicator() {
  const live = useRun();
  if (!live.active) return null;
  const repos = [...live.repos.values()];
  const done = repos.filter((r) => r.stage === 'done').length;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5 border-info/40 text-info hover:text-info">
          <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-info" />
          <span className="max-w-48 truncate">Run in progress{live.current ? ` · ${live.current}` : ''}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-3">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-sm font-medium">{live.mode ? modeShort(live.mode) : 'Run'} in progress</span>
          <span className="text-xs text-muted-foreground">
            <Elapsed from={live.startedAt} running />
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          {done} of {repos.length} repositories done
        </p>
        <ul className="space-y-1.5 text-sm">
          {repos.map((r) => (
            <li key={r.name} className="flex items-center justify-between gap-2">
              <span className={cn('truncate', r.name === live.current && 'font-medium')}>{r.name}</span>
              <Badge
                variant="outline"
                className={cn(
                  r.stage === 'done' ? 'border-success/30 text-success' : r.stage === 'pending' ? 'text-muted-foreground' : 'border-info/40 text-info',
                )}
              >
                {r.outcome?.status ?? REPO_STAGE_LABEL[r.stage]}
              </Badge>
            </li>
          ))}
        </ul>
        <div className="flex items-center justify-between gap-2 border-t pt-3">
          <CancelRun runId={live.runId} size="sm" />
          <Button asChild variant="ghost" size="sm">
            <Link to="/runs">
              Follow the run
              <ArrowRight />
            </Link>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
