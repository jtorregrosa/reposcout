import { useMemo } from 'react';
import { Elapsed } from '@/components/time';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { formatTokens, plural } from '@/lib/format';
import type { AgentInstance, LiveState } from '@/lib/live';
import { cn } from '@/lib/utils';

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
