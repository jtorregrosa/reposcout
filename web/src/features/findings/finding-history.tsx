import { useQuery } from '@tanstack/react-query';
import { History } from 'lucide-react';
import { Link } from 'react-router';
import { Skeleton } from '@/components/ui/skeleton';
import { STATUS_LABEL } from '@/lib/domain';
import { formatDateTime } from '@/lib/format';
import { findingHistoryQuery } from '@/lib/queries';
import type { FindingEvent, FindingStatus } from '@/lib/types';
import { cn } from '@/lib/utils';

const DOT: Record<string, string> = {
  open: 'bg-warning',
  speculative: 'bg-speculative',
  resolved: 'bg-success',
  suppressed: 'bg-muted-foreground',
  refuted: 'bg-muted-foreground',
  duplicate: 'bg-muted-foreground',
  removed: 'bg-border',
};

const label = (status: string | null) => (status ? (STATUS_LABEL[status as FindingStatus] ?? (status === 'removed' ? 'Removed' : status)) : null);

function describe(e: FindingEvent): string {
  if (!e.from_status) return `First reported as ${label(e.to_status)?.toLowerCase()}`;
  if (e.to_status === 'removed') return 'Left the history (file deleted or fingerprint changed)';
  if (e.from_status === e.to_status) return `Reviewed, still ${label(e.to_status)?.toLowerCase()}`;
  return `${label(e.from_status)} → ${label(e.to_status)}`;
}

// Every status the finding has had, newest first, each linked to the run that set it.
export function FindingHistory({ repo, fingerprint }: { repo: string; fingerprint: string }) {
  const { data, isLoading, error } = useQuery(findingHistoryQuery({ repo, fingerprint }));
  return (
    <section className="space-y-2">
      <h3 className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        <History className="size-3.5" />
        History
      </h3>
      {isLoading ? <Skeleton className="h-16" /> : null}
      {error ? <p className="text-sm text-muted-foreground">The history could not be loaded.</p> : null}
      {data && !data.length ? <p className="text-sm text-muted-foreground">No recorded changes.</p> : null}
      {data?.length ? (
        <ol className="relative space-y-3 border-l pl-4">
          {[...data].reverse().map((e) => (
            <li key={`${e.at}|${e.from_status}|${e.to_status}`} className="relative text-sm">
              <span aria-hidden className={cn('absolute top-1.5 -left-5 size-2 rounded-full ring-2 ring-background', DOT[e.to_status] ?? 'bg-border')} />
              <div className="font-medium">{describe(e)}</div>
              <div className="text-xs text-muted-foreground">
                {formatDateTime(e.at)}
                {e.actor ? (
                  ` · by ${e.actor}`
                ) : e.run_id ? (
                  <>
                    {' · '}
                    <Link to={`/runs/${encodeURIComponent(e.run_id.replace(/-p\d+$/, ''))}`} className="underline-offset-4 hover:underline">
                      view run
                    </Link>
                  </>
                ) : (
                  ' · from the state before SQLite'
                )}
              </div>
              {e.note ? <p className="mt-0.5 text-xs">{e.note}</p> : null}
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
