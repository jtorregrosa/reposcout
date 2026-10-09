import { Link } from 'react-router';
import { Badge } from '@/components/ui/badge';
import { modeShort } from '@/lib/domain';
import { formatDuration, runLabel } from '@/lib/format';
import type { RunHistoryEntry } from '@/lib/selectors';
import { cn } from '@/lib/utils';

function Outcome({ ok }: { ok: boolean | null }) {
  if (ok == null) return null;
  return (
    <Badge variant="outline" className={ok ? 'border-success/30 text-success' : 'border-warning/40 text-warning'}>
      {ok ? 'ok' : 'problems'}
    </Badge>
  );
}

// The runs on record beside the one shown; the run in progress, when there is one, leads.
export function RunHistoryList({
  runs,
  selected,
  liveRunId,
  active,
}: {
  runs: RunHistoryEntry[];
  selected: string | null;
  liveRunId: string | null;
  active: boolean;
}) {
  const current = selected ?? liveRunId;
  return (
    <nav aria-label="Runs">
      <ul className="divide-y rounded-lg border">
        {runs.map((r) => {
          const live = active && r.runId === liveRunId;
          const isCurrent = r.runId === current;
          return (
            <li key={r.runId}>
              <Link
                to={live ? '/runs' : `/runs/${encodeURIComponent(r.runId)}`}
                aria-current={isCurrent ? 'page' : undefined}
                className={cn('block space-y-1 px-3 py-2 text-sm transition-colors hover:bg-muted/60', isCurrent && 'bg-muted')}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium">{runLabel(r.runId)}</span>
                  {live ? (
                    <Badge variant="outline" className="gap-1.5 border-info/40 text-info">
                      <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-info" />
                      Live
                    </Badge>
                  ) : (
                    <Outcome ok={r.ok} />
                  )}
                </div>
                <div className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                  <span>{r.mode ? modeShort(r.mode) : 'No Claude session'}</span>
                  {r.wallMs != null ? <span>· {formatDuration(r.wallMs)}</span> : null}
                  {r.repos.length ? <span className="truncate">· {r.repos.join(', ')}</span> : null}
                </div>
              </Link>
            </li>
          );
        })}
        {runs.length ? null : <li className="px-3 py-6 text-center text-sm text-muted-foreground">No run recorded yet.</li>}
      </ul>
    </nav>
  );
}
