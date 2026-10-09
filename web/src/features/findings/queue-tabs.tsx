import { Trash2 } from 'lucide-react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { QUEUE_HELP, QUEUE_LABEL, QUEUE_VIEWS, type QueueView } from '@/lib/queues';
import { cn } from '@/lib/utils';

export function QueueTabs({
  value,
  counts,
  discardedCount,
  discardedHref,
  onChange,
}: {
  value: QueueView | null;
  counts: Record<QueueView, number>;
  discardedCount: number;
  discardedHref: string;
  onChange: (q: QueueView) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Tabs value={value ?? ''} onValueChange={(v) => onChange(v as QueueView)}>
        <TabsList className="h-auto flex-wrap" aria-label="Queues">
          {QUEUE_VIEWS.map((q) => (
            <Tooltip key={q}>
              <TooltipTrigger asChild>
                <TabsTrigger value={q} className="gap-1.5">
                  {QUEUE_LABEL[q]}
                  <span className="text-xs tabular-nums text-muted-foreground">{counts[q]}</span>
                </TabsTrigger>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">{QUEUE_HELP[q]}</TooltipContent>
            </Tooltip>
          ))}
        </TabsList>
      </Tabs>
      <Button asChild variant="ghost" size="sm" className={cn('ml-auto text-muted-foreground', value == null && 'bg-muted text-foreground')}>
        <Link to={discardedHref} aria-current={value == null ? 'page' : undefined}>
          <Trash2 />
          Discarded by verifier
          <span className="tabular-nums">{discardedCount}</span>
        </Link>
      </Button>
    </div>
  );
}
