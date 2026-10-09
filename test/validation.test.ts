import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import type { StageState } from '../src/findings/stage.js';
import type { FindingEntry, FindingsState } from '../src/findings/types.js';
import { applyValidation, pickValidationCandidates, type ValidationCandidate } from '../src/findings/validation.js';
import type { Decision, ValidationAttempt } from '../src/state/types.js';

const fp = (c: string) => c.repeat(32);

const entry = (over: Partial<FindingEntry> & { severity?: string; file?: string } = {}): FindingEntry => {
  const { severity = 'medium', file = 'src/a.ts', ...rest } = over;
  return {
    status: 'open',
    first_seen: '2026-10-01T00:00:00.000Z',
    last_seen: '2026-10-01T00:00:00.000Z',
    finding: { file, line: 3, category: 'logic', severity, confidence: 'high', title: `Finding in ${file}`, description: 'why', verified: false },
    ...rest,
  } as FindingEntry;
};

const detected: StageState = { stage: 'detected', source: 'initial', since: 't0' };
const failedTry = (n: number): ValidationAttempt => ({ at: `t${n}`, run_id: `run-${n}`, outcome: 'not_reproduced', reason: `try ${n}` });

const pick = (findings: FindingsState, over: Partial<Parameters<typeof pickValidationCandidates>[0]> = {}) =>
  pickValidationCandidates({
    findings,
    stages: new Map(Object.keys(findings).map((k) => [k, detected])),
    decisions: new Map(),
    suppressed: new Set(),
    attempts: new Map(),
    fileExists: () => true,
    ...over,
  });

describe('picking the findings a validation pass tries', () => {
  it('takes untried findings first, then the most severe, then the oldest, up to the limit', () => {
    const findings: FindingsState = {
      [fp('a')]: entry({ severity: 'critical' }),
      [fp('b')]: entry({ severity: 'low', first_seen: '2026-09-01T00:00:00.000Z' }),
      [fp('c')]: entry({ severity: 'low', first_seen: '2026-09-15T00:00:00.000Z' }),
      [fp('d')]: entry({ severity: 'high' }),
    };
    const picked = pick(findings, { attempts: new Map([[fp('a'), [failedTry(1)]]]), limit: 3 });
    assert.deepEqual(
      picked.map((c) => c.fingerprint),
      [fp('d'), fp('b'), fp('c')],
    );
    assert.deepEqual(pick(findings, { attempts: new Map([[fp('a'), [failedTry(1)]]]) }).at(-1)?.previous_attempts, ['try 1']);
  });

  it('leaves out decided, pending-suppressed, twice-tried, gone and already validated findings, and anything not open', () => {
    const findings: FindingsState = {
      [fp('a')]: entry(),
      [fp('b')]: entry(),
      [fp('c')]: entry(),
      [fp('d')]: entry({ file: 'src/gone.ts' }),
      [fp('e')]: entry(),
      [fp('f')]: entry({ status: 'speculative' }),
      [fp('g')]: entry(),
    };
    const decision: Decision = { verdict: 'refuted', reason: 'no', decided_by: 'jorge', decided_at: 't1', decided_on: 'open' };
    const picked = pick(findings, {
      decisions: new Map([[fp('a'), decision]]),
      suppressed: new Set([fp('b')]),
      attempts: new Map([[fp('c'), [failedTry(1), failedTry(2)]]]),
      fileExists: (file) => file !== 'src/gone.ts',
      stages: new Map([
        [fp('e'), { stage: 'validated', source: 'auditor', since: 't1' }],
        [fp('g'), detected],
      ]),
    });
    assert.deepEqual(
      picked.map((c) => c.fingerprint),
      [fp('g')],
    );
  });
});

describe('applying a validation pass', () => {
  const previous: FindingsState = { [fp('a')]: entry(), [fp('b')]: entry(), [fp('c')]: entry(), [fp('d')]: entry() };
  const candidates = Object.entries(previous).map(([fingerprint, e]): ValidationCandidate => ({ ...e.finding, fingerprint, previous_attempts: [] }));
  const apply = (review: unknown) => applyValidation({ previous, candidates, review, runId: 'run-v', at: 't9' });

  it('sets verified and the test on a reproduced finding and changes nothing else', () => {
    const { nextState, block } = apply([{ fingerprint: fp('a'), verdict: 'reproduced', reason: 'failed', reproduction: 'the test and its output' }]);
    assert.deepEqual(nextState[fp('a')], {
      ...previous[fp('a')],
      finding: { ...previous[fp('a')]?.finding, verified: true, reproduction: 'the test and its output' },
    });
    assert.deepEqual(
      block.reproduced.map((f) => f.fingerprint),
      [fp('a')],
    );
  });

  it('records an attempt per answer and leaves the state of the unreproduced ones untouched', () => {
    const { nextState, attempts, block } = apply([
      { fingerprint: fp('b'), verdict: 'not_reproduced', reason: 'the test passed' },
      { fingerprint: fp('c'), verdict: 'not_testable', reason: 'needs a database' },
    ]);
    assert.deepEqual(nextState, previous);
    assert.deepEqual(
      attempts.map((a) => [a.fingerprint, a.outcome, a.reason, a.run_id, a.at]),
      [
        [fp('b'), 'not_reproduced', 'the test passed', 'run-v', 't9'],
        [fp('c'), 'not_testable', 'needs a database', 'run-v', 't9'],
      ],
    );
    assert.deepEqual(block.unreviewed, [fp('a'), fp('d')]);
    assert.equal(block.tried, 4);
  });

  it('ignores answers for other fingerprints, repeated answers and unknown verdicts', () => {
    const { attempts, block } = apply([
      { fingerprint: fp('z'), verdict: 'reproduced' },
      { fingerprint: fp('a'), verdict: 'confirmed' },
      { fingerprint: fp('b'), verdict: 'not_testable', reason: 'first' },
      { fingerprint: fp('b'), verdict: 'reproduced', reason: 'second' },
      null,
    ]);
    assert.deepEqual(
      attempts.map((a) => [a.fingerprint, a.reason]),
      [[fp('b'), 'first']],
    );
    assert.deepEqual(block.unreviewed, [fp('a'), fp('c'), fp('d')]);
  });

  it('treats a missing review as no answer at all', () => {
    const { attempts, nextState } = apply(undefined);
    assert.deepEqual(attempts, []);
    assert.deepEqual(nextState, previous);
  });
});
