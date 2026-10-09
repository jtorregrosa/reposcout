import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'vitest';
import type { Analyzer } from '../src/config/analyzers.js';
import { selectFiles } from '../src/selection/select.js';
import { auditsByAnalyzer, lastAuditedFor, recordAudits } from '../src/state/coverage.js';

function repoWith(paths) {
  const dir = mkdtempSync(join(tmpdir(), 'reposcout-sel-'));
  for (const p of paths) {
    mkdirSync(join(dir, p, '..'), { recursive: true });
    writeFileSync(join(dir, p), 'class X {}\n');
  }
  return dir;
}

const focus = Array.from({ length: 5 }, (_, i) => `src/auth/F${i}.cs`);
const rest = Array.from({ length: 10 }, (_, i) => `src/other/R${i}.cs`);
const analyzers: Analyzer[] = ['security', 'concurrency', 'error-handling', 'logic'];

describe('full-mode rotation', () => {
  it('reaches the whole repository when the focus paths alone fill the cap', () => {
    const cloneDir = repoWith([...focus, ...rest]);
    const candidates = [...focus, ...rest].map((path) => ({
      path,
      status: 'tracked',
    }));
    let audits = auditsByAnalyzer(null);
    const runs = [];
    for (let run = 0; run < 3; run++) {
      const { selected } = selectFiles({
        cloneDir,
        candidates,
        excluded: [],
        focusPaths: ['src/auth/**'],
        maxFiles: 5,
        maxBytes: 100000,
        lastAudited: lastAuditedFor(audits, analyzers),
        order: 'coverage',
      });
      const files = selected.map((f) => f.path);
      runs.push(files);
      audits = recordAudits(audits, {
        files: Object.fromEntries(analyzers.map((a) => [a, files])),
        deleted: [],
        runAt: `2026-10-07T0${run}:00:00.000Z`,
      });
    }
    assert.deepEqual(runs[0].sort(), [...focus].sort(), 'the first run still starts with the focus paths');
    assert.equal(new Set(runs.flat()).size, 15, `three runs of five must cover all fifteen files, got ${JSON.stringify(runs)}`);
  });

  it('keeps priority order for incremental runs, where every changed file matters', () => {
    const cloneDir = repoWith(['src/auth/A.cs', 'src/other/B.cs']);
    const { selected } = selectFiles({
      cloneDir,
      candidates: [
        { path: 'src/other/B.cs', status: 'M' },
        { path: 'src/auth/A.cs', status: 'M' },
      ],
      excluded: [],
      focusPaths: ['src/auth/**'],
      maxFiles: 1,
      maxBytes: 100000,
      lastAudited: { 'src/auth/A.cs': '2026-10-07T00:00:00.000Z' },
      order: 'priority',
    });
    assert.deepEqual(
      selected.map((f) => f.path),
      ['src/auth/A.cs'],
    );
  });
});
