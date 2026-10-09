import { Bug, type LucideIcon, ShieldAlert, UserRound, Wrench } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { KIND_HELP, KIND_LABEL, PERSONAL_DATA_HELP } from '@/lib/domain';
import type { Kind } from '@/lib/types';
import { cn } from '@/lib/utils';

export const KIND_ICON: Record<Kind, LucideIcon> = { vulnerability: ShieldAlert, bug: Bug, chore: Wrench };

const TONE: Record<Kind, string> = {
  vulnerability: 'border-destructive/30 bg-destructive/10 text-destructive',
  bug: 'border-warning/30 bg-warning/10 text-warning',
  chore: 'text-muted-foreground',
};

export function KindBadge({ kind, className }: { kind: Kind | undefined; className?: string }) {
  if (!kind) return null;
  const Icon = KIND_ICON[kind];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="outline" className={cn(TONE[kind], className)}>
          <Icon aria-hidden />
          {KIND_LABEL[kind]}
        </Badge>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{KIND_HELP[kind]}</TooltipContent>
    </Tooltip>
  );
}

export function PersonalDataBadge({ className }: { className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="outline" className={cn('border-info/30 bg-info/10 text-info', className)}>
          <UserRound aria-hidden />
          Personal data
        </Badge>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{PERSONAL_DATA_HELP}</TooltipContent>
    </Tooltip>
  );
}
