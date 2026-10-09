import type { RateLimit } from '../state/types.js';
import type { Emit } from '../telemetry/events.js';

interface ToolUse {
  type: 'tool_use';
  id: string;
  name: string;
  input?: Record<string, unknown>;
}

interface ToolResult {
  type: 'tool_result';
  tool_use_id: string;
  content?: string | { type: string; text?: string }[];
}

interface Text {
  type: 'text';
  text: string;
}

type Content = ToolUse | ToolResult | Text | { type: string };

interface Usage {
  total_tokens?: number;
  tool_uses?: number;
  duration_ms?: number;
}

// One line of `claude --output-format stream-json`. Loosely typed: only the fields RepoScout reads are named.
export interface StreamMessage {
  type: string;
  subtype?: string;
  model?: string;
  agents?: unknown[];
  tools?: unknown;
  task_id?: string;
  tool_use_id?: string;
  subagent_type?: string;
  description?: string;
  last_tool_name?: string;
  status?: string;
  usage?: Usage;
  tool_name?: string;
  decision_reason_type?: string;
  num_turns?: number;
  parent_tool_use_id?: string | null;
  message?: { content?: Content[] | string };
  // On a user message carrying a tool result: the structured result. For an Agent call, its token total, or the
  // acknowledgement of a background launch, whose real reply arrives later as a task notification.
  tool_use_result?: { status?: string; isAsync?: boolean; totalTokens?: number } | string | null;
  rate_limit_info?: {
    status?: string;
    rateLimitType?: string;
    resetsAt?: number;
    unifiedWindows?: { five_hour?: { utilization?: number }; seven_day?: { utilization?: number } };
  };
}

const isToolUse = (c: Content): c is ToolUse => c.type === 'tool_use';
const isToolResult = (c: Content): c is ToolResult => c.type === 'tool_result';
const contentOf = (msg: StreamMessage): Content[] => (Array.isArray(msg.message?.content) ? msg.message.content : []);

// The text of a tool result or a user message, whichever shape it came in.
const textOf = (content: ToolResult['content'] | Content[] | undefined): string =>
  typeof content === 'string'
    ? content
    : (content ?? [])
        .map((c) => ('text' in c && typeof c.text === 'string' ? c.text : ''))
        .filter(Boolean)
        .join('\n');

// A background Agent call answers at once with an acknowledgement; its reply comes later in a task notification.
const LAUNCH_ACK = /async agent launched|running in the background|will be notified (?:automatically )?when/i;
const NOTIFICATION = /<task-notification>([\s\S]*?)<\/task-notification>/g;
const tag = (block: string, name: string) => new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(block)?.[1]?.trim() ?? null;

// The final reply of one subagent instance, in the order they finished.
export interface SubagentReply {
  agent: string;
  text: string;
}

const shortTarget = (input: Record<string, unknown> = {}): unknown =>
  input.file_path ?? input.path ?? input.pattern ?? input.command ?? input.description ?? '';

export interface StreamTracker {
  readonly rateLimit: RateLimit | null;
  readonly firstRateLimit: RateLimit | null;
  readonly turns: number;
  readonly reads: Map<string, Set<string>>;
  // Each subagent's final reply, and the tokens each subagent type used, summed over its instances.
  readonly replies: SubagentReply[];
  readonly tokensByAgent: Record<string, number>;
  handle(msg: StreamMessage): void;
}

// Translates `claude --output-format stream-json` messages into the few events a person watching needs.
// Specialists run as background tasks: each completion wakes the orchestrator for another init/result pair,
// so one session yields several "result" messages. Turns add up across them; the last one is the final result.
export function createStreamTracker({ emit, repo }: { emit: Emit; repo: string }): StreamTracker {
  const agents = new Map<string | undefined, string>();
  // A permission_denied message names only the tool_use_id; this remembers what each call asked for and who
  // asked, so a denial can be reported with its command. Bounded: entries leave when their result arrives.
  const calls = new Map<string, { agent: string; input: Record<string, unknown> | undefined }>();
  // Files each specialist type actually opened: a file assigned but never read is not audited by that type.
  const reads = new Map<string, Set<string>>();
  // The orchestrator's Agent calls by tool_use_id, so a reply can be told apart from any other tool result, and the
  // task ids background agents report under. The latest token total per call, so a total is never counted twice.
  const agentCalls = new Map<string, string>();
  const taskCalls = new Map<string, string>();
  const callTokens = new Map<string, number>();
  const replied = new Set<string>();
  const replies: SubagentReply[] = [];
  let lastLimit: string | null = null;
  let rateLimit: RateLimit | null = null;
  let firstRateLimit: RateLimit | null = null;
  let started = false;
  let turns = 0;

  const noteTokens = (id: string | undefined, tokens: number | undefined) => {
    if (id && typeof tokens === 'number' && tokens >= (callTokens.get(id) ?? 0)) callTokens.set(id, tokens);
  };

  const reply = (id: string | undefined, text: string) => {
    const agent = id ? agentCalls.get(id) : undefined;
    if (!id || !agent || replied.has(id) || !text.trim()) return;
    replied.add(id);
    replies.push({ agent, text });
  };

  // A foreground Agent call returns the subagent's reply as its tool result; a background one only acknowledges
  // the launch, and the reply reaches the orchestrator as a task notification in a later user message.
  const handleUser = (msg: StreamMessage) => {
    const structured = typeof msg.tool_use_result === 'object' && msg.tool_use_result ? msg.tool_use_result : null;
    for (const c of contentOf(msg).filter(isToolResult)) {
      calls.delete(c.tool_use_id);
      if (!agentCalls.has(c.tool_use_id)) continue;
      noteTokens(c.tool_use_id, structured?.totalTokens);
      const text = textOf(c.content);
      if (structured?.isAsync || structured?.status === 'async_launched' || LAUNCH_ACK.test(text)) continue;
      reply(c.tool_use_id, text);
    }
    // Only the orchestrator receives notifications; a subagent's own messages may quote anything.
    if (msg.parent_tool_use_id) return;
    const text = typeof msg.message?.content === 'string' ? msg.message.content : textOf(contentOf(msg).filter((c) => c.type === 'text'));
    for (const [, block = ''] of text.matchAll(NOTIFICATION)) {
      const task = tag(block, 'task-id');
      const result = tag(block, 'result');
      if (result) reply(tag(block, 'tool-use-id') ?? (task ? taskCalls.get(task) : undefined), result);
    }
  };

  const handleSystem = (msg: StreamMessage) => {
    switch (msg.subtype) {
      case 'init':
        if (started) return;
        started = true;
        emit('claude_started', { repo, model: msg.model, agents: (msg.agents ?? []).length, tools: msg.tools });
        return;
      case 'task_started':
        // Background shell commands are tasks too, but not subagents.
        if (!msg.subagent_type) {
          emit('background_task', { repo, task_id: msg.task_id, description: msg.description });
          return;
        }
        agents.set(msg.tool_use_id, msg.subagent_type);
        if (msg.tool_use_id) {
          agentCalls.set(msg.tool_use_id, msg.subagent_type);
          if (msg.task_id) taskCalls.set(msg.task_id, msg.tool_use_id);
        }
        emit('agent_started', { repo, task_id: msg.task_id, agent: msg.subagent_type, description: msg.description });
        return;
      case 'task_progress':
        noteTokens(msg.tool_use_id, msg.usage?.total_tokens);
        emit('agent_progress', {
          repo,
          task_id: msg.task_id,
          agent: msg.subagent_type ?? agents.get(msg.tool_use_id),
          activity: msg.description,
          last_tool: msg.last_tool_name,
          tokens: msg.usage?.total_tokens ?? null,
          tool_uses: msg.usage?.tool_uses ?? null,
          duration_ms: msg.usage?.duration_ms ?? null,
        });
        return;
      case 'task_notification':
        if (!agents.has(msg.tool_use_id)) return;
        noteTokens(msg.tool_use_id, msg.usage?.total_tokens);
        emit('agent_finished', {
          repo,
          task_id: msg.task_id,
          agent: agents.get(msg.tool_use_id) ?? null,
          status: msg.status,
          tokens: msg.usage?.total_tokens ?? null,
          tool_uses: msg.usage?.tool_uses ?? null,
          duration_ms: msg.usage?.duration_ms ?? null,
        });
        return;
      case 'permission_denied': {
        const call = msg.tool_use_id ? calls.get(msg.tool_use_id) : undefined;
        emit('permission_denied', {
          repo,
          tool: msg.tool_name,
          reason: msg.decision_reason_type,
          agent: call?.agent ?? null,
          command: call ? String(shortTarget(call.input)).slice(0, 300) : null,
        });
        return;
      }
      default:
        return;
    }
  };

  const handleRateLimit = (info: NonNullable<StreamMessage['rate_limit_info']>) => {
    rateLimit = {
      status: info.status,
      window: info.rateLimitType,
      resets_at: info.resetsAt ?? null,
      five_hour: info.unifiedWindows?.five_hour?.utilization ?? null,
      seven_day: info.unifiedWindows?.seven_day?.utilization ?? null,
    };
    firstRateLimit ??= rateLimit;
    const key = JSON.stringify(rateLimit);
    if (key !== lastLimit) {
      lastLimit = key;
      emit('rate_limit', { repo, ...rateLimit });
    }
  };

  const handleAssistant = (msg: StreamMessage) => {
    const content = contentOf(msg);
    const agent = msg.parent_tool_use_id ? (agents.get(msg.parent_tool_use_id) ?? 'subagent') : 'orchestrator';
    for (const c of content.filter(isToolUse)) {
      calls.set(c.id, { agent, input: c.input });
      if (!msg.parent_tool_use_id && (c.name === 'Agent' || c.name === 'Task') && typeof c.input?.subagent_type === 'string') {
        agentCalls.set(c.id, c.input.subagent_type);
      }
      if (c.name === 'Read' && c.input?.file_path) {
        const opened = reads.get(agent) ?? new Set<string>();
        opened.add(String(c.input.file_path));
        reads.set(agent, opened);
      }
    }
    if (calls.size > 500) calls.delete(calls.keys().next().value as string);
    if (msg.parent_tool_use_id) return;
    for (const c of content.filter(isToolUse)) {
      if (c.name !== 'Agent' && c.name !== 'Task') emit('orchestrator_tool', { repo, tool: c.name, target: String(shortTarget(c.input)).slice(0, 200) });
    }
  };

  return {
    get rateLimit() {
      return rateLimit;
    },
    get firstRateLimit() {
      return firstRateLimit;
    },
    get turns() {
      return turns;
    },
    get reads() {
      return reads;
    },
    get replies() {
      return replies;
    },
    get tokensByAgent() {
      const out: Record<string, number> = {};
      for (const [id, tokens] of callTokens) {
        const agent = agentCalls.get(id);
        if (agent) out[agent] = (out[agent] ?? 0) + tokens;
      }
      return out;
    },
    handle(msg) {
      switch (msg.type) {
        case 'system':
          return handleSystem(msg);
        case 'rate_limit_event':
          if (msg.rate_limit_info) handleRateLimit(msg.rate_limit_info);
          return;
        case 'assistant':
          return handleAssistant(msg);
        case 'user':
          return handleUser(msg);
        case 'result':
          turns += msg.num_turns ?? 0;
          emit('orchestrator_idle', { repo, subtype: msg.subtype, turns });
          return;
        default:
          return;
      }
    },
  };
}
