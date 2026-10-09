import assert from 'node:assert/strict';
import { join } from 'node:path';
import { afterEach, describe, it } from 'vitest';
import type { FindingEntry } from '../../src/findings/types.js';
import { createHome, type Home, readJsonFile } from './harness.js';

const FP = 'a'.repeat(32);

describe('e2e: db export', { timeout: 60_000 }, () => {
  let home: Home;
  afterEach(() => home?.remove());

  it('writes the stage history beside the status history', async () => {
    home = createHome();
    const finding = { fingerprint: FP, repo: 'demo', file: 'src/a.ts', line: 1, category: 'logic', severity: 'high', title: 'A finding', verified: true };
    home.store((s) =>
      s.writeRepoState(
        'demo',
        {
          repo: 'demo',
          branch: 'main',
          last_commit: 'abc',
          findings: { [FP]: { status: 'open', first_seen: 't1', last_seen: 't1', finding } as FindingEntry },
        },
        { runId: 'run-1', at: 't1' },
      ),
    );

    const result = await home.run(['db', 'export', '--out', 'backup']);

    assert.equal(result.code, 0, result.stderr);
    assert.equal(readJsonFile<unknown[]>(join(home.dir, 'backup', 'finding-history.json')).length, 1);
    assert.deepEqual(readJsonFile(join(home.dir, 'backup', 'finding-stages.json')), [
      { repo: 'demo', fingerprint: FP, at: 't1', run_id: 'run-1', from_stage: null, to_stage: 'validated', source: 'initial', note: null, actor: null },
    ]);
  });
});
