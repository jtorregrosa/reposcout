import { Check, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDuration, plural } from '@/lib/format';
import { type LiveState, type RepoProgress, STAGES } from '@/lib/live';
import { cn } from '@/lib/utils';

const OUTCOME_TONE: Record<string, string> = {
  ok: 'border-success/30 text-success',
  skipped: 'text-muted-foreground',
  prepared: 'text-muted-foreground',
  deferred: 'border-warning/40 text-warning',
  cancelled: 'border-warning/40 text-warning',
  failed: 'border-destructive/30 text-destructive',
};

function Stepper({ repo }: { repo: RepoProgress }) {
  const current = STAGES.findIndex(([k]) => k === repo.stage);
  return (
    <ol className="flex flex-wrap items-center gap-x-1 gap-y-2 text-xs">
      {STAGES.map(([key, label], i) => {
        const done = repo.stage === 'done' || i < current;
        const active = i === current && repo.stage !== 'done';
        return (
          <li key={key} className="flex items-center gap-1">
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-full border px-2 py-0.5',
                done && 'border-success/30 text-success',
                active && 'border-info/40 text-info',
                !done && !active && 'text-muted-foreground',
              )}
              aria-current={active ? 'step' : undefined}
            >
              {done ? <Check className="size-3" /> : active ? <Loader2 className="size-3 animate-spin" /> : null}
              {label}
            </span>
            {i < STAGES.length - 1 ? <span aria-hidden className="h-px w-2 bg-border" /> : null}
          </li>
        );
      })}
    </ol>
  );
}

function outcomeFacts(r: RepoProgress): string[] {
  const o = r.outcome;
  return [
    r.mode,
    r.pass ? `pass ${r.pass}` : null,
    r.selected != null ? plural(r.selected, r.mode === 'validate' ? 'finding' : 'file') : null,
    r.omitted ? `${r.omitted} over the cap` : null,
    r.pending != null ? `${r.pending} pending` : null,
    r.analyzers && r.analyzers.length < 5 ? r.analyzers.join(', ') : null,
    r.seconds != null ? formatDuration(r.seconds * 1000) : null,
    o?.status === 'ok' && o.tried == null ? `${o.new ?? 0} new · ${o.resolved ?? 0} resolved` : null,
    o?.status === 'ok' && o.tried != null
      ? `${o.tried} tried · ${o.reproduced ?? 0} reproduced · ${o.not_reproduced ?? 0} not reproduced · ${o.not_testable ?? 0} not testable`
      : null,
    o?.speculative ? `${o.speculative} speculative` : null,
    o?.refuted ? `${o.refuted} refuted` : null,
    o?.files_selected ? `read ${o.files_read}/${o.files_selected}` : null,
    o?.sweep ? `${o.passes} passes, stopped: ${o.stopped}` : null,
  ].filter((x): x is string => !!x);
}

export function RepositoriesPanel({ live }: { live: LiveState }) {
  const repos = [...live.repos.values()];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Repositories in this run</CardTitle>
        <CardDescription>{repos.length ? `${repos.filter((r) => r.stage === 'done').length} of ${repos.length} done` : 'None yet.'}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {repos.map((r) => (
          <div key={r.name} className="space-y-2 rounded-lg border p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{r.name}</span>
              {r.outcome ? (
                <Badge variant="outline" className={OUTCOME_TONE[r.outcome.status] ?? ''}>
                  {r.outcome.status}
                </Badge>
              ) : r.stage === 'pending' ? (
                <Badge variant="outline" className="text-muted-foreground">
                  waiting
                </Badge>
              ) : (
                <Badge variant="outline" className="border-info/40 text-info">
                  in progress
                </Badge>
              )}
            </div>
            <Stepper repo={r} />
            {outcomeFacts(r).length ? <p className="text-xs text-muted-foreground">{outcomeFacts(r).join(' · ')}</p> : null}
            {r.outcome?.error || r.outcome?.reason ? <p className="text-xs">{r.outcome.error ?? r.outcome.reason}</p> : null}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
