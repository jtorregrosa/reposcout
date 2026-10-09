import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { STAGES } from './domain';
import { STATUSES } from './findings-view';
import { QUEUES, queueOf } from './queues';

describe('work queues', () => {
  it('put every status and stage pair in exactly one queue', () => {
    for (const status of STATUSES) {
      for (const stage of STAGES) {
        const q = queueOf({ status, stage });
        assert.ok(QUEUES.includes(q), `${status}/${stage} has no queue`);
      }
    }
  });

  it('send speculative candidates and detected open findings to Triage', () => {
    assert.equal(queueOf({ status: 'speculative', stage: 'detected' }), 'triage');
    assert.equal(queueOf({ status: 'open', stage: 'detected' }), 'triage');
  });

  it('follow the stage of an open finding', () => {
    assert.equal(queueOf({ status: 'open', stage: 'validated' }), 'report');
    assert.equal(queueOf({ status: 'open', stage: 'reported' }), 'reported');
    assert.equal(queueOf({ status: 'open', stage: 'fixed' }), 'closed');
  });

  it('close everything that is neither open nor speculative', () => {
    for (const status of ['resolved', 'suppressed', 'refuted', 'duplicate'] as const) assert.equal(queueOf({ status, stage: 'validated' }), 'closed');
  });
});
