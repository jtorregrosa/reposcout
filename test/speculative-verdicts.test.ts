import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { classify } from '../src/findings/classify.js';
import { speculativeVerdicts } from '../src/findings/speculative.js';
import type { FindingEntry } from '../src/findings/types.js';
import type { RepoState } from '../src/state/types.js';
import { Store } from '../src/store/index.js';

const KEPT = 'a'.repeat(32);
const DUP = 'b'.repeat(32);
const OTHER = 'c'.repeat(32);
const SILENT = 'd'.repeat(32);
const CONFIRMED = 'e'.repeat(32);

const candidate = (fingerprint: string, title: string) => ({ fingerprint, file: `src/${fingerprint.slice(0, 1)}.cs`, title });
const speculative = (fingerprint: string): FindingEntry =>
  ({
    status: 'speculative',
    first_seen: 't0',
    last_seen: 't0',
    finding: { fingerprint, repo: 'r', file: `src/${fingerprint.slice(0, 1)}.cs`, line: 1, category: 'security', severity: 'high', title: fingerprint },
  }) as FindingEntry;

describe('speculative verdicts', () => {
  const candidates = [
    candidate(KEPT, 'SSRF'),
    candidate(DUP, 'SSRF again'),
    candidate(OTHER, 'Weak check'),
    candidate(SILENT, 'Quiet'),
    candidate(CONFIRMED, 'Real'),
  ];

  it('settles a candidate the verifier discarded instead of leaving it speculative', () => {
    const { reviews } = speculativeVerdicts(
      candidates,
      {
        speculative_review: [{ fingerprint: KEPT, verdict: 'still_speculative', reason: 'depends on egress rules' }],
        discarded: [
          { title: 'SSRF again', file: 'src/b.cs', reason: 'duplicate' },
          { title: 'Weak check', file: 'src/c.cs', reason: 'prevented elsewhere' },
        ],
      },
      new Set([CONFIRMED]),
    );
    const by = new Map(reviews.map((r) => [r.fingerprint, r.verdict]));
    assert.equal(by.get(DUP), 'duplicate');
    assert.equal(by.get(OTHER), 'refuted');
    assert.equal(by.get(KEPT), 'still_speculative');
  });

  it('reports the candidates that got no verdict, but not the confirmed ones', () => {
    const { unreviewed } = speculativeVerdicts(candidates, { speculative_review: [], discarded: [] }, new Set([CONFIRMED]));
    assert.ok(unreviewed.includes(SILENT));
    assert.ok(!unreviewed.includes(CONFIRMED));
  });

  it('ignores verdicts for fingerprints that were not under review', () => {
    const { reviews } = speculativeVerdicts([candidate(KEPT, 'x')], { speculative_review: [{ fingerprint: OTHER, verdict: 'refuted' }] }, new Set());
    assert.equal(reviews.length, 0);
  });
});

describe('a duplicate verdict', () => {
  it('takes the candidate out of the speculative queue and names the one that is kept', () => {
    const { nextState, refuted } = classify({
      findings: [],
      previous: { findings: { [KEPT]: speculative(KEPT), [DUP]: speculative(DUP) } },
      speculativeReviews: [{ fingerprint: DUP, verdict: 'duplicate', duplicate_of: KEPT, reason: 'same root cause' }],
      auditedFiles: [],
      deletedFiles: [],
      reviews: [],
      runAt: 't1',
    });
    assert.equal(nextState[DUP]?.status, 'duplicate');
    assert.match(nextState[DUP]?.resolution ?? '', new RegExp(KEPT));
    assert.equal(nextState[KEPT]?.status, 'speculative');
    assert.equal(refuted[0]?.status, 'duplicate');
  });

  it('is not raised again as a speculative candidate by a later audit', () => {
    const dup = { ...speculative(DUP), status: 'duplicate' as const };
    const { nextState, speculativeNew } = classify({
      findings: [],
      speculative: [dup.finding],
      previous: { findings: { [DUP]: dup } },
      auditedFiles: ['src/b.cs'],
      deletedFiles: [],
      reviews: [],
      runAt: 't2',
    });
    assert.equal(nextState[DUP]?.status, 'duplicate');
    assert.equal(speculativeNew.length, 0);
  });
});

describe('the history of a review that changes nothing', () => {
  it('records that the candidate was reviewed and what the reviewer said', () => {
    const store = new Store(':memory:');
    const state = (entry: FindingEntry): RepoState => ({ repo: 'r', branch: 'main', last_commit: 'abc', findings: { [KEPT]: entry } });
    store.writeRepoState('r', state(speculative(KEPT)), { runId: 'run-1', at: 't1' });
    store.writeRepoState('r', state({ ...speculative(KEPT), last_seen: 't2', review_note: 'depends on egress rules' }), { runId: 'run-2', at: 't2' });
    const history = store.findingHistory('r', KEPT);
    assert.deepEqual(history.at(-1), {
      at: 't2',
      run_id: 'run-2',
      from_status: 'speculative',
      to_status: 'speculative',
      note: 'depends on egress rules',
      actor: null,
    });
    store.close();
  });
});
