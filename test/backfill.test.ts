import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'vitest';
import { readRepros } from '../src/backfill/repro.js';
import type { FindingEntry } from '../src/findings/types.js';
import type { RepoState } from '../src/state/types.js';
import { Store } from '../src/store/index.js';
import { silentLogger } from '../src/telemetry/logger.js';

const fp = (c: string) => c.repeat(32);
const entry = (fingerprint: string, severity: string, status: string, repro?: object): FindingEntry =>
  ({
    status,
    first_seen: 't0',
    last_seen: 't0',
    finding: {
      fingerprint,
      repo: 'r',
      file: `src/${fingerprint[0]}.cs`,
      line: 1,
      category: 'logic',
      severity,
      title: fingerprint[0],
      ...(repro ? { repro } : {}),
    },
  }) as FindingEntry;
const steps = { preconditions: [], steps: ['do it'], expected: 'ok', actual: 'not ok' };

function seeded() {
  const store = new Store(':memory:');
  const state: RepoState = {
    repo: 'r',
    branch: 'main',
    last_commit: 'abc',
    findings: {
      [fp('a')]: entry(fp('a'), 'low', 'open'),
      [fp('b')]: entry(fp('b'), 'critical', 'speculative'),
      [fp('c')]: entry(fp('c'), 'critical', 'open'),
      [fp('d')]: entry(fp('d'), 'high', 'open', steps),
      [fp('e')]: entry(fp('e'), 'high', 'resolved'),
    },
  };
  store.writeRepoState('r', state, { runId: 'run-1', at: 't0' });
  return store;
}

describe('findings to fill with reproduction steps', () => {
  it('lists those without steps in the statuses asked for, most severe first and open before speculative', () => {
    const list = seeded().findingsWithout('repro', ['r'], ['open', 'speculative']);
    assert.deepEqual(
      list.map((f) => f.fingerprint[0]),
      ['c', 'b', 'a'],
    );
  });

  it('adds steps once and never overwrites steps a finding already has', () => {
    const store = seeded();
    assert.equal(store.setRepro('r', [{ fingerprint: fp('a'), repro: steps }]), 1);
    assert.equal(store.setRepro('r', [{ fingerprint: fp('a'), repro: { ...steps, steps: ['other'] } }]), 0);
    assert.deepEqual(store.readRepoState('r')?.findings[fp('a')]?.finding.repro, steps);
    assert.equal(store.readRepoState('r')?.findings[fp('a')]?.status, 'open', 'nothing else about the finding changes');
  });
});

describe('the output of a backfill session', () => {
  const file = (content: unknown) => {
    const p = join(mkdtempSync(join(tmpdir(), 'reposcout-backfill-')), 'repros.json');
    writeFileSync(p, typeof content === 'string' ? content : JSON.stringify(content));
    return p;
  };

  it('keeps only well-formed steps for findings that were in the batch', () => {
    const out = readRepros(
      file({
        repros: [
          { fingerprint: fp('a'), repro: steps },
          { fingerprint: fp('z'), repro: steps },
          { fingerprint: fp('b'), repro: { steps: [] } },
        ],
      }),
      new Set([fp('a'), fp('b')]),
      silentLogger,
    );
    assert.deepEqual(
      out.map((r) => r.fingerprint),
      [fp('a')],
    );
  });

  it('yields nothing from a missing or broken file', () => {
    assert.deepEqual(readRepros(join(tmpdir(), 'no-such-file.json'), new Set([fp('a')]), silentLogger), []);
    assert.deepEqual(readRepros(file('{not json'), new Set([fp('a')]), silentLogger), []);
  });
});
