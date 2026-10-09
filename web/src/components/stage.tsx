import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { STAGE_HELP, STAGE_LABEL, STAGES } from '@/lib/domain';
import type { Stage } from '@/lib/types';
import { cn } from '@/lib/utils';

// Spelled out per stage so Tailwind finds every class at build time.
export const STAGE_FILL: Record<Stage, string> = {
  detected: 'bg-stage-detected',
  validated: 'bg-stage-validated',
  reported: 'bg-stage-reported',
  fixed: 'bg-stage-fixed',
};

export const STAGE_TEXT: Record<Stage, string> = {
  detected: 'text-stage-detected',
  validated: 'text-stage-validated',
  reported: 'text-stage-reported',
  fixed: 'text-stage-fixed',
};

// Four segments filled up to the finding's stage, for a header where the full timeline would not fit.
export function StageProgress({ stage, className }: { stage: Stage; className?: string }) {
  const reached = STAGES.indexOf(stage);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className={cn('inline-flex items-center gap-2', className)}>
          <ol aria-label={`Stage: ${STAGE_LABEL[stage]}`} className="flex gap-0.5">
            {STAGES.map((s, i) => (
              <li
                key={s}
                aria-current={s === stage ? 'step' : undefined}
                className={cn('h-1.5 w-5 rounded-full', i <= reached ? STAGE_FILL[stage] : 'bg-border')}
              />
            ))}
          </ol>
          <span className={cn('text-xs font-medium', STAGE_TEXT[stage])}>{STAGE_LABEL[stage]}</span>
        </div>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{STAGE_HELP[stage]}</TooltipContent>
    </Tooltip>
  );
}
