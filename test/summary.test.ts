import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { aggregateReports, renderSummary } from '../src/report/summary.js';
import type { RepoReport } from '../src/report/types.js';

const finding = (fingerprint: string, status: 'new' | 'existing', over = {}) => ({
  fingerprint,
  repo: 'demo',
  commit: 'c',
  file: `src/${fingerprint}.cs`,
  line: 1,
  category: 'logic',
  severity: 'high',
  title: `Finding ${fingerprint}`,
  description: 'd',
  scenario: 's',
  suggested_fix: 'f',
  confidence: 'high',
  verified: false,
  snippet: 'x',
  status,
  first_seen: 't0',
  ...over,
});

const report = (runId: string, at: string, over: Partial<RepoReport> = {}): RepoReport =>
  ({
    schema: 'reposcout/report@1',
    run_id: runId,
    repo: 'demo',
    organization: 'o',
    project: 'p',
    branch: 'main',
    commit: `commit-${runId}`,
    previous_commit: `before-${runId}`,
    mode: 'full',
    analyzers: ['security', 'concurrency', 'error-handling', 'logic', 'performance'],
    generated_at: at,
    audited_files: ['a', 'b'],
    omitted_files_count: 0,
    findings: [],
    resolved: [],
    open_total: 0,
    carried_open: 0,
    confirmed_known: 0,
    speculative_new: [],
    speculative_total: 0,
    refuted: [],
    suppressed_count: 0,
    read_coverage: { selected: 2, read: 2, unread: [] },
    discarded_count: 0,
    discarded: [],
    rejected: [],
    notes: '',
    usage: { duration_ms: 1000, wall_ms: 2000, num_turns: 3, subagent_runs: 4 },
    ...over,
  }) as RepoReport;

describe('the day summary', () => {
  // A three-pass sweep: the first pass finds two bugs, the second resolves one and sees another again, the last
  // finds nothing. Showing only the last pass would hide all of it.
  const sweep = [
    report('run-p1', '2026-10-08T01:00:00Z', { findings: [finding('f1', 'new'), finding('f2', 'new')] as RepoReport['findings'], open_total: 2 }),
    report('run-p2', '2026-10-08T02:00:00Z', {
      findings: [finding('f1', 'existing'), finding('f3', 'new', { reopened: true })] as RepoReport['findings'],
      resolved: [{ ...finding('f2', 'new'), status: 'resolved', resolution: 'fixed' }] as RepoReport['resolved'],
      open_total: 2,
    }),
    report('run-p3', '2026-10-08T03:00:00Z', { open_total: 2, confirmed_known: 1 }),
  ];

  it('aggregates every run of the day per repository: new and resolved across passes, files summed, the latest open count', () => {
    const [day] = aggregateReports([...sweep].reverse());
    assert.ok(day);
    assert.deepEqual(
      day.fresh.map((f) => f.fingerprint),
      ['f1', 'f2', 'f3'],
    );
    assert.deepEqual(
      day.resolved.map((f) => f.fingerprint),
      ['f2'],
    );
    assert.equal(day.files, 6);
    assert.equal(day.open_total, 2);
    assert.equal(day.runs, 3);
    assert.equal(day.commit, 'commit-run-p3');
    assert.equal(day.previous_commit, 'before-run-p1');
    assert.equal(day.seconds, 6);
    assert.equal(day.turns, 9);
  });

  it('lists every pass’s findings, and states the open count without contradicting it', () => {
    const md = renderSummary('2026-10-08', sweep, {});
    assert.match(md, /\| demo \| full \| 3 \| `commit-run` \| 6 \| 3 \| 1 \| 2 \|/);
    assert.match(md, /Finding f1/);
    assert.match(md, /Finding f3 \(reopened\)/);
    assert.match(md, /\*\*3 new\*\* \(1 reopened\), \*\*1 resolved\*\*, 2 open in total \(1 of them seen again today/);
    assert.doesNotMatch(md, /still open and confirmed/);
  });

  it('names the analyzers only when fewer than all of them ran', () => {
    assert.doesNotMatch(renderSummary('d', [report('r', 't')], {}), /analyzers /);
    const four = renderSummary('d', [report('r', 't', { analyzers: ['security', 'concurrency', 'error-handling', 'logic'] })], {});
    assert.match(four, /analyzers security, concurrency, error-handling, logic/);
  });
});
