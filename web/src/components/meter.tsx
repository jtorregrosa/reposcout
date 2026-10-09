import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type MeterTone = 'default' | 'warning' | 'danger' | 'success';

const FILL: Record<MeterTone, string> = {
  default: 'bg-primary',
  warning: 'bg-warning',
  danger: 'bg-destructive',
  success: 'bg-success',
};

// A thresholded tone for subscription windows: the closer to the limit, the louder.
export const usageTone = (pct: number | null): MeterTone => (pct == null ? 'default' : pct >= 90 ? 'danger' : pct >= 70 ? 'warning' : 'default');

export function Meter({
  value,
  label,
  detail,
  hint,
  tone = 'default',
  size = 'default',
}: {
  value: number;
  label?: ReactNode;
  detail?: ReactNode;
  hint?: ReactNode;
  tone?: MeterTone;
  size?: 'default' | 'sm';
}) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div className="space-y-1.5">
      {label || detail ? (
        <div className="flex items-baseline justify-between gap-2 text-sm">
          <span className="truncate">{label}</span>
          <span className="shrink-0 tabular-nums text-muted-foreground">{detail}</span>
        </div>
      ) : null}
      <meter className="sr-only" min={0} max={100} value={clamped} />
      <div aria-hidden className={cn('overflow-hidden rounded-full bg-muted', size === 'sm' ? 'h-1' : 'h-2')}>
        <div className={cn('h-full rounded-full transition-all', FILL[tone])} style={{ width: `${clamped}%` }} />
      </div>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
