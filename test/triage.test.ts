import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'vitest';
import { decideSpeculative, undoDecision } from '../src/dashboard/actions.js';
import { classify } from '../src/findings/classify.js';
import type { FindingEntry } from '../src/findings/types.js';
import { layout } from '../src/paths.js';
import type { RepoState } from '../src/state/types.js';
import { closeStores, DecisionError, openStore, Store } from '../src/store/index.js';

const FP = 'a'.repeat(32);
const OTHER = 'b'.repeat(32);

const speculative = (fingerprint = FP): FindingEntry =>
  ({
    status: 'speculative',
    first_seen: 't0',
    last_seen: 't0',
    finding: {
      fingerprint,
      repo: 'r',
      file: 'src/a.cs',
      line: 1,
      category: 'performance',
      severity: 'medium',
      title: 'Loads the whole list',
      unconfirmed: 'production volume',
    },
  }) as FindingEntry;
const state = (findings: RepoState['findings']): RepoState => ({ repo: 'r', branch: 'main', last_commit: 'abc', findings });
const decision = (verdict: 'confirmed' | 'refuted', at = 't1') => ({ verdict, reason: 'lists reach 300k rows', decided_by: 'jorge', decided_at: at });

describe('a decision on a speculative candidate', () => {
  it('confirms it as an open finding, and records who and why', () => {
    const store = new Store(':memory:');
    store.writeRepoState('r', state({ [FP]: speculative() }), { runId: 'run-1', at: 't0' });
    store.decide('r', FP, decision('confirmed'));
    assert.equal(store.readRepoState('r')?.findings[FP]?.status, 'open');
    const last = store.findingHistory('r', FP).at(-1);
    assert.equal(last?.to_status, 'open');
    assert.equal(last?.actor, 'jorge');
    assert.match(last?.note ?? '', /lists reach 300k rows/);
  });

  it('refutes it, with the reason as its resolution', () => {
    const store = new Store(':memory:');
    store.writeRepoState('r', state({ [FP]: speculative() }), { runId: 'run-1', at: 't0' });
    store.decide('r', FP, decision('refuted'));
    const entry = store.readRepoState('r')?.findings[FP];
    assert.equal(entry?.status, 'refuted');
    assert.match(entry?.resolution ?? '', /Refuted by jorge: lists reach 300k rows/);
  });

  it('wins over a run that still sees the candidate as speculative, even one that started before it', () => {
    const store = new Store(':memory:');
    store.writeRepoState('r', state({ [FP]: speculative() }), { runId: 'run-1', at: 't0' });
    store.decide('r', FP, decision('confirmed'));
    store.writeRepoState('r', state({ [FP]: { ...speculative(), last_seen: 't2' } }), { runId: 'run-2', at: 't2' });
    assert.equal(store.readRepoState('r')?.findings[FP]?.status, 'open');
  });

  it('leaves a run that settled the candidate on its own evidence alone', () => {
    const store = new Store(':memory:');
    store.writeRepoState('r', state({ [FP]: speculative() }), { runId: 'run-1', at: 't0' });
    store.decide('r', FP, decision('confirmed'));
    store.writeRepoState('r', state({ [FP]: { ...speculative(), status: 'resolved', resolution: 'fixed' } }), { runId: 'run-2', at: 't2' });
    assert.equal(store.readRepoState('r')?.findings[FP]?.status, 'resolved');
  });

  it('can be withdrawn, which puts the candidate back in the speculative queue', () => {
    const store = new Store(':memory:');
    store.writeRepoState('r', state({ [FP]: speculative() }), { runId: 'run-1', at: 't0' });
    store.decide('r', FP, decision('refuted'));
    store.undecide('r', FP, 'jorge', 't3');
    const entry = store.readRepoState('r')?.findings[FP];
    assert.equal(entry?.status, 'speculative');
    assert.equal(entry?.resolution, undefined);
    assert.equal(store.decisionsFor('r').size, 0);
    assert.equal(store.findingHistory('r', FP).at(-1)?.to_status, 'speculative');
  });

  it('applies only to a speculative candidate', () => {
    const store = new Store(':memory:');
    store.writeRepoState('r', state({ [FP]: { ...speculative(), status: 'open' } }), { runId: 'run-1', at: 't0' });
    assert.throws(
      () => store.decide('r', FP, decision('refuted')),
      (e: unknown) => e instanceof DecisionError && e.kind === 'not-speculative',
    );
    assert.throws(
      () => store.decide('r', OTHER, decision('refuted')),
      (e: unknown) => e instanceof DecisionError && e.kind === 'not-found',
    );
  });
});

describe('a confirmed candidate in a later audit', () => {
  it('stays open while the auditors still report it as speculative', () => {
    const open = { ...speculative(), status: 'open' as const };
    const { nextState, resolved } = classify({
      findings: [],
      speculative: [open.finding],
      previous: { findings: { [FP]: open } },
      auditedFiles: ['src/a.cs'],
      deletedFiles: [],
      reviews: [],
      runAt: 't5',
      readByCategory: new Map([['performance', new Set(['src/a.cs'])]]),
    });
    assert.equal(nextState[FP]?.status, 'open');
    assert.equal(nextState[FP]?.last_seen, 't5');
    assert.equal(resolved.length, 0);
  });
});

describe('the dashboard actions', () => {
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
    root = mkdtempSync(join(tmpdir(), 'reposcout-triage-'));
    mkdirSync(join(root, 'state'), { recursive: true });
    configPath = join(root, 'repos.yaml');
    copyFileSync('test/repos.fixture.yaml', configPath);
    writeFileSync(join(root, 'state', 'demo.json'), JSON.stringify({ ...state({ [FP]: speculative() }), repo: 'demo' }));
  });
  afterEach(() => closeStores());

  it('record a decision under the given auditor and undo it', () => {
    const deps = { by: 'auditor-1', now: () => '2026-10-08T10:00:00.000Z' };
    const out = decideSpeculative({ root, configPath, repo: 'demo', fingerprint: FP, decision: 'confirmed', reason: 'seen in production' }, deps);
    assert.equal(out.status, 'open');
    assert.equal(openStore(layout(root)).decisionsFor('demo').get(FP)?.decided_by, 'auditor-1');
    assert.equal(undoDecision({ root, configPath, repo: 'demo', fingerprint: FP }, deps).status, 'speculative');
  });

  it('validate every input', () => {
    const decide = (over: Record<string, unknown>) => () =>
      decideSpeculative({ root, configPath, repo: 'demo', fingerprint: FP, decision: 'refuted', reason: 'a reason', ...over } as Parameters<
        typeof decideSpeculative
      >[0]);
    assert.equal(status(decide({ decision: 'maybe' })), 400);
    assert.equal(status(decide({ reason: ' ' })), 400);
    assert.equal(status(decide({ fingerprint: 'nope' })), 400);
    assert.equal(status(decide({ repo: 'unknown' })), 400);
    assert.equal(status(decide({ fingerprint: OTHER })), 404);
    assert.equal(status(decide({})), 200);
    assert.equal(status(decide({})), 409, 'a decided candidate is no longer speculative');
    assert.equal(
      status(() => undoDecision({ root, configPath, repo: 'demo', fingerprint: OTHER })),
      404,
    );
  });
});
