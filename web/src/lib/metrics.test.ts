import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { costSummary, precisionBy, yieldByAnalyzer } from './metrics';
import type { PrecisionCell, UsageRow, YieldRow } from './types';

const cell = (over: Partial<PrecisionCell>): PrecisionCell => ({
  repo: 'a',
  category: 'security',
  model: 'sonnet',
  prompt_version: 'p1',
  kept: 0,
  suppressed: 0,
  refuted: 0,
  ...over,
});

const yieldRow = (over: Partial<YieldRow>): YieldRow => ({
  run_id: 'run-1',
  repo: 'a',
  at: '2026-10-08T00:00:00.000Z',
  mode: 'full',
  prompt_version: 'p1',
  model: 'sonnet',
  analyzer: 'security',
  instances: 1,
  candidates: 4,
  kept: 1,
  speculative: 1,
  discarded: 2,
  tokens: 100,
  cost_usd: 1,
  ...over,
});

describe('precision', () => {
  it('adds the cells up along one dimension, for one repository or all', () => {
    const cells = [
      cell({ kept: 3, suppressed: 1 }),
      cell({ repo: 'b', kept: 1, refuted: 1 }),
      cell({ category: 'logic', model: 'opus', kept: 0, refuted: 0 }),
      cell({ category: 'logic', prompt_version: null, kept: 1 }),
    ];
    const byCategory = precisionBy(cells, 'category');
    assert.deepEqual(
      byCategory.map((r) => [r.key, r.kept, r.dismissed, r.precision]),
      [
        ['security', 4, 2, 4 / 6],
        ['logic', 1, 0, 1],
      ],
    );
    assert.deepEqual(
      precisionBy(cells, 'category', 'b').map((r) => [r.key, r.precision]),
      [['security', 0.5]],
    );
    assert.deepEqual(
      precisionBy(cells, 'model').map((r) => [r.key, r.kept + r.dismissed]),
      [
        ['sonnet', 7],
        ['opus', 0],
      ],
    );
    assert.equal(precisionBy(cells, 'model').at(-1)?.precision, null);
    assert.ok(precisionBy(cells, 'prompt_version').some((r) => r.key === null));
  });
});

describe('yield', () => {
  it('sums each analyzer and leaves unread replies out of the candidates', () => {
    const [logic, security] = yieldByAnalyzer(
      [yieldRow({}), yieldRow({ run_id: 'run-2', candidates: null }), yieldRow({ analyzer: 'logic', candidates: null, tokens: null, cost_usd: 3 })],
      8,
    );
    assert.deepEqual(security, {
      analyzer: 'security',
      runs: 2,
      candidates: 4,
      unparsed: 1,
      kept: 2,
      speculative: 2,
      discarded: 4,
      tokens: 200,
      cost_usd: 2,
      cost_share: 0.25,
    });
    assert.equal(logic?.candidates, null);
    assert.equal(logic?.tokens, null);
    assert.equal(logic?.cost_share, 3 / 8);
  });
});

describe('cost', () => {
  it('divides what every run cost by what the runs found for the first time', () => {
    const usage = [{ cost_usd_equivalent: 3 }, { cost_usd_equivalent: 1 }, { cost_usd_equivalent: null }] as UsageRow[];
    const results = [
      { run_id: 'r1', repo: 'a', generated_at: 't', new_findings: 1, new_speculative: 3 },
      { run_id: 'r2', repo: 'a', generated_at: 't', new_findings: 1, new_speculative: 0 },
    ];
    assert.deepEqual(costSummary(usage, results), { total: 4, runs: 2, findings: 5, confirmed: 2, per_finding: 0.8, per_confirmed: 2 });
    assert.deepEqual(costSummary([], []), { total: null, runs: 0, findings: 0, confirmed: 0, per_finding: null, per_confirmed: null });
  });
});
