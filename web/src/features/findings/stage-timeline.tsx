import { useQuery } from '@tanstack/react-query';
import { Milestone } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { STAGE_HELP, STAGE_LABEL, STAGE_SOURCE_LABEL } from '@/lib/domain';
import { formatDateTime } from '@/lib/format';
import { stageHistoryQuery } from '@/lib/queries';
import { stageTimeline } from '@/lib/stages';
import type { FindingView } from '@/lib/types';
import { cn } from '@/lib/utils';

export function StageTimeline({ finding: f }: { finding: FindingView }) {
  const { data, isLoading, error } = useQuery(stageHistoryQuery(f));
  const steps = stageTimeline(data ?? [], f.stage);
  return (
    <section className="space-y-2" aria-labelledby="stage-title">
      <h3 id="stage-title" className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        <Milestone className="size-3.5" />
        Stage
      </h3>
      {isLoading ? <Skeleton className="h-12" /> : null}
      {error ? <p className="text-sm text-muted-foreground">The stage history could not be loaded.</p> : null}
      {data ? (
        <ol className="grid grid-cols-4 gap-2">
          {steps.map((s) => (
            <li key={s.stage} title={STAGE_HELP[s.stage]} aria-current={s.current ? 'step' : undefined} className="space-y-1">
              <div className={cn('h-1.5 rounded-full', s.current ? 'bg-primary' : s.entered ? 'bg-primary/40' : 'bg-border')} />
              <div className={cn('text-sm', s.current ? 'font-semibold' : s.entered ? '' : 'text-muted-foreground')}>{STAGE_LABEL[s.stage]}</div>
              <div className="text-xs text-muted-foreground">{s.entered ? formatDateTime(s.entered) : 'Not reached'}</div>
            </li>
          ))}
        </ol>
      ) : null}
      {f.stage_source ? <p className="text-xs text-muted-foreground">Current stage {STAGE_SOURCE_LABEL[f.stage_source]}.</p> : null}
    </section>
  );
}
