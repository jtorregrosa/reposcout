import { Check, Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Elapsed } from '@/components/time';
import { Badge } from '@/components/ui/badge';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatClock, formatDuration, formatTokens, plural } from '@/lib/format';
import { type AgentInstance, type LiveState, type RepoProgress, STAGES, type Tone } from '@/lib/live';
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
    r.selected != null ? plural(r.selected, 'file') : null,
    r.omitted ? `${r.omitted} over the cap` : null,
    r.pending != null ? `${r.pending} pending` : null,
    r.analyzers && r.analyzers.length < 5 ? r.analyzers.join(', ') : null,
    r.seconds != null ? formatDuration(r.seconds * 1000) : null,
    o?.status === 'ok' ? `${o.new ?? 0} new · ${o.resolved ?? 0} resolved` : null,
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

const SPECIALIST_ORDER = ['security', 'concurrency', 'error-handling', 'logic', 'performance', 'verifier'];
const order = (name: string) => {
  const i = SPECIALIST_ORDER.indexOf(name);
  return i < 0 ? SPECIALIST_ORDER.length : i;
};

function AgentCard({ name, list, running }: { name: string; list: AgentInstance[]; running: boolean }) {
  const active = list.filter((a) => a.status === 'running');
  const failed = list.filter((a) => a.status !== 'running' && a.status !== 'completed');
  const tokens = list.reduce((s, a) => s + (a.tokens ?? 0), 0);
  const tools = list.reduce((s, a) => s + a.toolUses, 0);
  const first = list[0];
  const lastEnd = active.length
    ? null
    : (list
        .map((a) => a.finishedAt)
        .filter((x): x is string => !!x)
        .sort()
        .at(-1) ?? null);
  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium capitalize">
          {name}
          {list.length > 1 ? <span className="ml-1.5 text-xs font-normal text-muted-foreground">×{list.length}</span> : null}
        </span>
        {active.length ? (
          <Badge variant="outline" className="border-info/40 text-info">
            {active.length} running
          </Badge>
        ) : failed.length ? (
          <Badge variant="outline" className="border-destructive/30 text-destructive">
            {failed.length} failed
          </Badge>
        ) : (
          <Badge variant="outline" className="border-success/30 text-success">
            done
          </Badge>
        )}
      </div>
      <div className="min-h-8 space-y-0.5 text-xs text-muted-foreground">
        {active.length ? (
          active.slice(0, 3).map((a) => (
            <p key={a.id} className="truncate">
              {a.activity ?? 'starting…'}
            </p>
          ))
        ) : (
          <p className="truncate">last: {list.at(-1)?.activity ?? '—'}</p>
        )}
      </div>
      <div className="flex flex-wrap gap-x-3 text-xs tabular-nums text-muted-foreground">
        <span>{formatTokens(tokens)} tokens</span>
        <span>{tools} tool calls</span>
        <Elapsed from={first?.startedAt ?? null} to={lastEnd} running={running && active.length > 0} />
      </div>
      {list.some((a) => a.description) ? (
        <Collapsible>
          <CollapsibleTrigger className="text-xs text-muted-foreground underline-offset-4 hover:underline">
            Show {plural(list.length, 'instance')}
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ul className="mt-2 space-y-1 text-xs">
              {list.map((a) => (
                <li key={a.id} className="flex items-center gap-2">
                  <span
                    className={cn(
                      'size-1.5 shrink-0 rounded-full',
                      a.status === 'running' ? 'bg-info' : a.status === 'completed' ? 'bg-success' : 'bg-destructive',
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate">{a.description ?? a.id}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {formatTokens(a.tokens)} · {a.toolUses} calls
                  </span>
                </li>
              ))}
            </ul>
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </div>
  );
}

// While a run is active, a sweep's current pass describes what is happening now; a finished run shows them all.
export function AgentsPanel({ live }: { live: LiveState }) {
  const groups = useMemo(() => {
    const pass = live.active && live.current ? (live.repos.get(live.current)?.pass ?? null) : null;
    const relevant = [...live.agents.values()].filter((a) => !live.active || ((!live.current || a.repo === live.current) && (pass == null || a.pass === pass)));
    const byName = new Map<string, AgentInstance[]>();
    for (const a of relevant) byName.set(a.agent, [...(byName.get(a.agent) ?? []), a]);
    return [...byName.entries()]
      .map(([name, list]) => ({ name, list: list.sort((x, y) => x.startedAt.localeCompare(y.startedAt)) }))
      .sort((x, y) => order(x.name) - order(y.name));
  }, [live]);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Subagents</CardTitle>
        <CardDescription>
          {live.active
            ? live.current
              ? `Working on ${live.current}`
              : 'Specialists and the verifier appear once the Claude audit starts.'
            : 'Every subagent this run started, grouped by type.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {groups.length ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {groups.map((g) => (
              <AgentCard key={g.name} name={g.name} list={g.list} running={live.active} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No subagent activity in this run.</p>
        )}
      </CardContent>
    </Card>
  );
}

const TONE_TEXT: Record<Exclude<Tone, null>, string> = {
  ok: 'text-success',
  warn: 'text-warning',
  danger: 'text-destructive',
};

export function ActivityPanel({ live }: { live: LiveState }) {
  const [problemsOnly, setProblemsOnly] = useState(false);
  const lines = useMemo(
    () =>
      [...live.feed]
        .reverse()
        .filter((l) => !problemsOnly || l.tone === 'warn' || l.tone === 'danger')
        .slice(0, 300),
    [live.feed, problemsOnly],
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>Activity</CardTitle>
        <CardDescription>Newest first.</CardDescription>
        <CardAction className="flex items-center gap-2">
          <Switch id="problems-only" checked={problemsOnly} onCheckedChange={setProblemsOnly} />
          <Label htmlFor="problems-only" className="text-xs font-normal">
            Warnings and errors only
          </Label>
        </CardAction>
      </CardHeader>
      <CardContent>
        {lines.length ? (
          <ol className="max-h-96 space-y-1 overflow-y-auto font-mono text-xs">
            {lines.map((l) => (
              <li key={l.id} className="flex gap-3">
                <time className="shrink-0 text-muted-foreground">{formatClock(l.ts)}</time>
                <span className={cn('min-w-0 break-words', l.tone ? TONE_TEXT[l.tone] : '')}>{l.text}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-muted-foreground">No events.</p>
        )}
      </CardContent>
    </Card>
  );
}

export function DenialsPanel({ live }: { live: LiveState }) {
  if (!live.denials.length) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Blocked by policy · {live.denials.length}</CardTitle>
        <CardDescription>
          Tool calls the permission rules refused. Each costs the subagent a turn; a repeated pattern usually means a prompt should steer it away.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>Agent</TableHead>
              <TableHead>Tool</TableHead>
              <TableHead>Rule</TableHead>
              <TableHead>Command</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {[...live.denials]
              .reverse()
              .slice(0, 50)
              .map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="font-mono text-xs">{formatClock(d.ts)}</TableCell>
                  <TableCell>{d.agent ?? '—'}</TableCell>
                  <TableCell>{d.tool}</TableCell>
                  <TableCell>{d.reason ?? '—'}</TableCell>
                  <TableCell className="max-w-md truncate font-mono text-xs">{d.command ?? '(not recorded)'}</TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
