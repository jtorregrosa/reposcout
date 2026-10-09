import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { STATUS_HELP, STATUS_LABEL } from '@/lib/domain';
import type { FindingStatus, FindingView } from '@/lib/types';
import { cn } from '@/lib/utils';

const TONE: Record<FindingStatus, string> = {
  open: 'border-warning/30 bg-warning/10 text-warning',
  speculative: 'border-speculative/30 bg-speculative/10 text-speculative',
  suppressed: 'text-muted-foreground',
  resolved: 'border-success/30 bg-success/10 text-success',
  refuted: 'text-muted-foreground',
  duplicate: 'text-muted-foreground',
};

export function StatusBadge({ finding, className }: { finding: Pick<FindingView, 'status' | 'status_pending' | 'new_last_run'>; className?: string }) {
  const { status, status_pending: pending } = finding;
  const help = pending ? `${STATUS_HELP[status]} Set in repos.yaml; state records it on the next run.` : STATUS_HELP[status];
  return (
    <span className={cn('inline-flex items-center gap-1', className)}>
      {finding.new_last_run && !pending ? <Badge className="bg-info text-primary-foreground">New</Badge> : null}
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="outline" className={cn(TONE[status], pending && 'border-dashed')}>
            {STATUS_LABEL[status]}
            {pending ? ' · pending' : ''}
          </Badge>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">{help}</TooltipContent>
      </Tooltip>
    </span>
  );
}
