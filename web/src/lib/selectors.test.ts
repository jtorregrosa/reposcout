import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { finding, overview, repo, triageFixture } from '@/test/fixtures';
import { DEFAULT_VIEW } from './findings-view';
import { facetCounts, pipeline, queueCounts, runHistory, severityMatrix, speculativeScope, validationScope } from './selectors';
import type { UsageRow } from './types';

describe('queue counts', () => {
  it('count each queue under the other filters', () => {
    const { findings } = triageFixture();
    assert.deepEqual(queueCounts(findings, DEFAULT_VIEW), { triage: 2, report: 1, reported: 0, closed: 2, all: 5 });
    assert.deepEqual(queueCounts(findings, { ...DEFAULT_VIEW, repo: 'web' }), { triage: 0, report: 1, reported: 0, closed: 1, all: 2 });
  });
});

describe('facet counts', () => {
  it('count each option with its own facet released, within the queue', () => {
    const findings = [
      finding({ severity: 'high', category: 'security' }),
      finding({ severity: 'low', category: 'security' }),
      finding({ severity: 'high', category: 'logic' }),
      finding({ severity: 'high', status: 'resolved', stage: 'fixed' }),
    ];
    const c = facetCounts(findings, { ...DEFAULT_VIEW, severities: ['high'], categories: ['security'] });
    assert.deepEqual(c.severities, { high: 1, low: 1 });
    assert.deepEqual(c.categories, { security: 1, logic: 1 });
  });
});

describe('the severity matrix', () => {
  it('counts findings by category and severity', () => {
    const m = severityMatrix([finding({ severity: 'high', category: 'security' }), finding({ severity: 'high', category: 'security' })]);
    assert.deepEqual(m.rows.find((r) => r.key === 'security')?.cells, [0, 2, 0, 0]);
    assert.deepEqual(m.totals, [0, 2, 0, 0]);
  });

  it('counts by type, with a row for the unclassified only while there are some', () => {
    const labelled = [finding({ severity: 'high', kind: 'bug' }), finding({ severity: 'low', kind: 'chore' })];
    assert.deepEqual(
      severityMatrix(labelled, 'kind').rows.map((r) => [r.key, r.total]),
      [
        ['vulnerability', 0],
        ['bug', 1],
        ['chore', 1],
      ],
    );
    assert.deepEqual(severityMatrix([...labelled, finding({ severity: 'medium', kind: undefined })], 'kind').rows.at(-1)?.cells, [0, 0, 1, 0]);
  });
});

describe('the stage pipeline', () => {
  it('counts each stage from the queues', () => {
    assert.deepEqual(pipeline(triageFixture().findings), {
      detect: { open: 2, fresh: 1 },
      validate: { total: 2, detected: 1, speculative: 1 },
      report: { total: 1 },
    });
  });
});

describe('launch scopes', () => {
  it('validate only in repositories with verification on, capped per repository', () => {
    const repos = [
      repo({ name: 'a', counts: { ...repo().counts, to_validate: 14 } }),
      repo({ name: 'b', counts: { ...repo().counts, to_validate: 3 } }),
      repo({ name: 'c', verification: 'no-sandbox', counts: { ...repo().counts, to_validate: 5 } }),
    ];
    assert.deepEqual(validationScope(repos, null), { repos: ['a', 'b'], tries: 13, waiting: 17 });
    assert.deepEqual(validationScope(repos, 'b'), { repos: ['b'], tries: 3, waiting: 3 });
    assert.deepEqual(validationScope(repos, 'c'), { repos: [], tries: 0, waiting: 0 });
  });

  it('review undecided speculative candidates per repository', () => {
    const findings = [finding({ status: 'speculative', repo: 'a' }), finding({ status: 'speculative', repo: 'b' }), finding({ status: 'open', repo: 'c' })];
    assert.deepEqual(speculativeScope(findings, null), { repos: ['a', 'b'], tries: 2, waiting: 2 });
    assert.deepEqual(speculativeScope(findings, 'a').repos, ['a']);
  });
});

describe('run history', () => {
  it('joins each run with its usage rows, sweep passes included', () => {
    const ov = overview({
      runs: [
        { run_id: 'run-2', date: '2026-10-09', bytes: 1 },
        { run_id: 'run-1', date: '2026-10-08', bytes: 1 },
      ],
      usage: [
        {
          date: '2026-10-09',
          at: 'x',
          repo: 'api',
          mode: 'full',
          analyzers: [],
          files: 1,
          ok: true,
          terminal_reason: null,
          rate_limit: null,
          wall_ms: 1000,
          run_id: 'run-2-p1',
        },
        {
          date: '2026-10-09',
          at: 'y',
          repo: 'web',
          mode: 'full',
          analyzers: [],
          files: 1,
          ok: false,
          terminal_reason: 'x',
          rate_limit: null,
          wall_ms: 500,
          run_id: 'run-2-p2',
        },
      ],
    });
    const [latest, older] = runHistory(ov);
    assert.deepEqual(latest, { runId: 'run-2', date: '2026-10-09', mode: 'full', ok: false, repos: ['api', 'web'], wallMs: 1500 });
    assert.deepEqual(older, { runId: 'run-1', date: '2026-10-08', mode: null, ok: null, repos: [], wallMs: null });
  });

  it('gives a row without a run id to the latest run that had started by then', () => {
    const row = (at: string, repo: string): UsageRow => ({
      date: at.slice(0, 10),
      at,
      repo,
      mode: 'incremental',
      analyzers: [],
      files: 1,
      ok: true,
      terminal_reason: null,
      rate_limit: null,
      wall_ms: 1000,
    });
    const ov = overview({
      runs: [
        { run_id: 'run-2026-10-08T19-45-34-863Z', date: '2026-10-08', bytes: 1 },
        { run_id: 'run-2026-10-08T18-38-00-180Z', date: '2026-10-08', bytes: 1 },
      ],
      usage: [
        row('2026-10-08T18:40:00.000Z', 'api'),
        row('2026-10-08T20:20:00.000Z', 'web'),
        row('2026-10-08T17:00:00.000Z', 'old'),
        { ...row('2026-10-08T00:00:00.000Z', 'undated'), at: undefined as unknown as string, date: 'not a date' },
      ],
    });
    const [latest, earlier] = runHistory(ov);
    assert.deepEqual(latest?.repos, ['web']);
    assert.deepEqual(earlier?.repos, ['api']);
    assert.equal(earlier?.mode, 'incremental');
  });
});
