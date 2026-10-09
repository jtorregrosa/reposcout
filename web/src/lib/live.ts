import { formatDuration } from './format';
import type { RunEvent } from './types';

export const STAGES = [
  ['started', 'Started'],
  ['fetched', 'Fetched'],
  ['selected', 'Files selected'],
  ['auditing', 'Auditing'],
  ['postprocessing', 'Post-processing'],
  ['done', 'Done'],
] as const;

export type Stage = (typeof STAGES)[number][0] | 'pending';

export type Tone = 'ok' | 'warn' | 'danger' | null;

export interface RepoOutcome {
  status: string;
  new?: number;
  resolved?: number;
  speculative?: number;
  refuted?: number;
  tried?: number;
  reproduced?: number;
  not_reproduced?: number;
  not_testable?: number;
  files_read?: number;
  files_selected?: number;
  sweep?: boolean;
  passes?: number;
  stopped?: string;
  reason?: string;
  error?: string;
}

export interface RepoProgress {
  name: string;
  stage: Stage;
  mode: string | null;
  analyzers: string[] | null;
  selected: number | null;
  omitted: number | null;
  pass: number | null;
  pending: number | null;
  outcome: RepoOutcome | null;
  seconds: number | null;
  startedAt: string | null;
}

export interface AgentInstance {
  id: string;
  repo: string | null;
  pass: number | null;
  agent: string;
  description: string | null;
  status: string;
  activity: string | null;
  tokens: number | null;
  toolUses: number;
  durationMs: number | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface FeedLine {
  id: number;
  ts: string;
  text: string;
  tone: Tone;
}

export interface Denial {
  id: number;
  ts: string;
  agent: string | null;
  tool: string;
  reason: string | null;
  command: string | null;
}

export interface LiveRate {
  status?: string;
  five_hour?: number | null;
  seven_day?: number | null;
  resets_at?: number | null;
}

export interface LiveState {
  runId: string | null;
  active: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  exit: number | null;
  prepareOnly: boolean;
  mode: string | null;
  current: string | null;
  repos: Map<string, RepoProgress>;
  agents: Map<string, AgentInstance>;
  rateLimit: LiveRate | null;
  feed: FeedLine[];
  denials: Denial[];
  // Gives feed lines and denials a stable React key; events carry no id of their own.
  seq: number;
}

const MAX_FEED = 500;

export function emptyLive(runId: string | null = null, active = false): LiveState {
  return {
    runId,
    active,
    startedAt: null,
    finishedAt: null,
    exit: null,
    prepareOnly: false,
    mode: null,
    current: null,
    repos: new Map(),
    agents: new Map(),
    rateLimit: null,
    feed: [],
    denials: [],
    seq: 0,
  };
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);

// Folds a batch of run events into a new state. The previous state is never mutated, so React sees a new object
// for every batch while one batch of many events costs a single copy.
export function applyEvents(previous: LiveState, events: RunEvent[]): LiveState {
  const s: LiveState = {
    ...previous,
    repos: new Map([...previous.repos].map(([k, v]) => [k, { ...v }])),
    agents: new Map([...previous.agents].map(([k, v]) => [k, { ...v }])),
    feed: [...previous.feed],
    denials: [...previous.denials],
  };
  for (const ev of events) apply(s, ev);
  if (s.feed.length > MAX_FEED) s.feed.splice(0, s.feed.length - MAX_FEED);
  return s;
}

function repoOf(s: LiveState, name: string): RepoProgress {
  let r = s.repos.get(name);
  if (!r) {
    r = {
      name,
      stage: 'pending',
      mode: null,
      analyzers: null,
      selected: null,
      omitted: null,
      pass: null,
      pending: null,
      outcome: null,
      seconds: null,
      startedAt: null,
    };
    s.repos.set(name, r);
  }
  return r;
}

function apply(s: LiveState, ev: RunEvent): void {
  const say = (text: string, tone: Tone = null) => s.feed.push({ id: s.seq++, ts: ev.ts, text, tone });
  const name = str(ev.repo);
  const repo = name ? repoOf(s, name) : null;
  switch (ev.type) {
    case 'run_started': {
      const repos = Array.isArray(ev.repos) ? (ev.repos as string[]) : [];
      s.startedAt = ev.ts;
      s.prepareOnly = ev.prepare_only === true;
      s.mode = str(ev.mode);
      for (const r of repos) repoOf(s, r);
      say(`Run started for ${repos.join(', ')}${s.mode ? ` (${s.mode})` : ''}`);
      return;
    }
    case 'sweep_pass':
      if (repo) repo.pass = num(ev.pass);
      say(`${name}: sweep pass ${ev.pass} ${ev.proceed ? 'starting' : 'not started'} · ${ev.reason}`, ev.proceed ? null : 'warn');
      return;
    case 'sweep_progress': {
      if (repo) repo.pending = num(ev.pending);
      const cost = ev.cost as { five_hour?: number } | null;
      say(
        `${name}: pass ${ev.pass} done · ${ev.pending} files still pending${cost?.five_hour != null ? ` · ~${Math.round(cost.five_hour * 100)}% of the 5-hour window` : ''}`,
      );
      return;
    }
    case 'repo_started':
      if (!repo) return;
      repo.stage = 'started';
      repo.startedAt = ev.ts;
      s.current = name;
      say(`${name}: started`);
      return;
    case 'repo_stage': {
      if (!repo) return;
      repo.stage = (str(ev.stage) ?? repo.stage) as Stage;
      const models = ev.models as Record<string, string> | undefined;
      if (ev.stage === 'fetched') say(`${name}: fetched ${String(ev.head ?? '').slice(0, 10)}`);
      if (ev.stage === 'auditing') say(`${name}: Claude audit started (specialists ${models?.specialists ?? '?'}, verifier ${models?.verifier ?? '?'})`);
      if (ev.stage === 'postprocessing') say(`${name}: validating findings and updating history`);
      return;
    }
    case 'files_selected':
      if (!repo) return;
      repo.stage = 'selected';
      repo.mode = str(ev.mode);
      repo.selected = num(ev.selected);
      repo.omitted = num(ev.omitted);
      repo.analyzers = Array.isArray(ev.analyzers) ? (ev.analyzers as string[]) : null;
      say(`${name}: ${ev.selected} files selected (${ev.mode})${ev.omitted ? `, ${ev.omitted} over the cap` : ''}`);
      return;
    case 'agent_started': {
      const id = String(ev.task_id);
      s.agents.set(id, {
        id,
        repo: name,
        pass: repo?.pass ?? null,
        agent: str(ev.agent) ?? 'subagent',
        description: str(ev.description),
        status: 'running',
        activity: null,
        tokens: null,
        toolUses: 0,
        durationMs: null,
        startedAt: ev.ts,
        finishedAt: null,
      });
      say(`${ev.agent} started${ev.description ? `: ${ev.description}` : ''}`);
      return;
    }
    case 'agent_progress': {
      const id = String(ev.task_id);
      const a = s.agents.get(id) ?? {
        id,
        repo: name,
        pass: repo?.pass ?? null,
        agent: str(ev.agent) ?? 'subagent',
        description: null,
        status: 'running',
        activity: null,
        tokens: null,
        toolUses: 0,
        durationMs: null,
        startedAt: ev.ts,
        finishedAt: null,
      };
      a.activity = str(ev.activity) ?? a.activity;
      a.tokens = num(ev.tokens) ?? a.tokens;
      a.toolUses = num(ev.tool_uses) ?? a.toolUses;
      a.durationMs = num(ev.duration_ms) ?? a.durationMs;
      s.agents.set(id, a);
      return;
    }
    case 'agent_finished': {
      const a = s.agents.get(String(ev.task_id));
      if (a) {
        a.status = str(ev.status) ?? 'completed';
        a.finishedAt = ev.ts;
        a.tokens = num(ev.tokens) ?? a.tokens;
        a.toolUses = num(ev.tool_uses) ?? a.toolUses;
        a.durationMs = num(ev.duration_ms) ?? a.durationMs;
      }
      say(`${a?.agent ?? ev.agent ?? 'subagent'} ${ev.status ?? 'finished'}`, ev.status === 'completed' ? 'ok' : 'danger');
      return;
    }
    case 'background_task':
      say(`orchestrator background command: ${ev.description ?? ''}`);
      return;
    case 'permission_denied':
      s.denials.push({ id: s.seq++, ts: ev.ts, agent: str(ev.agent), tool: String(ev.tool ?? '?'), reason: str(ev.reason), command: str(ev.command) });
      say(`${ev.agent ?? name}: blocked by policy (${ev.reason ?? 'rule'}): ${ev.tool}${ev.command ? ` ${ev.command}` : ''}`, 'warn');
      return;
    case 'rate_limit':
      s.rateLimit = { status: str(ev.status) ?? undefined, five_hour: num(ev.five_hour), seven_day: num(ev.seven_day), resets_at: num(ev.resets_at) };
      if (ev.status && !String(ev.status).startsWith('allowed')) say(`Subscription limit: ${ev.status}`, 'danger');
      return;
    case 'orchestrator_tool':
      say(`orchestrator ${ev.tool}: ${ev.target}`);
      return;
    case 'claude_resumed':
      say(`${name}: orchestrator stopped before writing its output; resuming the session to verify and write it`, 'warn');
      return;
    case 'claude_finished':
      say(
        `${name}: Claude finished (${ev.timed_out ? 'timed out' : (ev.subtype ?? 'no result')}, ${ev.num_turns ?? '?'} orchestrator turns, ${formatDuration(num(ev.wall_ms))})`,
        ev.is_error || ev.timed_out ? 'danger' : 'ok',
      );
      return;
    case 'validation_budget':
      if (ev.proceed === false) say(`${name}: validation stopped before this repository: ${str(ev.reason) ?? 'budget'}`, 'warn');
      return;
    case 'repo_finished': {
      if (!repo) return;
      const outcome = ev as unknown as RepoOutcome;
      repo.stage = 'done';
      repo.outcome = outcome;
      repo.seconds = num(ev.seconds);
      const detail =
        outcome.status !== 'ok'
          ? ''
          : outcome.tried != null
            ? `, ${outcome.reproduced ?? 0} of ${outcome.tried} reproduced`
            : `, ${outcome.new ?? 0} new, ${outcome.resolved ?? 0} resolved`;
      say(
        `${name}: ${outcome.status}${detail}${outcome.reason ? ` (${outcome.reason})` : ''}${outcome.error ? `: ${outcome.error}` : ''}`,
        outcome.status === 'failed' ? 'danger' : outcome.status === 'deferred' ? 'warn' : 'ok',
      );
      return;
    }
    case 'run_cancelled':
      say('Run cancelled from the dashboard; state was not updated', 'warn');
      return;
    case 'run_finished':
      s.finishedAt = ev.ts;
      s.exit = num(ev.exit);
      s.active = false;
      say(`Run finished with exit code ${ev.exit}`, ev.exit === 0 ? 'ok' : 'warn');
      return;
    default:
      return;
  }
}

export type RunStatus = 'running' | 'finished' | 'failed' | 'interrupted' | 'idle';

export function runStatus(live: LiveState): RunStatus {
  if (live.active) return 'running';
  if (live.finishedAt) return live.exit === 0 ? 'finished' : 'failed';
  if (live.runId) return 'interrupted';
  return 'idle';
}

const EXIT_MEANING: Record<number, string> = {
  0: 'every repository was audited or skipped',
  1: 'a repository failed',
  2: 'another run held the lock',
  3: 'stopped at the subscription usage limit',
  4: 'cancelled from the dashboard',
  5: 'a sweep stopped at the session or weekly budget',
};

export const exitMeaning = (code: number | null) => (code == null ? null : (EXIT_MEANING[code] ?? `exit code ${code}`));
