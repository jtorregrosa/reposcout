import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'vitest';
import type { EvalResult } from '../../eval/score.js';
import { fakeEnv, PACKAGE_DIR } from './harness.js';

// The evaluation harness's plumbing, with the fake claude standing in: corpus to git repository, CLI run, report,
// score and result files. The real evaluation spends subscription usage and is never run by the tests.
describe('e2e: eval harness', { timeout: 60_000 }, () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));

  const run = (args: string[]) =>
    new Promise<{ code: number | null; stdout: string }>((resolvePromise, reject) => {
      const env = fakeEnv({ scenarioFile: join(dir, 'scenario.json'), callLog: join(dir, 'calls.jsonl') });
      const child = spawn(process.execPath, ['--import', 'tsx', join(PACKAGE_DIR, 'eval', 'run.ts'), ...args], { cwd: PACKAGE_DIR, env, windowsHide: true });
      let stdout = '';
      const collect = (d: string) => {
        stdout += d;
      };
      child.stdout.setEncoding('utf8').on('data', collect);
      child.stderr.setEncoding('utf8').on('data', collect);
      child.on('error', reject);
      child.on('close', (code) => resolvePromise({ code, stdout }));
    });

  it('only estimates without --yes', async () => {
    dir = mkdtempSync(join(tmpdir(), 'reposcout-eval-'));
    const out = await run(['--case', 'orders-api', '--out', dir]);
    assert.equal(out.code, 1);
    assert.match(out.stdout, /orders-api: \d+ files/);
    assert.match(out.stdout, /--yes/);
    assert.deepEqual(readdirSync(dir), []);
  });

  it('audits a corpus case through the CLI and scores the report against its truth', async () => {
    dir = mkdtempSync(join(tmpdir(), 'reposcout-eval-'));
    writeFileSync(
      join(dir, 'scenario.json'),
      JSON.stringify({
        default: {
          findings: [
            { file: 'src/routes/users.ts', line: 14, category: 'security', snippet: 'SELECT id, name, email FROM users WHERE name LIKE' },
            { file: 'src/routes/orders.ts', line: 24, category: 'logic', snippet: 'const offset = page * PAGE_SIZE;' },
            { file: 'src/lib/format.ts', line: 3, category: 'logic', snippet: 'const abs = Math.abs(Math.trunc(cents));' },
          ],
        },
      }),
    );
    const out = await run(['--yes', '--case', 'orders-api', '--analyzers', 'security,logic', '--out', dir]);
    assert.equal(out.code, 0, out.stdout);
    const files = readdirSync(dir).filter((f) => /^\d{4}-.*\.(json|md)$/.test(f));
    assert.equal(files.length, 2);
    const result = JSON.parse(readFileSync(join(dir, files.find((f) => f.endsWith('.json')) as string), 'utf8')) as EvalResult;
    assert.match(result.prompt_version, /^[0-9a-f]{12}$/);
    assert.deepEqual(result.analyzers, ['security', 'logic']);
    const score = result.cases[0]?.score;
    assert.deepEqual(score?.found, ['OA-01', 'OA-03']);
    // Only the security and logic bugs were in scope.
    assert.equal(score?.bugs, 4);
    assert.deepEqual(
      score?.false_positives.map((f) => [f.file, f.control]),
      [['src/lib/format.ts', true]],
    );
    assert.equal(result.cases[0]?.usage?.cost_usd, 0.42);
    assert.match(readFileSync(join(dir, files.find((f) => f.endsWith('.md')) as string), 'utf8'), /\| orders-api \| 50% \| 67% \|/);
  });
});
