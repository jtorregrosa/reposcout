import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { stageTimeline } from './stages';
import type { StageEvent } from './types';

const event = (at: string, from_stage: StageEvent['from_stage'], to_stage: StageEvent['to_stage'], source: StageEvent['source']): StageEvent => ({
  at,
  run_id: null,
  from_stage,
  to_stage,
  source,
  note: null,
  actor: null,
});

describe('the stage timeline', () => {
  it('dates every stage a finding entered and leaves reported unreached', () => {
    const steps = stageTimeline(
      [event('t1', null, 'detected', 'initial'), event('t2', 'detected', 'validated', 'auditor'), event('t3', 'validated', 'fixed', 'resolved')],
      'fixed',
    );
    assert.deepEqual(
      steps.map((s) => [s.stage, s.entered, s.current]),
      [
        ['detected', 't1', false],
        ['validated', 't2', false],
        ['reported', null, false],
        ['fixed', 't3', true],
      ],
    );
  });

  it('dates detected from the first entry when a finding started validated', () => {
    const steps = stageTimeline([event('t1', null, 'validated', 'initial')], 'validated');
    assert.deepEqual(
      steps.map((s) => s.entered),
      ['t1', 't1', null, null],
    );
  });

  it('clears the steps above a reopened finding', () => {
    const steps = stageTimeline(
      [event('t1', null, 'detected', 'initial'), event('t2', 'detected', 'fixed', 'resolved'), event('t3', 'fixed', 'detected', 'reopened')],
      'detected',
    );
    assert.deepEqual(
      steps.map((s) => [s.stage, s.entered, s.current]),
      [
        ['detected', 't3', true],
        ['validated', null, false],
        ['reported', null, false],
        ['fixed', null, false],
      ],
    );
  });
});
