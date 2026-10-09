import {
  type ChildProcess,
  type ChildProcessByStdio,
  type SpawnOptionsWithStdioTuple,
  type StdioNull,
  type StdioPipe,
  spawn,
  spawnSync,
} from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Readable } from 'node:stream';
import type { AuthMode } from '../config/analyzers.js';
import type { ClaudeConfig } from '../config/config.js';
import { redact } from '../security/secrets.js';
import type { RateLimit } from '../state/types.js';
import type { AgentDefinition } from './agents.js';
import type { ClaudeSettings } from './settings.js';
import type { StreamMessage } from './stream.js';

export function claudeEnv({ rootDir, auth }: { rootDir: string; auth: AuthMode }): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const k of Object.keys(env)) {
    if (/^(REPOSCOUT_|ANTHROPIC_API_KEY$|ANTHROPIC_AUTH_TOKEN$|GIT_CONFIG_)/.test(k)) delete env[k];
  }
  Object.assign(env, {
    CLAUDE_CODE_DISABLE_CLAUDE_MDS: '1',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    DISABLE_AUTOUPDATER: '1',
    // Claude keeps CLAUDE_CODE_OAUTH_TOKEN for its own API calls; every Bash child (git, the test) runs without it.
    CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: '1',
  });
  if (auth === 'isolated') {
    if (!env.CLAUDE_CODE_OAUTH_TOKEN) {
      throw new Error(
        'claude.auth is "isolated" but CLAUDE_CODE_OAUTH_TOKEN is not set. Run `claude setup-token` and add it to .env, or set claude.auth: login.',
      );
    }
    const home = join(rootDir, '.claude-home');
    mkdirSync(home, { recursive: true });
    env.CLAUDE_CONFIG_DIR = home;
  } else {
    delete env.CLAUDE_CODE_OAUTH_TOKEN;
  }
  return env;
}

export function killTree(pid: number | undefined, fallback?: ChildProcess): void {
  if (pid == null) return;
  // By absolute path: a PATH without System32 (a scheduled task, some shells) would make the kill fail silently.
  if (process.platform === 'win32')
    spawnSync(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe'), ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
  else {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      if (fallback) fallback.kill('SIGKILL');
      else process.kill(pid, 'SIGKILL');
    }
  }
}

// The transcript holds audited source, so it is deleted once the run is over, with the tool results beside it.
export function forgetSession({ env, sessionId }: { env: NodeJS.ProcessEnv; sessionId: string | null | undefined }): void {
  const projects = join(env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), 'projects');
  if (!sessionId || !existsSync(projects)) return;
  for (const dir of readdirSync(projects)) {
    rmSync(join(projects, dir, `${sessionId}.jsonl`), { force: true });
    rmSync(join(projects, dir, sessionId), { recursive: true, force: true });
  }
}

// The final `result` message of a stream-json session; only the fields RepoScout reads are typed.
export interface ClaudeResult {
  type: 'result';
  subtype?: string;
  is_error?: boolean;
  result?: string;
  errors?: string[];
  num_turns?: number;
  duration_ms?: number;
  total_cost_usd?: number;
  terminal_reason?: string;
  api_error_status?: number;
  modelUsage?: Record<string, { inputTokens: number; outputTokens: number; cacheReadInputTokens: number; cacheCreationInputTokens: number }>;
  subagent_stats?: { completed: number; failed: number; by_type?: Record<string, unknown> };
  permission_denials?: { tool_name: string; tool_input: unknown }[];
}

export interface ClaudeRun {
  exitCode: number | null;
  timedOut: boolean;
  cancelled: boolean;
  spawnError: string | null;
  wallMs: number;
  result: ClaudeResult | null;
  unparsedLines: number;
  stdout: string;
  stderr: string;
  args: string[];
  rateLimit?: RateLimit | null;
}

export interface RunClaudeOptions {
  rootDir: string;
  workDir: string;
  prompt: string;
  claudeCfg: ClaudeConfig;
  agents: Record<string, AgentDefinition>;
  settings: ClaudeSettings;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  onMessage?: (msg: StreamMessage) => void;
  shouldCancel?: () => boolean;
  sessionId: string;
  resume?: boolean;
  // The tools the session may use; an audit needs them all, a narrower job fewer.
  tools?: string[];
}

export type ClaudeSpawnFn = (
  command: string,
  args: string[],
  options: SpawnOptionsWithStdioTuple<StdioNull, StdioPipe, StdioPipe>,
) => ChildProcessByStdio<null, Readable, Readable>;

export interface RunClaudeDeps {
  spawnFn?: ClaudeSpawnFn;
}

// How long a killed session may take to close its pipes. If taskkill fails, or a grandchild keeps them open,
// the run is settled anyway so it never holds state/.lock forever.
export const KILL_GRACE_MS = 10_000;

export function runClaude(
  {
    rootDir,
    workDir,
    prompt,
    claudeCfg,
    agents,
    settings,
    env,
    timeoutMs,
    onMessage,
    shouldCancel,
    sessionId,
    resume = false,
    tools = ['Read', 'Grep', 'Glob', 'Bash', 'Write', 'Task'],
  }: RunClaudeOptions,
  { spawnFn = spawn }: RunClaudeDeps = {},
): Promise<ClaudeRun> {
  const agentsFile = join(workDir, 'agents.json');
  const settingsFile = join(workDir, 'settings.json');
  writeFileSync(agentsFile, JSON.stringify(agents, null, 2));
  writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
  const args = [
    '-p',
    prompt,
    '--output-format',
    'stream-json',
    '--verbose',
    '--model',
    claudeCfg.models.orchestrator,
    '--max-turns',
    String(claudeCfg.max_turns),
    '--agents',
    agentsFile,
    '--settings',
    settingsFile,
    '--setting-sources',
    'project',
    '--permission-mode',
    'dontAsk',
    '--strict-mcp-config',
    '--tools',
    tools.join(','),
    // Persisted only so a session that ends before writing its output can be resumed; forgetSession removes it.
    ...(resume ? ['--resume', sessionId] : ['--session-id', sessionId]),
  ];
  if (claudeCfg.fallback_model && claudeCfg.fallback_model !== claudeCfg.models.orchestrator) {
    args.push('--fallback-model', claudeCfg.fallback_model);
  }

  return new Promise((resolvePromise) => {
    const started = Date.now();
    const bin = claudeCommand(args);
    const child = spawnFn(bin.command, bin.args, {
      cwd: rootDir,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
      windowsHide: true,
    });
    // stream-json carries every tool result, file contents included, so it is consumed line by line and never kept.
    let pending = '';
    let result: ClaudeResult | null = null;
    let unparsed = 0;
    let stderr = '';
    let timedOut = false;
    let cancelled = false;
    let settled = false;
    const consume = (line: string) => {
      if (!line.trim()) return;
      let msg: StreamMessage;
      try {
        msg = JSON.parse(line) as StreamMessage;
      } catch {
        unparsed++;
        return;
      }
      if (msg.type === 'result') result = msg as unknown as ClaudeResult;
      try {
        onMessage?.(msg);
      } catch {
        // A failing observer must never break the audit itself.
      }
    };
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      pending += chunk;
      let nl = pending.indexOf('\n');
      while (nl >= 0) {
        consume(pending.slice(0, nl));
        pending = pending.slice(nl + 1);
        nl = pending.indexOf('\n');
      }
    });
    child.stderr.on('data', (d: Buffer) => {
      stderr += d;
    });
    let graceTimer: NodeJS.Timeout | null = null;
    const kill = () => {
      killTree(child.pid, child);
      graceTimer ??= setTimeout(() => {
        // The tree did not close its pipes in time; drop them so they cannot keep the event loop alive either.
        child.stdout.destroy();
        child.stderr.destroy();
        child.unref();
        finish(null, null);
      }, KILL_GRACE_MS);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, timeoutMs);
    const cancelPoll = shouldCancel
      ? setInterval(() => {
          if (!cancelled && shouldCancel()) {
            cancelled = true;
            kill();
          }
        }, 1000)
      : null;
    const finish = (code: number | null, spawnError: Error | null) => {
      // 'error' and 'close' can both fire for one failed spawn, and 'close' may still come after the grace period.
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (graceTimer) clearTimeout(graceTimer);
      if (cancelPoll) clearInterval(cancelPoll);
      child.stdout.removeAllListeners('data');
      child.stderr.removeAllListeners('data');
      consume(pending);
      resolvePromise({
        exitCode: code,
        timedOut,
        cancelled,
        spawnError: spawnError ? String(spawnError.message) : null,
        wallMs: Date.now() - started,
        result,
        unparsedLines: unparsed,
        stdout: result ? redact(JSON.stringify(result)) : '',
        stderr: redact(stderr),
        args: args.map((a) => (a === prompt ? '<prompt>' : a)),
      });
    };
    child.on('error', (e) => finish(null, e));
    child.on('close', (code) => finish(code, null));
  });
}

const USAGE_LIMIT = /usage limit|rate limit|hit your (?:usage )?limit|limit reached|limit will reset|too many requests|out of (?:extra )?usage/i;

// A subscription limit fails every later repository the same way, so the run stops instead of burning through them.
export function isUsageLimit(run: Partial<Pick<ClaudeRun, 'result' | 'stderr' | 'rateLimit'>> | null | undefined): boolean {
  const r = run?.result;
  if (r?.api_error_status === 429) return true;
  if (r && r.subtype === 'success' && !r.is_error) return false;
  if (run?.rateLimit?.status && !String(run.rateLimit.status).startsWith('allowed')) return true;
  const text = [r?.result, ...(r?.errors ?? []), run?.stderr].filter(Boolean).join('\n');
  return USAGE_LIMIT.test(text);
}

export function claudeVersion(): string | null {
  // A run calls this while holding state/.lock, so a CLI that hangs reads as "not available" instead.
  const bin = claudeCommand(['--version']);
  const r = spawnSync(bin.command, bin.args, { encoding: 'utf8', timeout: 30_000, windowsHide: true });
  return r.status === 0 ? r.stdout.trim() : null;
}

// REPOSCOUT_CLAUDE_BIN replaces the `claude` executable, for the end-to-end tests' fake. It is read from this
// process's environment, since the session's own has every REPOSCOUT_ variable stripped. A .js or .mjs script is
// run with this Node, so a fake starts on Windows too without a shell or a .cmd shim.
export function claudeCommand(args: string[], env: NodeJS.ProcessEnv = process.env): { command: string; args: string[] } {
  const bin = env.REPOSCOUT_CLAUDE_BIN?.trim();
  if (!bin) return { command: 'claude', args };
  return /\.m?js$/i.test(bin) ? { command: process.execPath, args: [resolve(bin), ...args] } : { command: bin, args };
}
