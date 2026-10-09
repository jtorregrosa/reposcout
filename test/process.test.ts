import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, it, vi } from 'vitest';
import { MIN_RESUME_MS, resumeBudget } from '../src/audit/session.js';
import { type ClaudeSpawnFn, KILL_GRACE_MS, type RunClaudeOptions, runClaude } from '../src/claude/session.js';
import type { ClaudeConfig } from '../src/config/config.js';
import { GIT_LOCAL_TIMEOUT_MS, GIT_NETWORK_TIMEOUT_MS, Git, gitEnv } from '../src/git/git.js';

describe('git timeouts', () => {
  const capture = (result: Record<string, unknown> = {}) => {
    const calls: { args: string[]; options: Record<string, unknown> }[] = [];
    const spawnFn = (_command: string, args: string[], options) => {
      calls.push({ args, options });
      return { pid: 1, status: 0, signal: null, stdout: '', stderr: '', output: [], ...result };
    };
    return { calls, spawnFn };
  };

  it('gives network commands a long timeout and local ones a short one', () => {
    const { calls, spawnFn } = capture();
    const git = new Git('/clone', {}, spawnFn);
    git.run(['fetch', '--quiet', 'origin', 'main']);
    git.run(['rev-parse', 'HEAD']);
    assert.equal(calls[0].options.timeout, GIT_NETWORK_TIMEOUT_MS);
    assert.equal(calls[1].options.timeout, GIT_LOCAL_TIMEOUT_MS);
    assert.ok(GIT_LOCAL_TIMEOUT_MS < GIT_NETWORK_TIMEOUT_MS);
  });

  it('names the subcommand when it times out, even when failure is allowed', () => {
    const error = Object.assign(new Error('spawnSync git ETIMEDOUT'), { code: 'ETIMEDOUT' });
    const { spawnFn } = capture({ status: null, signal: 'SIGTERM', error });
    const git = new Git('/clone', {}, spawnFn);
    assert.throws(() => git.run(['fetch', 'origin', 'abc'], { allowFail: true }), /git fetch timed out after 15 min/);
  });

  it('aborts a stalled transfer through the environment config', () => {
    const env = gitEnv({ authHeader: null, hooksDir: '/tmp/none' });
    const config = Object.fromEntries(
      Array.from({ length: Number(env.GIT_CONFIG_COUNT) }, (_, i) => [env[`GIT_CONFIG_KEY_${i}`], env[`GIT_CONFIG_VALUE_${i}`]]),
    );
    assert.ok(Number(config['http.lowSpeedLimit']) > 0);
    assert.ok(Number(config['http.lowSpeedTime']) > 0);
  });
});

// A child whose pipes never close: what a grandchild holding stdout, or a failed taskkill, looks like.
function hungChild() {
  const child = Object.assign(new EventEmitter(), {
    pid: undefined,
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    unref: vi.fn(),
    kill: vi.fn(),
  });
  return child;
}

describe('runClaude', () => {
  let workDir: string;
  let child: ReturnType<typeof hungChild>;
  const spawnFn = (() => child) as unknown as ClaudeSpawnFn;
  const options = (extra: Partial<RunClaudeOptions> = {}): RunClaudeOptions => ({
    rootDir: workDir,
    workDir,
    prompt: '/audit',
    claudeCfg: { models: { orchestrator: 'sonnet' }, max_turns: 1 } as unknown as ClaudeConfig,
    agents: {},
    settings: {} as RunClaudeOptions['settings'],
    env: {},
    timeoutMs: 60_000,
    sessionId: 'session',
    ...extra,
  });

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'reposcout-proc-'));
    child = hungChild();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('settles a timed-out session whose pipes never close, after the grace period', async () => {
    let settled = false;
    const promise = runClaude(options(), { spawnFn }).then((r) => {
      settled = true;
      return r;
    });
    await vi.advanceTimersByTimeAsync(60_000);
    assert.equal(settled, false);
    await vi.advanceTimersByTimeAsync(KILL_GRACE_MS);
    const run = await promise;
    assert.equal(run.timedOut, true);
    assert.equal(run.exitCode, null);
    assert.ok(child.stdout.destroyed && child.stderr.destroyed);
    assert.equal(child.stdout.listenerCount('data'), 0);
    assert.equal(vi.getTimerCount(), 0);
  });

  it('settles a cancelled session the same way', async () => {
    let cancel = false;
    const promise = runClaude(options({ shouldCancel: () => cancel }), { spawnFn });
    await vi.advanceTimersByTimeAsync(2_000);
    cancel = true;
    await vi.advanceTimersByTimeAsync(1_000 + KILL_GRACE_MS);
    const run = await promise;
    assert.equal(run.cancelled, true);
    assert.equal(run.timedOut, false);
    assert.equal(vi.getTimerCount(), 0);
  });

  it('still reads the result when the session closes normally', async () => {
    const promise = runClaude(options({ shouldCancel: () => false }), { spawnFn });
    child.stdout.end(`${JSON.stringify({ type: 'result', subtype: 'success', result: 'done' })}\n`);
    await once(child.stdout, 'end');
    child.emit('close', 0);
    const run = await promise;
    assert.equal(run.exitCode, 0);
    assert.equal(run.result?.subtype, 'success');
    assert.equal(vi.getTimerCount(), 0);
  });
});

describe('resume budget', () => {
  it('gives a resume only what is left before the deadline', () => {
    assert.equal(resumeBudget(1_000_000, 1_000_000 - 5 * 60_000), 5 * 60_000);
    assert.equal(resumeBudget(1_000_000, 1_000_000 - MIN_RESUME_MS), MIN_RESUME_MS);
  });

  it('skips the resume when too little time is left', () => {
    assert.equal(resumeBudget(1_000_000, 1_000_000 - MIN_RESUME_MS + 1), null);
    assert.equal(resumeBudget(1_000_000, 1_000_001), null);
  });
});
