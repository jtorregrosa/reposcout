import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, it } from 'vitest';
import type { FindingEntry } from '../src/findings/types.js';
import { layout } from '../src/paths.js';
import type { RepoReport } from '../src/report/types.js';
import type { RepoState } from '../src/state/types.js';
import { closeStores, openStore, Store } from '../src/store/index.js';
import { MIGRATIONS } from '../src/store/schema.js';

const FP1 = 'a'.repeat(32);
const FP2 = 'b'.repeat(32);

const entry = (over: Partial<FindingEntry> = {}, fingerprint = FP1): FindingEntry =>
  ({
    status: 'open',
    first_seen: '2026-10-01T00:00:00.000Z',
    last_seen: '2026-10-01T00:00:00.000Z',
    finding: { fingerprint, repo: 'demo', file: 'src/a.cs', line: 3, category: 'logic', severity: 'high', title: 'A finding' },
    ...over,
  }) as FindingEntry;

const state = (findings: RepoState['findings'], over: Partial<RepoState> = {}): RepoState => ({
  repo: 'demo',
  branch: 'main',
  fingerprint_version: 2,
  last_commit: 'abc',
  last_run_at: '2026-10-01T00:00:00.000Z',
  last_commit_by_analyzer: { security: 'abc', logic: 'abc' },
  last_full_run_at: null,
  eligible_files: 10,
  file_audits_by_analyzer: { security: { 'src/a.cs': 't1' }, concurrency: {}, 'error-handling': {}, logic: { 'src/a.cs': 't2' }, performance: {} },
  unread_once: ['src/b.cs'],
  findings,
  ...over,
});

const tempRoot = () => mkdtempSync(join(tmpdir(), 'reposcout-store-'));
const memory = () => new Store(':memory:');

afterEach(() => closeStores());

describe('repository state', () => {
  it('reads back exactly the state that was written', () => {
    const store = memory();
    const written = state({ [FP1]: entry({ status: 'resolved', resolved_at: 't3', resolution: 'fixed' }) });
    store.writeRepoState('demo', written, { runId: 'run-1', at: 't3' });
    assert.deepEqual(store.readRepoState('demo'), written);
  });

  it('leaves out what the state did not have, as the JSON files did', () => {
    const store = memory();
    const { last_commit_by_analyzer: _, ...legacy } = state({ [FP1]: entry() });
    store.writeRepoState('demo', legacy, { runId: null, at: 't' });
    const read = store.readRepoState('demo');
    assert.equal(read?.last_commit_by_analyzer, undefined);
    assert.ok(!('resolved_at' in (read?.findings[FP1] ?? {})));
  });

  it('records every status a finding goes through, with the run that changed it', () => {
    const store = memory();
    store.writeRepoState('demo', state({ [FP1]: entry() }), { runId: 'run-1', at: 't1' });
    store.writeRepoState('demo', state({ [FP1]: entry({ last_seen: 't2' }) }), { runId: 'run-2', at: 't2' });
    store.writeRepoState('demo', state({ [FP1]: entry({ status: 'resolved', resolution: 'fixed upstream' }) }), { runId: 'run-3', at: 't3' });
    assert.deepEqual(store.findingHistory('demo', FP1), [
      { at: 't1', run_id: 'run-1', from_status: null, to_status: 'open', note: null, actor: null },
      { at: 't3', run_id: 'run-3', from_status: 'open', to_status: 'resolved', note: 'fixed upstream', actor: null },
    ]);
  });

  it('records a finding that leaves the state', () => {
    const store = memory();
    store.writeRepoState('demo', state({ [FP1]: entry(), [FP2]: entry({}, FP2) }), { runId: 'run-1', at: 't1' });
    store.writeRepoState('demo', state({ [FP1]: entry() }), { runId: 'run-2', at: 't2' });
    assert.equal(store.findingHistory('demo', FP2).at(-1)?.to_status, 'removed');
  });

  it('keeps the suppression, miss count, reopening and per-analyzer unread lists across a write', () => {
    const store = memory();
    const written = state(
      {
        [FP1]: entry({ status: 'suppressed', reason: 'reviewed', status_before_suppression: 'speculative' }),
        [FP2]: entry({ missed_runs: 1, reopened_at: 't2' }, FP2),
      },
      { unread_once: [], unread_once_by_analyzer: { logic: ['src/c.cs'] } },
    );
    store.writeRepoState('demo', written, { runId: 'run-1', at: 't3' });
    assert.deepEqual(store.readRepoState('demo'), written);
  });

  it('records a resolved finding reported again as reopened', () => {
    const store = memory();
    store.writeRepoState('demo', state({ [FP1]: entry({ status: 'resolved', resolution: 'fixed' }) }), { runId: 'run-1', at: 't1' });
    store.writeRepoState('demo', state({ [FP1]: entry({ last_seen: 't2', reopened_at: 't2' }) }), { runId: 'run-2', at: 't2' });
    assert.deepEqual(store.findingHistory('demo', FP1).at(-1), {
      at: 't2',
      run_id: 'run-2',
      from_status: 'resolved',
      to_status: 'open',
      note: 'Reopened: reported again after it was resolved',
      actor: null,
    });
  });

  it('upgrades a database written before the lifecycle columns, which read as before', () => {
    const file = join(tempRoot(), 'old.db');
    const old = new Database(file);
    old.exec(MIGRATIONS.slice(0, 3).join('\n'));
    old.pragma('user_version = 3');
    old
      .prepare(
        `INSERT INTO findings (repo, fingerprint, status, severity, category, file, first_seen, last_seen, reason, finding)
         VALUES ('demo', ?, 'suppressed', 'high', 'logic', 'src/a.cs', 't0', 't0', 'old', ?)`,
      )
      .run(FP1, JSON.stringify(entry().finding));
    old.prepare(`INSERT INTO repos (name, branch, last_commit, unread_once) VALUES ('demo', 'main', 'abc', '["src/b.cs"]')`).run();
    old.close();
    const store = new Store(file);
    assert.equal(store.schemaVersion, MIGRATIONS.length);
    const read = store.readRepoState('demo');
    assert.deepEqual(read?.findings[FP1], { status: 'suppressed', first_seen: 't0', last_seen: 't0', reason: 'old', finding: entry().finding });
    assert.deepEqual(read?.unread_once, ['src/b.cs']);
    assert.equal(read?.unread_once_by_analyzer, undefined);
    store.close();
  });

  it('commits a report and the state it describes together, or neither', () => {
    const store = memory();
    store.writeRepoState('demo', state({ [FP1]: entry() }), { runId: 'run-1', at: 't1' });
    const report = { schema: 'reposcout/report@1', repo: 'demo', run_id: 'run-2', generated_at: 't2' } as RepoReport;
    const broken = { ...entry({}, FP2), finding: { ...entry().finding, severity: null } } as unknown as FindingEntry;
    assert.throws(() =>
      store.transaction(() => {
        store.saveReport(report, '2026-10-08');
        store.writeRepoState('demo', state({ [FP2]: broken }), { runId: 'run-2', at: 't2' });
      }),
    );
    assert.deepEqual(store.reportsForDate('2026-10-08'), []);
    assert.equal(store.readRepoState('demo')?.findings[FP1]?.status, 'open');
  });

  it('starts its read-then-write transactions as writers, so another connection cannot slip a commit in between', () => {
    const file = join(tempRoot(), 'r.db');
    const run = new Store(file);
    const dashboard = new Store(file);
    run.db.pragma('busy_timeout = 0');
    dashboard.db.pragma('busy_timeout = 0');
    run.writeRepoState('demo', state({ [FP1]: entry() }), { runId: 'run-1', at: 't1' });
    // While the run's transaction is open, the dashboard is refused at once instead of the run failing on upgrade.
    assert.throws(
      () =>
        run.transaction(() => {
          run.readRepoState('demo');
          dashboard.setMeta('k', 'v');
        }),
      /locked|busy/i,
    );
    run.close();
    dashboard.close();
  });

  it('keeps the previous state whole when a write fails halfway', () => {
    const store = memory();
    const before = state({ [FP1]: entry() });
    store.writeRepoState('demo', before, { runId: 'run-1', at: 't1' });
    const broken = { ...entry({}, FP2), finding: { ...entry().finding, severity: null } } as unknown as FindingEntry;
    assert.throws(() =>
      store.writeRepoState('demo', state({ [FP1]: entry({ status: 'resolved' }), [FP2]: broken }, { last_commit: 'def' }), { runId: 'run-2', at: 't2' }),
    );
    assert.deepEqual(store.readRepoState('demo'), before);
    assert.equal(store.findingHistory('demo', FP1).length, 1);
  });
});

describe('reports and failures', () => {
  const report = (repo: string, runId: string, generatedAt: string) =>
    ({ schema: 'reposcout/report@1', repo, run_id: runId, generated_at: generatedAt }) as RepoReport;

  it('lists every report of a day, by repository and oldest first, for the summary to aggregate', () => {
    const store = memory();
    store.saveReport(report('a', 'run-2', '2026-10-08T02:00:00Z'), '2026-10-08');
    store.saveReport(report('a', 'run-1', '2026-10-08T01:00:00Z'), '2026-10-08');
    store.saveReport(report('b', 'run-1', '2026-10-08T01:00:00Z'), '2026-10-08');
    store.saveReport(report('a', 'run-0', '2026-10-07T01:00:00Z'), '2026-10-07');
    assert.deepEqual(
      store.reportsForDate('2026-10-08').map((r) => `${r.repo}:${r.run_id}`),
      ['a:run-1', 'a:run-2', 'b:run-1'],
    );
    assert.equal(store.latestReport('a')?.run, 'run-2');
  });

  it('replaces a day of failures and lists recent ones newest first', () => {
    const store = memory();
    store.replaceFailures('2026-10-07', { a: { error: 'old', at: 't1' } });
    store.replaceFailures('2026-10-08', { a: { error: 'new', at: 't2', deferred: true } });
    store.replaceFailures('2026-10-08', { b: { error: 'only b', at: 't3' } });
    assert.deepEqual(store.failuresFor('2026-10-08'), { b: { error: 'only b', at: 't3' } });
    assert.deepEqual(
      store.recentFailures().map((f) => `${f.date}:${f.repo}`),
      ['2026-10-08:b', '2026-10-07:a'],
    );
  });
});

describe('import of the JSON state', () => {
  function legacyRoot() {
    const root = tempRoot();
    mkdirSync(join(root, 'state'), { recursive: true });
    writeFileSync(
      join(root, 'state', 'demo.json'),
      JSON.stringify({
        repo: 'demo',
        branch: 'main',
        last_commit: 'abc',
        last_run_at: '2026-10-05T00:00:00.000Z',
        file_audits: { 'src/a.cs': 't1' },
        findings: {
          [FP1]: entry({ status: 'resolved', resolved_at: '2026-10-04T00:00:00.000Z', resolution: 'fixed' }),
          [FP2]: entry({}, FP2),
        },
      }),
    );
    writeFileSync(join(root, 'state', 'census.json'), JSON.stringify({ demo: { eligible: 12, head: 'abc', at: 't' } }));
    writeFileSync(join(root, 'state', 'usage.jsonl'), `${JSON.stringify({ date: '2026-10-05', repo: 'demo', mode: 'full', ok: true })}\n`);
    const runDir = join(root, 'reports', '2026-10-05', 'runs', 'run-x');
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, 'demo.json'), JSON.stringify({ schema: 'reposcout/report@1', commit: 'abc', discarded: [] }));
    writeFileSync(join(root, 'reports', '2026-10-05', 'failures.json'), JSON.stringify({ other: { error: 'boom', at: 't' } }));
    return root;
  }

  it('imports state, census, usage, reports and failures on first use', () => {
    const paths = layout(legacyRoot());
    const store = openStore(paths);
    const s = store.readRepoState('demo');
    assert.equal(s?.findings[FP1]?.status, 'resolved');
    assert.equal(s?.file_audits_by_analyzer?.logic?.['src/a.cs'], 't1', 'the single legacy audit map counts for every analyzer');
    assert.equal(store.census().demo?.eligible, 12);
    assert.equal(store.usage().length, 1);
    assert.equal(store.latestReport('demo')?.run, 'run-x');
    assert.equal(store.failuresFor('2026-10-05').other?.error, 'boom');
  });

  it('turns what the JSON knew into history', () => {
    const store = openStore(layout(legacyRoot()));
    assert.deepEqual(
      store.findingHistory('demo', FP1).map((e) => `${e.from_status}->${e.to_status}@${e.at}`),
      ['null->open@2026-10-01T00:00:00.000Z', 'open->resolved@2026-10-04T00:00:00.000Z'],
    );
  });

  it('imports only once', () => {
    const paths = layout(legacyRoot());
    openStore(paths);
    closeStores();
    const store = openStore(paths);
    assert.equal(store.usage().length, 1);
    assert.equal(store.findingHistory('demo', FP2).length, 1);
  });
});

describe('change detection', () => {
  it('sees a commit from another connection, which is how the dashboard notices a run', () => {
    const file = join(tempRoot(), 'r.db');
    const dashboard = new Store(file);
    const run = new Store(file);
    const before = dashboard.dataVersion();
    run.appendUsage({ date: 'd', at: 't', repo: 'demo', mode: 'full', analyzers: [], files: 1, ok: true, terminal_reason: null, rate_limit: null });
    assert.notEqual(dashboard.dataVersion(), before);
    dashboard.close();
    run.close();
  });
});
