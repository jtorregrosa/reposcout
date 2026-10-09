import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, it } from 'vitest';
import { decideSpeculative, undoDecision } from '../src/dashboard/actions.js';
import { classify } from '../src/findings/classify.js';
import type { FindingEntry } from '../src/findings/types.js';
import { layout } from '../src/paths.js';
import type { RepoState } from '../src/state/types.js';
import { closeStores, DecisionError, openStore, Store } from '../src/store/index.js';
import { MIGRATIONS } from '../src/store/schema.js';

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

describe('the stage of a decided candidate', () => {
  it('becomes validated when an auditor confirms it, with the auditor as actor and no run', () => {
    const store = new Store(':memory:');
    store.writeRepoState('r', state({ [FP]: speculative() }), { runId: 'run-1', at: 't0' });
    store.decide('r', FP, decision('confirmed'));
    assert.deepEqual(store.stagesFor('r').get(FP), { stage: 'validated', source: 'auditor', since: 't1' });
    const last = store.stageHistory('r', FP).at(-1);
    assert.equal(last?.from_stage, 'detected');
    assert.equal(last?.actor, 'jorge');
    assert.equal(last?.run_id, null);
  });

  it('stays detected when an auditor refutes it', () => {
    const store = new Store(':memory:');
    store.writeRepoState('r', state({ [FP]: speculative() }), { runId: 'run-1', at: 't0' });
    store.decide('r', FP, decision('refuted'));
    assert.equal(store.stagesFor('r').get(FP)?.stage, 'detected');
    assert.equal(store.stageHistory('r', FP).length, 1);
  });

  it('returns to detected when the confirmation is withdrawn', () => {
    const store = new Store(':memory:');
    store.writeRepoState('r', state({ [FP]: speculative() }), { runId: 'run-1', at: 't0' });
    store.decide('r', FP, decision('confirmed'));
    store.undecide('r', FP, 'jorge', 't2');
    assert.deepEqual(store.stagesFor('r').get(FP), { stage: 'detected', source: 'withdrawn', since: 't2' });
    assert.equal(store.stageHistory('r', FP).at(-1)?.actor, 'jorge');
  });

  it('is not moved again by a run that re-applies the confirmation', () => {
    const store = new Store(':memory:');
    store.writeRepoState('r', state({ [FP]: speculative() }), { runId: 'run-1', at: 't0' });
    store.decide('r', FP, decision('confirmed'));
    store.writeRepoState('r', state({ [FP]: { ...speculative(), last_seen: 't2' } }), { runId: 'run-2', at: 't2' });
    assert.equal(store.stagesFor('r').get(FP)?.stage, 'validated');
    assert.equal(store.stageHistory('r', FP).length, 2);
  });
});

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

  it('is recorded as made on speculative', () => {
    const store = new Store(':memory:');
    store.writeRepoState('r', state({ [FP]: speculative() }), { runId: 'run-1', at: 't0' });
    store.decide('r', FP, decision('refuted'));
    assert.equal(store.decisionsFor('r').get(FP)?.decided_on, 'speculative');
  });
});

const open = (fingerprint = FP, verified = false): FindingEntry => {
  const s = speculative(fingerprint);
  return { ...s, status: 'open', finding: { ...s.finding, unconfirmed: undefined, verified } } as FindingEntry;
};
const refusedAs = (kind: DecisionError['kind']) => (e: unknown) => e instanceof DecisionError && e.kind === kind;

describe('a decision on an open finding', () => {
  it('confirms it as validated, keeping it open with no status history entry', () => {
    const store = new Store(':memory:');
    store.writeRepoState('r', state({ [FP]: open() }), { runId: 'run-1', at: 't0' });
    store.decide('r', FP, decision('confirmed'));
    assert.equal(store.readRepoState('r')?.findings[FP]?.status, 'open');
    assert.equal(store.findingHistory('r', FP).length, 1);
    assert.deepEqual(store.stagesFor('r').get(FP), { stage: 'validated', source: 'auditor', since: 't1' });
    assert.equal(store.stageHistory('r', FP).at(-1)?.actor, 'jorge');
    assert.equal(store.decisionsFor('r').get(FP)?.decided_on, 'open');
  });

  it('refutes it, with the reason as its resolution and its stage unchanged', () => {
    const store = new Store(':memory:');
    store.writeRepoState('r', state({ [FP]: open() }), { runId: 'run-1', at: 't0' });
    store.decide('r', FP, decision('refuted'));
    const e = store.readRepoState('r')?.findings[FP];
    assert.equal(e?.status, 'refuted');
    assert.equal(e?.resolution, 'Refuted by jorge: lists reach 300k rows');
    const last = store.findingHistory('r', FP).at(-1);
    assert.equal(last?.from_status, 'open');
    assert.equal(last?.to_status, 'refuted');
    assert.equal(last?.actor, 'jorge');
    assert.equal(store.stagesFor('r').get(FP)?.stage, 'detected');
  });

  it('keeps a refutation over a run that writes the finding as open again', () => {
    const store = new Store(':memory:');
    store.writeRepoState('r', state({ [FP]: open() }), { runId: 'run-1', at: 't0' });
    store.decide('r', FP, decision('refuted'));
    store.writeRepoState('r', state({ [FP]: { ...open(FP, true), last_seen: 't2' } }), { runId: 'run-2', at: 't2' });
    assert.equal(store.readRepoState('r')?.findings[FP]?.status, 'refuted');
    assert.equal(store.findingHistory('r', FP).at(-1)?.to_status, 'refuted');
  });

  it('returns a withdrawn refutation to open, without the resolution', () => {
    const store = new Store(':memory:');
    store.writeRepoState('r', state({ [FP]: open() }), { runId: 'run-1', at: 't0' });
    store.decide('r', FP, decision('refuted'));
    const back = store.undecide('r', FP, 'jorge', 't2');
    assert.equal(back.status, 'open');
    const e = store.readRepoState('r')?.findings[FP];
    assert.equal(e?.status, 'open');
    assert.equal(e?.resolution, undefined);
    const last = store.findingHistory('r', FP).at(-1);
    assert.equal(last?.from_status, 'refuted');
    assert.equal(last?.to_status, 'open');
    assert.equal(last?.note, 'Decision withdrawn by jorge');
  });

  it('returns a withdrawn confirmation to detected, keeping the finding open', () => {
    const store = new Store(':memory:');
    store.writeRepoState('r', state({ [FP]: open() }), { runId: 'run-1', at: 't0' });
    store.decide('r', FP, decision('confirmed'));
    store.undecide('r', FP, 'jorge', 't2');
    assert.equal(store.readRepoState('r')?.findings[FP]?.status, 'open');
    assert.equal(store.findingHistory('r', FP).length, 1);
    assert.deepEqual(store.stagesFor('r').get(FP), { stage: 'detected', source: 'withdrawn', since: 't2' });
  });

  it('keeps the stage validated when the confirmation is withdrawn after a reproduction', () => {
    const store = new Store(':memory:');
    store.writeRepoState('r', state({ [FP]: open() }), { runId: 'run-1', at: 't0' });
    store.decide('r', FP, decision('confirmed'));
    store.writeRepoState('r', state({ [FP]: { ...open(FP, true), last_seen: 't2' } }), { runId: 'run-2', at: 't2' });
    store.undecide('r', FP, 'jorge', 't3');
    assert.equal(store.stagesFor('r').get(FP)?.stage, 'validated');
  });

  it('is refused for an unknown finding, a closed one, a decided one and a validated one', () => {
    const store = new Store(':memory:');
    const resolved = { ...open(OTHER), status: 'resolved' as const };
    const third = 'c'.repeat(32);
    const fourth = 'd'.repeat(32);
    store.writeRepoState('r', state({ [FP]: speculative(), [OTHER]: resolved, [third]: open(third, true), [fourth]: open(fourth) }), {
      runId: 'run-1',
      at: 't0',
    });
    assert.throws(() => store.decide('r', 'e'.repeat(32), decision('refuted')), refusedAs('not-found'));
    assert.throws(() => store.decide('r', OTHER, decision('refuted')), refusedAs('not-decidable'));
    store.decide('r', FP, decision('confirmed'));
    assert.throws(() => store.decide('r', FP, decision('refuted')), refusedAs('already-decided'));
    assert.throws(() => store.decide('r', third, decision('confirmed')), refusedAs('already-validated'));
    store.decide('r', third, decision('refuted'));
    assert.equal(store.readRepoState('r')?.findings[third]?.status, 'refuted');
    assert.equal(store.readRepoState('r')?.findings[fourth]?.status, 'open');
  });

  it('treats a decision stored before decided_on existed as made on speculative', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'reposcout-triage-')), 'old.db');
    const old = new Database(file);
    old.exec(MIGRATIONS.slice(0, -1).join('\n'));
    old.pragma(`user_version = ${MIGRATIONS.length - 1}`);
    old
      .prepare(`INSERT INTO triage (repo, fingerprint, verdict, reason, decided_by, decided_at) VALUES ('r', ?, 'refuted', 'not reachable', 'jorge', 't1')`)
      .run(FP);
    old.close();
    const store = new Store(file);
    assert.equal(store.decisionsFor('r').get(FP)?.decided_on, 'speculative');
    store.writeRepoState('r', state({ [FP]: speculative() }), { runId: 'run-1', at: 't2' });
    assert.equal(store.readRepoState('r')?.findings[FP]?.status, 'refuted');
    store.close();
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

  it('decide an open finding, refusing to confirm one already validated and to decide one twice', () => {
    writeFileSync(join(root, 'state', 'demo.json'), JSON.stringify({ ...state({ [FP]: open(), [OTHER]: open(OTHER, true) }), repo: 'demo' }));
    const deps = { by: 'auditor-1', now: () => '2026-10-08T10:00:00.000Z' };
    const decide = (fingerprint: string, decision: string) => () =>
      decideSpeculative({ root, configPath, repo: 'demo', fingerprint, decision, reason: 'checked by hand' }, deps);
    assert.equal(status(decide(OTHER, 'confirmed')), 409);
    assert.equal(
      decideSpeculative({ root, configPath, repo: 'demo', fingerprint: FP, decision: 'refuted', reason: 'checked by hand' }, deps).status,
      'refuted',
    );
    assert.equal(status(decide(FP, 'confirmed')), 409);
    assert.equal(undoDecision({ root, configPath, repo: 'demo', fingerprint: FP }, deps).status, 'open');
    assert.equal(status(decide(FP, 'confirmed')), 200);
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
    assert.equal(status(decide({})), 409, 'a decided candidate is not decided again');
    assert.equal(
      status(() => undoDecision({ root, configPath, repo: 'demo', fingerprint: OTHER })),
      404,
    );
  });
});
