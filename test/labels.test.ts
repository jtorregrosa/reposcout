import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'vitest';
import { kindTask } from '../src/backfill/kind.js';
import { readOutput } from '../src/backfill/runner.js';
import { setLabels } from '../src/dashboard/actions.js';
import { classify } from '../src/findings/classify.js';
import type { Finding, FindingEntry } from '../src/findings/types.js';
import { layout } from '../src/paths.js';
import type { RepoState } from '../src/state/types.js';
import { closeStores, openStore, Store } from '../src/store/index.js';
import { silentLogger } from '../src/telemetry/logger.js';

const FP = 'a'.repeat(32);
const OTHER = 'b'.repeat(32);
const steps = { preconditions: [], steps: ['call it'], expected: 'ok', actual: 'not ok' };

const finding = (over: Partial<Finding> = {}): Finding =>
  ({ fingerprint: FP, repo: 'r', file: 'src/a.cs', line: 1, category: 'security', severity: 'medium', title: 'Logs emails', ...over }) as Finding;
const open = (over: Partial<Finding> = {}): FindingEntry => ({ status: 'open', first_seen: 't0', last_seen: 't0', finding: finding(over) });
const state = (findings: RepoState['findings']): RepoState => ({ repo: 'r', branch: 'main', last_commit: 'abc', findings });

describe('a finding reported again by a later run', () => {
  const rerun = (prev: FindingEntry, reported: Finding, as: 'findings' | 'speculative' = 'findings') =>
    classify({
      findings: as === 'findings' ? [reported] : [],
      speculative: as === 'speculative' ? [reported] : [],
      previous: { findings: { [FP]: prev } },
      auditedFiles: ['src/a.cs'],
      deletedFiles: [],
      reviews: [],
      runAt: 't5',
    }).nextState[FP]?.finding;

  it('keeps the steps and labels it already had when the new report carries none', () => {
    const kept = rerun(open({ repro: steps, kind: 'chore', personal_data: true }), finding());
    assert.deepEqual(kept?.repro, steps);
    assert.equal(kept?.kind, 'chore');
    assert.equal(kept?.personal_data, true);
  });

  it('takes the new report when it carries its own', () => {
    const kept = rerun(open({ kind: 'chore', personal_data: true }), finding({ kind: 'vulnerability', personal_data: false }));
    assert.equal(kept?.kind, 'vulnerability');
    assert.equal(kept?.personal_data, false);
  });

  it('keeps them on a speculative candidate seen again', () => {
    const prev = { ...open({ repro: steps, kind: 'bug' }), status: 'speculative' as const };
    assert.equal(rerun(prev, finding(), 'speculative')?.kind, 'bug');
  });
});

describe("an auditor's correction of the labels", () => {
  it('applies at once, is recorded in the history, and survives a run that says otherwise', () => {
    const store = new Store(':memory:');
    store.writeRepoState('r', state({ [FP]: open({ kind: 'bug' }) }), { runId: 'run-1', at: 't0' });
    store.setLabels('r', FP, { kind: 'chore' }, 'jorge', 't1');
    assert.equal(store.readRepoState('r')?.findings[FP]?.finding.kind, 'chore');
    const last = store.findingHistory('r', FP).at(-1);
    assert.equal(last?.actor, 'jorge');
    assert.match(last?.note ?? '', /Bug to Chore/);

    store.writeRepoState('r', state({ [FP]: open({ kind: 'vulnerability', personal_data: true }) }), { runId: 'run-2', at: 't2' });
    const after = store.readRepoState('r')?.findings[FP]?.finding;
    assert.equal(after?.kind, 'chore', 'the correction wins');
    assert.equal(after?.personal_data, true, 'a field the auditor left alone follows the run');
  });

  it('keeps an earlier correction of the other field', () => {
    const store = new Store(':memory:');
    store.writeRepoState('r', state({ [FP]: open() }), { runId: 'run-1', at: 't0' });
    store.setLabels('r', FP, { personal_data: true }, 'jorge', 't1');
    store.setLabels('r', FP, { kind: 'bug' }, 'jorge', 't2');
    assert.deepEqual(
      { kind: store.labelsFor('r').get(FP)?.kind, personal_data: store.labelsFor('r').get(FP)?.personal_data },
      { kind: 'bug', personal_data: true },
    );
  });

  it('is not overwritten by a backfill', () => {
    const store = new Store(':memory:');
    store.writeRepoState('r', state({ [FP]: open(), [OTHER]: open({ fingerprint: OTHER }) }), { runId: 'run-1', at: 't0' });
    store.setLabels('r', FP, { kind: 'chore' }, 'jorge', 't1');
    assert.deepEqual(
      store.findingsWithout('kind', ['r'], ['open']).map((f) => f.fingerprint),
      [OTHER],
    );
    const written = store.setKinds('r', [
      { fingerprint: FP, kind: 'bug', personal_data: false },
      { fingerprint: OTHER, kind: 'vulnerability', personal_data: true },
    ]);
    assert.equal(written, 1);
    assert.equal(store.readRepoState('r')?.findings[FP]?.finding.kind, 'chore');
    assert.equal(store.readRepoState('r')?.findings[OTHER]?.finding.personal_data, true);
  });

  it('keeps a corrected personal-data mark when a backfill gives the finding its type', () => {
    const store = new Store(':memory:');
    store.writeRepoState('r', state({ [FP]: open() }), { runId: 'run-1', at: 't0' });
    store.setLabels('r', FP, { personal_data: true }, 'jorge', 't1');
    store.setKinds('r', [{ fingerprint: FP, kind: 'bug', personal_data: false }]);
    const labelled = store.readRepoState('r')?.findings[FP]?.finding;
    assert.equal(labelled?.kind, 'bug');
    assert.equal(labelled?.personal_data, true);
  });
});

describe('the output of a labelling session', () => {
  it('keeps one well-formed label per finding in the batch', () => {
    const p = join(mkdtempSync(join(tmpdir(), 'reposcout-labels-')), 'labels.json');
    writeFileSync(
      p,
      JSON.stringify({
        labels: [
          { fingerprint: FP, kind: 'bug', personal_data: 'yes' },
          { fingerprint: FP, kind: 'chore' },
          { fingerprint: OTHER, kind: 'feature' },
          { fingerprint: 'c'.repeat(32), kind: 'bug' },
        ],
      }),
    );
    assert.deepEqual(readOutput(kindTask, p, new Set([FP, OTHER]), silentLogger), [{ fingerprint: FP, kind: 'bug', personal_data: false }]);
  });
});

describe('the label action', () => {
  let root: string;
  let configPath: string;
  const status = (fn: () => unknown) => {
    try {
      fn();
      return 200;
    } catch (e) {
      return (e as { status?: number }).status ?? 500;
    }
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'reposcout-labels-'));
    mkdirSync(join(root, 'state'), { recursive: true });
    configPath = join(root, 'repos.yaml');
    copyFileSync('test/repos.fixture.yaml', configPath);
    writeFileSync(join(root, 'state', 'demo.json'), JSON.stringify({ ...state({ [FP]: open() }), repo: 'demo' }));
  });
  afterEach(() => closeStores());

  it('records the correction under the given auditor', () => {
    const out = setLabels({ root, configPath, repo: 'demo', fingerprint: FP, kind: 'vulnerability', personal_data: true }, { by: 'auditor-1' });
    assert.deepEqual(out, { fingerprint: FP, kind: 'vulnerability', personal_data: true, set_by: 'auditor-1' });
    assert.equal(openStore(layout(root)).labelsFor('demo').get(FP)?.set_by, 'auditor-1');
  });

  it('validates every input', () => {
    const label = (over: Record<string, unknown>) => () =>
      setLabels({ root, configPath, repo: 'demo', fingerprint: FP, ...over } as Parameters<typeof setLabels>[0]);
    assert.equal(status(label({ kind: 'feature' })), 400);
    assert.equal(status(label({ personal_data: 'yes' })), 400);
    assert.equal(status(label({})), 400, 'nothing to change');
    assert.equal(status(label({ kind: 'bug', fingerprint: 'nope' })), 400);
    assert.equal(status(label({ kind: 'bug', repo: 'unknown' })), 400);
    assert.equal(status(label({ kind: 'bug', fingerprint: OTHER })), 404);
    assert.equal(status(label({ kind: 'bug' })), 200);
  });
});
