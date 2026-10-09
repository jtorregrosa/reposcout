import { Gauge, Lock, type LucideIcon, Split, TriangleAlert, Workflow } from 'lucide-react';
import { CATEGORY_LABEL } from '@/lib/domain';
import type { Category } from '@/lib/types';
import { cn } from '@/lib/utils';

export const CATEGORY_ICON: Record<Category, LucideIcon> = {
  security: Lock,
  concurrency: Split,
  'error-handling': TriangleAlert,
  logic: Workflow,
  performance: Gauge,
};

export function CategoryLabel({ category, className }: { category: Category; className?: string }) {
  const Icon = CATEGORY_ICON[category];
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-muted-foreground', className)}>
      <Icon aria-hidden className="size-3.5" />
      {CATEGORY_LABEL[category]}
    </span>
  );
}
