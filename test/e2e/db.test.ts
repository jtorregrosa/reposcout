import assert from 'node:assert/strict';
import { join } from 'node:path';
import { afterEach, describe, it } from 'vitest';
import type { FindingEntry } from '../../src/findings/types.js';
import { createHome, type Home, readJsonFile } from './harness.js';

const FP = 'a'.repeat(32);
const CANDIDATE = 'b'.repeat(32);

const finding = (fingerprint: string, verified: boolean) => ({
  fingerprint,
  repo: 'demo',
  file: 'src/a.ts',
  line: 1,
  category: 'logic',
  severity: 'high',
  title: `Finding ${fingerprint[0]}`,
  verified,
});

function seed(home: Home): void {
  home.store((s) => {
    s.writeRepoState(
      'demo',
      {
        repo: 'demo',
        branch: 'main',
        last_commit: 'abc',
        findings: {
          [FP]: { status: 'open', first_seen: 't1', last_seen: 't1', finding: finding(FP, true) } as FindingEntry,
          [CANDIDATE]: { status: 'speculative', first_seen: 't1', last_seen: 't1', finding: finding(CANDIDATE, false) } as FindingEntry,
        },
      },
      { runId: 'run-1', at: 't1' },
    );
    s.decide('demo', CANDIDATE, { verdict: 'confirmed', reason: 'seen in production', decided_by: 'jorge', decided_at: 't2' });
  });
}

describe('e2e: db export and import', { timeout: 60_000 }, () => {
  const homes: Home[] = [];
  afterEach(() => {
    for (const h of homes.splice(0)) h.remove();
  });
  const newHome = () => {
    const h = createHome();
    homes.push(h);
    return h;
  };

  it('writes the manifest, the stage history and who acted', async () => {
    const home = newHome();
    seed(home);

    const result = await home.run(['db', 'export', '--out', 'backup']);

    assert.equal(result.code, 0, result.stderr);
    assert.equal(readJsonFile<{ format: string }>(join(home.dir, 'backup', 'manifest.json')).format, 'reposcout/export@1');
    const history = readJsonFile<{ fingerprint: string; actor: string | null }[]>(join(home.dir, 'backup', 'finding-history.json'));
    assert.equal(history.filter((e) => e.fingerprint === CANDIDATE).at(-1)?.actor, 'jorge');
    assert.deepEqual(readJsonFile<{ fingerprint: string; to_stage: string }[]>(join(home.dir, 'backup', 'finding-stages.json'))[0], {
      repo: 'demo',
      fingerprint: FP,
      at: 't1',
      run_id: 'run-1',
      from_stage: null,
      to_stage: 'validated',
      source: 'initial',
      note: null,
      actor: null,
    });
    assert.equal(readJsonFile<unknown[]>(join(home.dir, 'backup', 'decisions.json')).length, 1);
  });

  it('restores an export into an empty database, and refuses one that holds state', async () => {
    const source = newHome();
    seed(source);
    assert.equal((await source.run(['db', 'export', '--out', 'backup'])).code, 0);
    const target = newHome();

    const restored = await target.run(['db', 'import', '--from', join(source.dir, 'backup')]);

    assert.equal(restored.code, 0, restored.stderr);
    assert.match(restored.stdout, /Restored 1 repositories, 2 findings/);
    target.store((s) => {
      assert.equal(s.readRepoState('demo')?.findings[CANDIDATE]?.status, 'open');
      assert.equal(s.decisionsFor('demo').get(CANDIDATE)?.decided_by, 'jorge');
      assert.equal(s.stagesFor('demo').get(CANDIDATE)?.stage, 'validated');
    });
    const again = await target.run(['db', 'import', '--from', join(source.dir, 'backup')]);
    assert.equal(again.code, 1);
    assert.match(again.stderr, /already holds state/);
  });

  it('refuses a directory that is not an export', async () => {
    const home = newHome();

    const result = await home.run(['db', 'import', '--from', 'nowhere']);

    assert.equal(result.code, 1);
    assert.match(result.stderr, /is not a reposcout\/export@1 export/);
    home.store((s) => assert.deepEqual(s.repoNames(), []));
  });
});
