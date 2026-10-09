import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'vitest';
import type { FindingEntry } from '../src/findings/types.js';
import type { RepoReport } from '../src/report/types.js';
import type { RepoState } from '../src/state/types.js';
import { ExportFormatError, restoreExport, writeExport } from '../src/store/backup.js';
import { Store } from '../src/store/index.js';

const CONFIRMED = 'a'.repeat(32);
const RELABELLED = 'b'.repeat(32);
const FIXED = 'c'.repeat(32);
const REFUTED = 'd'.repeat(32);

const entry = (fingerprint: string, over: Partial<FindingEntry> = {}): FindingEntry =>
  ({
    status: 'open',
    first_seen: 't0',
    last_seen: 't0',
    finding: { fingerprint, repo: 'demo', file: 'src/a.cs', line: 1, category: 'logic', severity: 'high', title: `Finding ${fingerprint[0]}`, verified: false },
    ...over,
  }) as FindingEntry;
const state = (findings: RepoState['findings'], at: string): RepoState => ({ repo: 'demo', branch: 'main', last_commit: 'abc', last_run_at: at, findings });

function populated(): Store {
  const store = new Store(':memory:');
  const reproduced = { ...entry(FIXED).finding, verified: true };
  store.writeRepoState(
    'demo',
    state(
      {
        [CONFIRMED]: entry(CONFIRMED, { status: 'speculative' }),
        [RELABELLED]: entry(RELABELLED),
        [FIXED]: entry(FIXED, { finding: reproduced }),
        [REFUTED]: entry(REFUTED),
      },
      't1',
    ),
    { runId: 'run-1', at: 't1' },
  );
  store.decide('demo', CONFIRMED, { verdict: 'confirmed', reason: 'seen in production', decided_by: 'jorge', decided_at: 't2' });
  store.decide('demo', REFUTED, { verdict: 'refuted', reason: 'the input is validated upstream', decided_by: 'jorge', decided_at: 't2' });
  store.setLabels('demo', RELABELLED, { kind: 'chore' }, 'jorge', 't2');
  const now = store.readRepoState('demo') as RepoState;
  store.writeRepoState(
    'demo',
    state({ ...now.findings, [FIXED]: entry(FIXED, { status: 'resolved', resolution: 'file deleted', finding: reproduced }) }, 't3'),
    { runId: 'run-2', at: 't3' },
  );
  store.recordCensus('demo', { eligible: 12, head: 'abc', at: 't3' });
  store.appendUsage({
    date: '2026-10-09',
    at: 't3',
    repo: 'demo',
    mode: 'full',
    analyzers: ['logic'],
    files: 3,
    ok: true,
    terminal_reason: null,
    rate_limit: null,
  });
  store.saveYield({ runId: 'run-2', repo: 'demo', at: 't3', mode: 'full', promptVersion: 'abc123', model: 'sonnet' }, [
    { analyzer: 'logic', instances: 1, candidates: 4, kept: 1, speculative: 1, discarded: 2, tokens: 900, cost_usd: 0.4 },
  ]);
  store.saveReport({ schema: 'reposcout/report@1', repo: 'demo', run_id: 'run-2', generated_at: 't3', commit: 'abc' } as unknown as RepoReport, '2026-10-09');
  store.replaceFailures('2026-10-08', { other: { error: 'clone timed out', at: 't0' } });
  return store;
}

const tempDir = () => mkdtempSync(join(tmpdir(), 'reposcout-backup-'));

describe('an export restored into an empty database', () => {
  it('reproduces the state, both histories, stages, decisions, labels, usage, yield, reports and failures', () => {
    const source = populated();
    const dir = tempDir();
    writeExport(source, dir, 't4');
    const restored = new Store(':memory:');
    const summary = restoreExport(restored, dir);

    assert.equal(summary.repos, 1);
    assert.deepEqual(restored.readRepoState('demo'), source.readRepoState('demo'));
    for (const fp of [CONFIRMED, RELABELLED, FIXED, REFUTED]) {
      assert.deepEqual(restored.findingHistory('demo', fp), source.findingHistory('demo', fp), `status history of ${fp[0]}`);
      assert.deepEqual(restored.stageHistory('demo', fp), source.stageHistory('demo', fp), `stage history of ${fp[0]}`);
    }
    assert.deepEqual(restored.stagesFor('demo'), source.stagesFor('demo'));
    assert.deepEqual(restored.decisionsFor('demo'), source.decisionsFor('demo'));
    assert.deepEqual(restored.labelsFor('demo'), source.labelsFor('demo'));
    assert.deepEqual(restored.census(), source.census());
    assert.deepEqual(restored.usage(), source.usage());
    assert.deepEqual(restored.yields(), source.yields());
    assert.deepEqual(restored.latestReport('demo'), source.latestReport('demo'));
    assert.deepEqual(restored.failuresFor('2026-10-08'), source.failuresFor('2026-10-08'));
    assert.equal(restored.findingHistory('demo', CONFIRMED).at(-1)?.actor, 'jorge');
    assert.equal(restored.stagesFor('demo').get(FIXED)?.stage, 'fixed');
    assert.equal(restored.decisionsFor('demo').get(REFUTED)?.decided_on, 'open');
    assert.equal(restored.readRepoState('demo')?.findings[REFUTED]?.status, 'refuted');
    rmSync(dir, { recursive: true, force: true });
  });

  it('restores the decisions of an export from before they recorded their status as made on speculative', () => {
    const dir = tempDir();
    writeExport(populated(), dir, 't4');
    const file = join(dir, 'decisions.json');
    const older = (JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>[]).map(({ decided_on: _on, ...d }) => d);
    writeFileSync(file, JSON.stringify(older));
    const restored = new Store(':memory:');
    restoreExport(restored, dir);
    assert.deepEqual(
      [...restored.decisionsFor('demo').values()].map((d) => d.decided_on),
      ['speculative', 'speculative'],
    );
    rmSync(dir, { recursive: true, force: true });
  });

  it('refuses a directory without a manifest and changes nothing', () => {
    const dir = tempDir();
    const restored = new Store(':memory:');
    assert.throws(() => restoreExport(restored, dir), ExportFormatError);
    assert.deepEqual(restored.repoNames(), []);
    rmSync(dir, { recursive: true, force: true });
  });

  it('rolls the whole restore back when a file cannot be parsed', () => {
    const dir = tempDir();
    writeExport(populated(), dir, 't4');
    appendFileSync(join(dir, 'reports.jsonl'), '{not json\n');
    const restored = new Store(':memory:');
    assert.throws(() => restoreExport(restored, dir), SyntaxError);
    assert.deepEqual(restored.repoNames(), []);
    assert.equal(restored.decisionsFor('demo').size, 0);
    rmSync(dir, { recursive: true, force: true });
  });
});
