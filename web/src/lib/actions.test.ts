import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { finding } from '@/test/fixtures';
import { availableActions, commonActions, validReason } from './actions';

const decision = { verdict: 'confirmed' as const, reason: 'Checked', decided_by: 'alice', decided_at: '2026-10-08T00:00:00.000Z', decided_on: 'open' as const };

describe('available actions', () => {
  it('offer confirm and refute on an undecided speculative candidate, never suppress', () => {
    assert.deepEqual(availableActions(finding({ status: 'speculative' })), { confirm: true, refute: true, suppress: false, unsuppress: false });
  });

  it('offer everything but unsuppress on an undecided open finding at detected', () => {
    assert.deepEqual(availableActions(finding({ status: 'open', stage: 'detected' })), { confirm: true, refute: true, suppress: true, unsuppress: false });
  });

  it('do not offer confirm past detected', () => {
    assert.equal(availableActions(finding({ status: 'open', stage: 'validated' })).confirm, false);
    assert.equal(availableActions(finding({ status: 'open', stage: 'validated' })).refute, true);
  });

  it('leave only suppress on a confirmed finding', () => {
    assert.deepEqual(availableActions(finding({ status: 'open', stage: 'validated', decision })), {
      confirm: false,
      refute: false,
      suppress: true,
      unsuppress: false,
    });
  });

  it('offer only unsuppress on a suppressed finding, and nothing on a resolved one', () => {
    assert.deepEqual(availableActions(finding({ status: 'suppressed' })), { confirm: false, refute: false, suppress: false, unsuppress: true });
    assert.deepEqual(availableActions(finding({ status: 'resolved', stage: 'fixed' })), { confirm: false, refute: false, suppress: false, unsuppress: false });
  });

  it('keep for a selection only what every finding allows', () => {
    const mixed = commonActions([finding({ status: 'speculative' }), finding({ status: 'open', stage: 'validated', decision })]);
    assert.equal(mixed.refute, false);
    assert.equal(mixed.suppress, false);
    assert.equal(commonActions([finding({ status: 'speculative' }), finding({ status: 'open' })]).refute, true);
    assert.equal(commonActions([]).refute, false);
  });
});

describe('reasons', () => {
  it('need 3 to 300 characters once trimmed', () => {
    assert.equal(validReason('  ab '), false);
    assert.equal(validReason('abc'), true);
    assert.equal(validReason('a'.repeat(301)), false);
  });
});
