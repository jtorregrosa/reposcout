import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export function StatCard({
  label,
  value,
  icon: Icon,
  footer,
  to,
  className,
}: {
  label: string;
  value: ReactNode;
  icon?: LucideIcon;
  footer?: ReactNode;
  to?: string;
  className?: string;
}) {
  const card = (
    <Card className={cn('h-full gap-2', to && 'transition-colors group-hover:border-foreground/20', className)}>
      <CardHeader>
        <CardDescription className="flex items-center justify-between gap-2">
          {label}
          {Icon ? <Icon aria-hidden className="size-4" /> : null}
        </CardDescription>
        <CardTitle className="text-3xl font-semibold tabular-nums">{value}</CardTitle>
      </CardHeader>
      {footer ? <CardContent className="text-xs text-muted-foreground">{footer}</CardContent> : null}
    </Card>
  );
  return to ? (
    <Link to={to} className="group rounded-xl focus-visible:outline-2 focus-visible:outline-ring">
      {card}
    </Link>
  ) : (
    card
  );
}
