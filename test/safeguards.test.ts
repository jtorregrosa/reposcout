import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'vitest';
import { buildAgents } from '../src/claude/agents.js';
import { forgetSession, isUsageLimit } from '../src/claude/session.js';
import { classify } from '../src/findings/classify.js';
import { acquireLock } from '../src/state/lock.js';
import { silentLogger } from '../src/telemetry/logger.js';
import { asFinding, state } from './fixtures.js';

const silent = silentLogger;
const runAt = '2026-10-07T00:00:00.000Z';
const finding = (fp, file = 'src/a.cs') =>
  asFinding({
    fingerprint: fp,
    file,
    line: 1,
    category: 'logic',
    severity: 'low',
    title: 't',
  });
const open = (f) => ({
  status: 'open',
  first_seen: '2026-10-01T00:00:00.000Z',
  last_seen: '2026-10-01T00:00:00.000Z',
  finding: f,
});

describe('suppressed findings', () => {
  const suppressed = new Map([['fp1', 'trusted input only']]);

  it('are not reported when found again', () => {
    const { reported, suppressedHits, nextState } = classify({
      findings: [finding('fp1'), finding('fp2')],
      previous: null,
      auditedFiles: ['src/a.cs'],
      deletedFiles: [],
      reviews: [],
      runAt,
      suppressed,
    });
    assert.deepEqual(
      reported.map((f) => f.fingerprint),
      ['fp2'],
    );
    assert.deepEqual(suppressedHits, ['fp1']);
    assert.equal(nextState.fp1.status, 'suppressed');
  });

  it('move an open finding to suppressed instead of resolved when not found again', () => {
    const previous = state({ fp1: open(finding('fp1')) });
    const { resolved, nextState } = classify({
      findings: [],
      previous,
      auditedFiles: ['src/a.cs'],
      deletedFiles: [],
      reviews: [],
      runAt,
      suppressed,
    });
    assert.equal(resolved.length, 0);
    assert.equal(nextState.fp1.status, 'suppressed');
    assert.equal(nextState.fp1.reason, 'trusted input only');
  });

  it('become open again once removed from the list', () => {
    const previous = state({
      fp1: { ...open(finding('fp1')), status: 'suppressed', reason: 'x' },
    });
    const { nextState, carried } = classify({
      findings: [],
      previous,
      auditedFiles: [],
      deletedFiles: [],
      reviews: [],
      runAt,
    });
    assert.equal(nextState.fp1.status, 'open');
    assert.equal(nextState.fp1.reason, undefined);
    assert.deepEqual(carried, ['fp1']);
  });
});

describe('isUsageLimit', () => {
  it('detects a 429 from the API', () => {
    assert.ok(
      isUsageLimit({
        result: {
          type: 'result',
          subtype: 'error_during_execution',
          is_error: true,
          api_error_status: 429,
        },
      }),
    );
  });

  it('detects a usage-limit message in the result text', () => {
    assert.ok(
      isUsageLimit({
        result: {
          type: 'result',
          subtype: 'success',
          is_error: true,
          result: 'Claude AI usage limit reached|1760000000',
        },
      }),
    );
    assert.ok(
      isUsageLimit({
        result: null,
        stderr: "You've hit your limit · resets 3pm",
      }),
    );
  });

  it('does not flag a successful run or an unrelated failure', () => {
    assert.ok(
      !isUsageLimit({
        result: {
          type: 'result',
          subtype: 'success',
          is_error: false,
          result: 'Kept 2 findings about the rate limit middleware',
        },
      }),
    );
    assert.ok(
      !isUsageLimit({
        result: {
          type: 'result',
          subtype: 'error_max_turns',
          is_error: true,
          errors: ['Reached maximum number of turns (60)'],
        },
      }),
    );
  });
});

describe('acquireLock', () => {
  it('refuses a second holder while the first is alive, and allows it after release', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'reposcout-')), '.lock');
    const release = acquireLock(path, silent);
    assert.ok(release);
    assert.equal(acquireLock(path, silent), null);
    release();
    const again = acquireLock(path, silent);
    assert.ok(again);
    again();
  });

  it('takes over a lock left by a process that is gone', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'reposcout-')), '.lock');
    writeFileSync(path, JSON.stringify({ pid: 2 ** 30, started_at: new Date().toISOString() }));
    const release = acquireLock(path, silent);
    assert.ok(release);
    release();
  });
});

describe('buildAgents', () => {
  it('applies configured models and turn limits per role', () => {
    const agents = buildAgents({
      rootDir: process.cwd(),
      models: { specialists: 'fable', verifier: 'opus' },
      maxTurns: { specialists: 7, verifier: 9 },
    });
    assert.equal(agents.security.model, 'fable');
    assert.equal(agents.security.maxTurns, 7);
    assert.equal(agents.verifier.model, 'opus');
    assert.equal(agents.verifier.maxTurns, 9);
  });
});

describe('forgetSession', () => {
  it('deletes that session transcript and its tool results, and nothing else', () => {
    const home = mkdtempSync(join(tmpdir(), 'reposcout-home-'));
    const project = join(home, 'projects', 'd--repo');
    mkdirSync(join(project, 'abc', 'tool-results'), { recursive: true });
    writeFileSync(join(project, 'abc.jsonl'), '{}');
    writeFileSync(join(project, 'other.jsonl'), '{}');
    forgetSession({ env: { CLAUDE_CONFIG_DIR: home }, sessionId: 'abc' });
    assert.equal(existsSync(join(project, 'abc.jsonl')), false);
    assert.equal(existsSync(join(project, 'abc')), false);
    assert.equal(existsSync(join(project, 'other.jsonl')), true);
  });
});
