import { ExternalLink } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { IssueLink } from '@/lib/types';
import { cn } from '@/lib/utils';

// The Jira issue a finding was reported as, opening it in a new tab.
export function IssueBadge({ issue, className }: { issue: Pick<IssueLink, 'key' | 'url'>; className?: string }) {
  return (
    <Badge asChild variant="outline" className={cn('border-stage-reported/40 text-stage-reported', className)}>
      <a href={issue.url} target="_blank" rel="noreferrer" aria-label={`${issue.key}, open in Jira`}>
        {issue.key}
        <ExternalLink aria-hidden />
      </a>
    </Badge>
  );
}
