import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { applyEvents, emptyLive, exitMeaning, runStatus } from './live';
import type { RunEvent } from './types';

const ev = (type: string, fields: Record<string, unknown> = {}, ts = '2026-10-08T05:00:00.000Z'): RunEvent => ({ ts, type, ...fields });

describe('applyEvents', () => {
  it('never mutates the state it was given', () => {
    const before = emptyLive('run-1', true);
    const after = applyEvents(before, [ev('run_started', { repos: ['a'] }), ev('repo_started', { repo: 'a' })]);
    assert.equal(before.repos.size, 0);
    assert.equal(before.feed.length, 0);
    assert.equal(after.repos.get('a')?.stage, 'started');
  });

  it('follows a repository from start to its outcome', () => {
    const s = applyEvents(emptyLive('run-1', true), [
      ev('run_started', { repos: ['a', 'b'] }),
      ev('repo_started', { repo: 'a' }),
      ev('files_selected', { repo: 'a', mode: 'full', selected: 40, omitted: 3, analyzers: ['security'] }),
      ev('repo_finished', { repo: 'a', status: 'ok', new: 2, resolved: 1, seconds: 90 }),
    ]);
    const a = s.repos.get('a');
    assert.equal(a?.stage, 'done');
    assert.equal(a?.selected, 40);
    assert.equal(a?.outcome?.new, 2);
    assert.equal(s.repos.get('b')?.stage, 'pending');
    assert.equal(s.current, 'a');
  });

  it('tracks each subagent instance and its last activity', () => {
    const s = applyEvents(emptyLive('run-1', true), [
      ev('agent_started', { repo: 'a', task_id: 't1', agent: 'security', description: 'Audit auth' }),
      ev('agent_progress', { repo: 'a', task_id: 't1', activity: 'Reading a.cs', tokens: 1200, tool_uses: 3 }),
      ev('agent_finished', { repo: 'a', task_id: 't1', status: 'completed', tokens: 1500 }),
    ]);
    const t1 = s.agents.get('t1');
    assert.equal(t1?.activity, 'Reading a.cs');
    assert.equal(t1?.tokens, 1500);
    assert.equal(t1?.status, 'completed');
  });

  it('marks policy denials and failures as problems in the feed', () => {
    const s = applyEvents(emptyLive('run-1', true), [
      ev('permission_denied', { repo: 'a', agent: 'logic', tool: 'Bash', reason: 'rule', command: 'curl x' }),
      ev('repo_finished', { repo: 'a', status: 'failed', error: 'boom' }),
    ]);
    assert.equal(s.denials.length, 1);
    assert.deepEqual(
      s.feed.map((l) => l.tone),
      ['warn', 'danger'],
    );
  });

  it('ends the run and explains its exit code', () => {
    const s = applyEvents(emptyLive('run-1', true), [ev('run_finished', { exit: 3 })]);
    assert.equal(runStatus(s), 'failed');
    assert.equal(exitMeaning(s.exit), 'stopped at the subscription usage limit');
  });
});
