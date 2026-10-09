import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildAgents } from '../claude/agents.js';
import { type ClaudeRun, claudeEnv, forgetSession, isUsageLimit, runClaude } from '../claude/session.js';
import { buildSettings, toPosix } from '../claude/settings.js';
import { createStreamTracker, type StreamTracker } from '../claude/stream.js';
import type { Analyzer, Mode } from '../config/analyzers.js';
import type { ClaudeConfig, RepoConfig } from '../config/config.js';
import { CancelledError, UsageLimitError } from '../errors.js';
import type { RawFindings } from '../findings/types.js';
import { addVerifyWorktree, type Git, removeVerifyWorktree } from '../git/git.js';
import { PACKAGE_DIR } from '../paths.js';
import type { RunUsage } from '../report/types.js';
import { passCost } from './budget.js';
import type { AuditOptions, RunContext } from './context.js';
import { promptVersion } from './prompts.js';
import { type CapturedReply, writeReplies } from './specialists.js';

export interface SessionInput {
  ctx: RunContext;
  repo: RepoConfig;
  opts: AuditOptions;
  git: Git;
  head: string;
  cloneDir: string;
  workDir: string;
  manifestPath: string;
  rawOutput: string;
  verifyDir: string | null;
  mode: Mode;
  range: string;
  analyzers: Analyzer[];
  runAt: string;
  fileCount: number;
}

export interface SessionOutcome {
  run: ClaudeRun;
  tracker: StreamTracker;
  usage: RunUsage;
  raw: RawFindings;
  // Each subagent's reply as captured under <workDir>/specialists/, and the prompts' version.
  captured: CapturedReply[];
  promptVersion: string;
}

// Runs the /audit session, resuming it once when it ends before writing its output, then records what it cost
// and turns every way it can fail into the error the run loop expects.
export async function runAuditSession(input: SessionInput): Promise<SessionOutcome> {
  const { ctx, repo, opts, git, head, cloneDir, workDir, manifestPath, rawOutput, verifyDir, mode, range, analyzers } = input;
  const { layout, events, log } = ctx;
  const claudeCfg: ClaudeConfig = { ...repo.claude, auth: opts.auth ?? repo.claude.auth };
  if (verifyDir) addVerifyWorktree({ git, path: verifyDir, head });
  const tracker = createStreamTracker({ emit: events.emit, repo: repo.name });
  // Hashed when the session starts, over the prompts it is about to load.
  const prompts = promptVersion(PACKAGE_DIR);
  events.emit('repo_stage', { repo: repo.name, stage: 'auditing', models: claudeCfg.models });
  const sessionEnv = claudeEnv({ rootDir: layout.root, auth: claudeCfg.auth });
  const sessionId = randomUUID();
  // timeout_minutes bounds the whole session, so a resume gets only what the first call left.
  const timeoutMs = claudeCfg.timeout_minutes * 60_000;
  const deadline = Date.now() + timeoutMs;
  let resumeSkipped: number | null = null;
  let run: ClaudeRun;
  try {
    const call = (prompt: string, resume: boolean, budgetMs: number) =>
      runClaude({
        // Started in the package, whose .claude/ holds the skill; the data root only holds its config dir.
        rootDir: PACKAGE_DIR,
        workDir,
        prompt,
        claudeCfg,
        agents: buildAgents({ rootDir: PACKAGE_DIR, models: claudeCfg.models, maxTurns: claudeCfg.subagent_max_turns, analyzers }),
        settings: buildSettings({
          rootDir: PACKAGE_DIR,
          dataDir: layout.root,
          cloneDir,
          workDir,
          outputFile: rawOutput,
          verifyDir,
          testCommand: repo.test_command,
        }),
        env: sessionEnv,
        timeoutMs: budgetMs,
        onMessage: tracker.handle,
        shouldCancel: opts.isCancelled,
        sessionId,
        resume,
      });
    run = await call(`/audit ${toPosix(cloneDir)} ${range} ${mode} ${toPosix(manifestPath)}`, false, timeoutMs);
    // The orchestrator waits for background specialists by ending its turn. When the last ones report while it
    // is still mid-turn, it can end believing some are outstanding, and the session closes with no output.
    if (mode !== 'speculative' && run.result?.subtype === 'success' && !run.cancelled && !run.timedOut && !existsSync(rawOutput)) {
      const said = String(run.result.result ?? '').slice(0, 200);
      const remaining = resumeBudget(deadline);
      if (remaining === null) {
        resumeSkipped = Math.max(0, deadline - Date.now());
        log.warn('Claude ended before writing its output, with too little of the timeout left to resume', {
          repo: repo.name,
          said,
          remaining_s: Math.round(resumeSkipped / 1000),
        });
      } else {
        log.warn('Claude ended before writing its output; resuming the session once', { repo: repo.name, said, remaining_s: Math.round(remaining / 1000) });
        events.emit('claude_resumed', { repo: repo.name, said });
        const first = run;
        run = await call(
          `Every specialist you launched has finished; their reports are above in this conversation. Continue the /audit procedure from step 4: collect them, run the verifier once, and write the output file ${toPosix(rawOutput)}.`,
          true,
          remaining,
        );
        run.wallMs += first.wallMs;
      }
    }
    run.rateLimit = tracker.rateLimit;
  } finally {
    if (verifyDir) removeVerifyWorktree({ git, path: verifyDir });
    forgetSession({ env: sessionEnv, sessionId });
  }

  events.emit('claude_finished', {
    repo: repo.name,
    subtype: run.result?.subtype ?? null,
    is_error: run.result?.is_error ?? true,
    num_turns: tracker.turns || run.result?.num_turns || null,
    wall_ms: run.wallMs,
    timed_out: run.timedOut,
  });
  events.emit('repo_stage', { repo: repo.name, stage: 'postprocessing' });

  const logsDir = join(ctx.dateDir, 'logs');
  mkdirSync(logsDir, { recursive: true });
  writeFileSync(join(logsDir, `${repo.name}.claude.json`), run.stdout || '');
  if (run.stderr) writeFileSync(join(logsDir, `${repo.name}.claude.stderr.log`), run.stderr);
  const captured = writeReplies(workDir, tracker.replies);
  if (captured.length) log.info('subagent replies captured', { repo: repo.name, replies: captured.length, dir: join(workDir, 'specialists') });

  const usage = summarizeUsage(run, tracker);
  const r = run.result;
  ctx.store.appendUsage({
    date: ctx.date,
    at: input.runAt,
    repo: repo.name,
    mode,
    analyzers,
    files: input.fileCount,
    ok: r?.subtype === 'success' && !run.timedOut,
    terminal_reason: r?.terminal_reason ?? null,
    rate_limit: run.rateLimit ?? null,
    run_id: ctx.runId,
    prompt_version: prompts,
    specialist_model: claudeCfg.models.specialists,
    ...usage,
  });
  log.info('claude finished', {
    repo: repo.name,
    exit: run.exitCode,
    subtype: r?.subtype,
    terminal_reason: r?.terminal_reason,
    timed_out: run.timedOut,
    ...usage,
  });
  if (r?.permission_denials?.length) {
    log.warn('tool calls denied by policy', {
      repo: repo.name,
      denials: r.permission_denials.map((d) => ({ tool: d.tool_name, input: JSON.stringify(d.tool_input).slice(0, 200) })),
    });
  }

  assertSucceeded(run, claudeCfg);
  if (resumeSkipped !== null && !existsSync(rawOutput)) {
    throw new Error(
      `claude ended before writing its output with ${Math.round(resumeSkipped / 1000)} s of the ${claudeCfg.timeout_minutes} min timeout left, too little to resume`,
    );
  }
  return { run, tracker, usage, raw: readRawFindings(rawOutput), captured, promptVersion: prompts };
}

export const MIN_RESUME_MS = 2 * 60_000;

// What a resume may still spend before the session's deadline, or null when too little is left to verify and write.
export function resumeBudget(deadline: number, now = Date.now()): number | null {
  const remaining = deadline - now;
  return remaining >= MIN_RESUME_MS ? remaining : null;
}

function summarizeUsage(run: ClaudeRun, tracker: StreamTracker): RunUsage {
  const r = run.result;
  return {
    duration_ms: r?.duration_ms ?? run.wallMs,
    wall_ms: run.wallMs,
    // Summed over every orchestrator wake-up; the final result's num_turns covers only the last one.
    num_turns: tracker.turns || r?.num_turns || null,
    cost_usd_equivalent: r?.total_cost_usd ?? null,
    models: r?.modelUsage
      ? Object.fromEntries(
          Object.entries(r.modelUsage).map(([m, u]) => [
            m,
            { input: u.inputTokens + u.cacheReadInputTokens + u.cacheCreationInputTokens, output: u.outputTokens },
          ]),
        )
      : null,
    subagents: r?.subagent_stats?.by_type ?? null,
    subagent_runs: r?.subagent_stats ? r.subagent_stats.completed + r.subagent_stats.failed : null,
    subagent_tokens: Object.keys(tracker.tokensByAgent).length ? tracker.tokensByAgent : null,
    permission_denials: r?.permission_denials?.length ?? null,
    // What this run moved the subscription windows by, between the first and last reading Claude reported.
    window_cost: passCost(tracker.firstRateLimit, tracker.rateLimit),
  };
}

function assertSucceeded(run: ClaudeRun, claudeCfg: ClaudeConfig): void {
  const r = run.result;
  if (run.cancelled) throw new CancelledError('cancelled from the dashboard while Claude was auditing');
  if (isUsageLimit(run)) {
    throw new UsageLimitError(`subscription usage limit reached: ${(r?.result || r?.errors?.join('; ') || run.stderr || '').trim().slice(0, 200)}`);
  }
  if (run.timedOut) throw new Error(`claude timed out after ${claudeCfg.timeout_minutes} min`);
  if (run.spawnError) throw new Error(`could not start claude: ${run.spawnError}`);
  if (r?.subtype !== 'success' || r.is_error || run.exitCode !== 0) {
    throw new Error(`claude run did not succeed (exit ${run.exitCode}, ${r?.subtype ?? 'no result'}${r?.errors ? `: ${r.errors.join('; ')}` : ''})`);
  }
}

function readRawFindings(rawOutput: string): RawFindings {
  if (!existsSync(rawOutput)) throw new Error(`claude finished but did not write ${rawOutput}`);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(rawOutput, 'utf8'));
  } catch (e) {
    throw new Error(`raw findings are not valid JSON: ${(e as Error).message}`);
  }
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as RawFindings).findings)) throw new Error('raw findings file has no "findings" array');
  return raw as RawFindings;
}
