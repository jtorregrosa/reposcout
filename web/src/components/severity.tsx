import { Badge } from '@/components/ui/badge';
import type { Severity } from '@/lib/types';
import { cn } from '@/lib/utils';

// Spelled out per severity so Tailwind finds every class at build time.
const BADGE: Record<Severity, string> = {
  critical: 'border-severity-critical/30 bg-severity-critical/10 text-severity-critical',
  high: 'border-severity-high/30 bg-severity-high/10 text-severity-high',
  medium: 'border-severity-medium/30 bg-severity-medium/10 text-severity-medium',
  low: 'border-severity-low/30 bg-severity-low/10 text-severity-low',
};

const DOT: Record<Severity, string> = {
  critical: 'bg-severity-critical',
  high: 'bg-severity-high',
  medium: 'bg-severity-medium',
  low: 'bg-severity-low',
};

const TEXT: Record<Severity, string> = {
  critical: 'text-severity-critical',
  high: 'text-severity-high',
  medium: 'text-severity-medium',
  low: 'text-severity-low',
};

const BORDER: Record<Severity, string> = {
  critical: 'border-l-severity-critical',
  high: 'border-l-severity-high',
  medium: 'border-l-severity-medium',
  low: 'border-l-severity-low',
};

export const severityText = (s: Severity) => TEXT[s];
export const severityBorder = (s: Severity) => BORDER[s];
export const severityFill = (s: Severity) => DOT[s];

export function SeverityBadge({ severity, className }: { severity: Severity; className?: string }) {
  return (
    <Badge variant="outline" className={cn('capitalize', BADGE[severity], className)}>
      {severity}
    </Badge>
  );
}

export function SeverityDot({ severity, className }: { severity: Severity; className?: string }) {
  return <span aria-hidden className={cn('inline-block size-2 shrink-0 rounded-full', DOT[severity], className)} />;
}
