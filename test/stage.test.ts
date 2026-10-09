import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { initialStage, nextStage, type StageState, withdrawnStage } from '../src/findings/stage.js';
import type { FindingEntry, FindingStatus } from '../src/findings/types.js';

const entry = (status: FindingStatus, verified = false, resolution?: string): FindingEntry =>
  ({ status, first_seen: 't0', last_seen: 't0', ...(resolution ? { resolution } : {}), finding: { verified } }) as FindingEntry;
const at = (stage: StageState['stage'], source: StageState['source'] = 'initial'): StageState => ({ stage, source, since: 't0' });

describe('the initial stage', () => {
  it('is detected for a new open finding nobody reproduced', () => {
    assert.equal(initialStage(entry('open'), false), 'detected');
  });

  it('is detected for a new speculative candidate', () => {
    assert.equal(initialStage(entry('speculative'), false), 'detected');
  });

  it('is validated for a new open finding a test reproduced', () => {
    assert.equal(initialStage(entry('open', true), false), 'validated');
  });

  it('is validated for an open finding an auditor confirmed', () => {
    assert.equal(initialStage(entry('open'), true), 'validated');
  });

  it('is fixed for a resolved finding', () => {
    assert.equal(initialStage(entry('resolved', true), false), 'fixed');
  });

  it('is what nextStage gives a fingerprint with no stage yet, with the source initial', () => {
    assert.deepEqual(nextStage({ current: undefined, previousStatus: undefined, entry: entry('open', true), confirmedByAuditor: false }), {
      stage: 'validated',
      source: 'initial',
      note: null,
    });
  });
});

describe('a stage transition', () => {
  it('validates a detected open finding once a test reproduces it', () => {
    const change = nextStage({ current: at('detected'), previousStatus: 'open', entry: entry('open', true), confirmedByAuditor: false });
    assert.deepEqual(change, { stage: 'validated', source: 'reproduced', note: null });
  });

  it('validates a candidate that an auditor confirmation made open', () => {
    const change = nextStage({ current: at('detected'), previousStatus: 'speculative', entry: entry('open'), confirmedByAuditor: true });
    assert.deepEqual(change, { stage: 'validated', source: 'auditor', note: null });
  });

  it('keeps a validated finding validated when a later run does not reproduce it', () => {
    assert.equal(nextStage({ current: at('validated', 'reproduced'), previousStatus: 'open', entry: entry('open'), confirmedByAuditor: false }), null);
  });

  it('moves a finding to fixed when it is resolved, with the resolution as note', () => {
    const change = nextStage({ current: at('validated'), previousStatus: 'open', entry: entry('resolved', false, 'file deleted'), confirmedByAuditor: false });
    assert.deepEqual(change, { stage: 'fixed', source: 'resolved', note: 'file deleted' });
  });

  it('leaves a finding that stays resolved alone', () => {
    assert.equal(nextStage({ current: at('fixed'), previousStatus: 'resolved', entry: entry('resolved'), confirmedByAuditor: false }), null);
  });

  it('returns a reopened finding to the stage it had before fixed', () => {
    const change = nextStage({
      current: at('fixed', 'resolved'),
      previousStatus: 'resolved',
      entry: entry('open'),
      confirmedByAuditor: false,
      lookback: { beforeFixed: 'validated' },
    });
    assert.deepEqual(change, { stage: 'validated', source: 'reopened', note: null });
  });

  it('returns a reopened finding to detected when its earlier stage is unknown', () => {
    const change = nextStage({ current: at('fixed', 'upgrade'), previousStatus: 'resolved', entry: entry('open'), confirmedByAuditor: false });
    assert.deepEqual(change, { stage: 'detected', source: 'reopened', note: null });
  });

  it('validates a reopened finding the reopening run reproduced', () => {
    const change = nextStage({
      current: at('fixed', 'resolved'),
      previousStatus: 'resolved',
      entry: entry('open', true),
      confirmedByAuditor: false,
      lookback: { beforeFixed: 'detected' },
    });
    assert.deepEqual(change, { stage: 'validated', source: 'reopened', note: null });
  });

  it('reopens a resolved finding raised again only as speculative', () => {
    const change = nextStage({
      current: at('fixed', 'resolved'),
      previousStatus: 'resolved',
      entry: entry('speculative'),
      confirmedByAuditor: false,
      lookback: { beforeFixed: 'detected' },
    });
    assert.deepEqual(change, { stage: 'detected', source: 'reopened', note: null });
  });

  it('restores reported on reopening when the history held it', () => {
    const change = nextStage({
      current: at('fixed', 'resolved'),
      previousStatus: 'resolved',
      entry: entry('open'),
      confirmedByAuditor: false,
      lookback: { beforeFixed: 'reported' },
    });
    assert.equal(change?.stage, 'reported');
  });

  for (const status of ['suppressed', 'refuted', 'duplicate'] as const) {
    it(`keeps the stage of a finding that becomes ${status}`, () => {
      assert.equal(nextStage({ current: at('validated'), previousStatus: 'open', entry: entry(status, true), confirmedByAuditor: false }), null);
    });
  }

  it('never moves a finding to reported on its own', () => {
    const statuses: FindingStatus[] = ['open', 'speculative', 'resolved', 'suppressed', 'refuted', 'duplicate'];
    for (const previousStatus of statuses) {
      for (const status of statuses) {
        for (const stage of ['detected', 'validated', 'fixed'] as const) {
          for (const verified of [false, true]) {
            const change = nextStage({ current: at(stage), previousStatus, entry: entry(status, verified), confirmedByAuditor: verified });
            assert.notEqual(change?.stage, 'reported');
          }
        }
      }
    }
  });
});

describe('withdrawing an auditor confirmation', () => {
  it('returns the candidate to the stage it had before the confirmation', () => {
    assert.deepEqual(withdrawnStage(at('validated', 'auditor'), entry('speculative'), { beforeAuditor: 'detected' }), {
      stage: 'detected',
      source: 'withdrawn',
      note: null,
    });
  });

  it('keeps a finding validated when a test has since reproduced it', () => {
    assert.equal(withdrawnStage(at('validated', 'auditor'), entry('speculative', true), { beforeAuditor: 'detected' }), null);
  });

  it('leaves a stage the confirmation did not set alone', () => {
    assert.equal(withdrawnStage(at('validated', 'reproduced'), entry('speculative'), {}), null);
  });
});

describe('an auditor confirmation of an open finding', () => {
  it('validates it when it is detected', () => {
    assert.deepEqual(nextStage({ current: at('detected'), previousStatus: 'open', entry: entry('open'), confirmedByAuditor: true }), {
      stage: 'validated',
      source: 'auditor',
      note: null,
    });
  });

  it('returns it to detected when withdrawn, while it stays open', () => {
    assert.deepEqual(withdrawnStage(at('validated', 'auditor'), entry('open'), { beforeAuditor: 'detected' }), {
      stage: 'detected',
      source: 'withdrawn',
      note: null,
    });
  });

  it('keeps it validated when withdrawn after a test reproduced it', () => {
    assert.equal(withdrawnStage(at('validated', 'auditor'), entry('open', true), { beforeAuditor: 'detected' }), null);
  });
});
