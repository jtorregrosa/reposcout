import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'vitest';
import { buildAgents } from '../src/claude/agents.js';
import { classify } from '../src/findings/classify.js';
import { anchorLine, FINGERPRINT_VERSION } from '../src/findings/fingerprint.js';
import { migrateFingerprints } from '../src/findings/migrate.js';
import { processFindings } from '../src/findings/process.js';
import { silentLogger } from '../src/telemetry/logger.js';
import { asFinding, state } from './fixtures.js';

const runAt = '2026-10-08T00:00:00.000Z';
const silent = silentLogger;

function clone(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), 'reposcout-spec-'));
  for (const [p, text] of Object.entries(files)) {
    mkdirSync(join(dir, p, '..'), { recursive: true });
    writeFileSync(join(dir, p), text);
  }
  return dir;
}

const candidate = (over = {}) =>
  asFinding({
    file: 'src/a.cs',
    line: 2,
    category: 'logic',
    severity: 'medium',
    confidence: 'high',
    verified: false,
    title: 'Wrong comparison in the total',
    description: 'The total uses >= where the rule says >.',
    scenario: 'An order of exactly 100 gets the discount.',
    suggested_fix: 'Use > instead of >=.',
    ...over,
  });

describe('line-anchored fingerprints', () => {
  const dir = clone({
    'src/a.cs': 'class A {\n  if (total >= limit) discount();\n}\n',
  });

  it('give the same fingerprint however the model quotes the line', () => {
    const raw = {
      findings: [
        candidate({ snippet: 'if (total >= limit)' }),
        candidate({
          snippet: 'if (total >= limit) discount();',
          title: 'Same bug, other words here',
        }),
      ],
    };
    const { accepted } = processFindings({
      raw,
      repoName: 'r',
      commit: 'c',
      cloneDir: dir,
      auditedFiles: ['src/a.cs'],
      log: silent,
    });
    assert.equal(accepted.length, 1);
  });

  it('widen a trivial line to its neighbours', () => {
    assert.equal(anchorLine('a\n}\nb', 2), 'a } b');
  });

  it('merge entries that version 1 recorded twice, keeping the earliest first sighting', () => {
    const state: Parameters<typeof migrateFingerprints>[0]['state'] = {
      findings: {
        old1: {
          status: 'open',
          first_seen: 't2',
          last_seen: 't3',
          finding: candidate({ fingerprint: 'old1', specialists: ['logic'] }),
        },
        old2: {
          status: 'open',
          first_seen: 't1',
          last_seen: 't2',
          finding: candidate({
            fingerprint: 'old2',
            specialists: ['security'],
          }),
        },
      },
    };
    const { state: next, merged } = migrateFingerprints({
      state,
      repoName: 'r',
      cloneDir: dir,
    });
    assert.equal(merged, 1);
    const entries = Object.values(next.findings);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].first_seen, 't1');
    assert.equal(entries[0].last_seen, 't3');
    assert.deepEqual(entries[0].finding.specialists.sort(), ['logic', 'security']);
    assert.equal(next.fingerprint_version, FINGERPRINT_VERSION);
  });
});

describe('speculative candidates', () => {
  const dir = clone({
    'src/a.cs': 'class A {\n  if (total >= limit) discount();\n}\n',
  });
  const process = (raw) =>
    processFindings({
      raw,
      repoName: 'r',
      commit: 'c',
      cloneDir: dir,
      auditedFiles: ['src/a.cs'],
      log: silent,
    });

  it('are kept apart from findings, never verified and never counted as open', () => {
    const { accepted, speculative } = process({
      findings: [],
      speculative: [
        candidate({
          verified: true,
          unconfirmed: 'how consumers configure it',
        }),
      ],
    });
    assert.equal(accepted.length, 0);
    assert.equal(speculative[0].verified, false);
    const { nextState, speculativeNew } = classify({
      findings: accepted,
      speculative,
      previous: null,
      auditedFiles: ['src/a.cs'],
      deletedFiles: [],
      reviews: [],
      runAt,
    });
    assert.equal(speculativeNew.length, 1);
    assert.equal(Object.values(nextState)[0].status, 'speculative');
  });

  it('become open, marked promoted, once a later run confirms them', () => {
    const { speculative } = process({
      findings: [],
      speculative: [candidate()],
    });
    const fp = speculative[0].fingerprint;
    const previous = state({
      [fp]: {
        status: 'speculative',
        first_seen: 't0',
        last_seen: 't0',
        finding: speculative[0],
      },
    });
    const { accepted } = process({ findings: [candidate()] });
    const { reported, nextState } = classify({
      findings: accepted,
      previous,
      auditedFiles: [],
      deletedFiles: [],
      reviews: [],
      runAt,
    });
    assert.equal(nextState[fp].status, 'open');
    assert.equal(reported[0].status, 'new');
    assert.equal(reported[0].promoted, true);
  });

  it('are refuted by a speculative review and not raised again', () => {
    const { speculative } = process({
      findings: [],
      speculative: [candidate()],
    });
    const fp = speculative[0].fingerprint;
    const previous = state({
      [fp]: {
        status: 'speculative',
        first_seen: 't0',
        last_seen: 't0',
        finding: speculative[0],
      },
    });
    const first = classify({
      findings: [],
      previous,
      auditedFiles: [],
      deletedFiles: [],
      reviews: [],
      speculativeReviews: [{ fingerprint: fp, verdict: 'refuted', reason: 'validator rejects it' }],
      runAt,
    });
    assert.equal(first.nextState[fp].status, 'refuted');
    assert.equal(first.refuted.length, 1);
    const again = classify({
      findings: [],
      speculative,
      previous: { findings: first.nextState },
      auditedFiles: ['src/a.cs'],
      deletedFiles: [],
      reviews: [],
      runAt,
    });
    assert.equal(again.nextState[fp].status, 'refuted');
    assert.equal(again.speculativeNew.length, 0);
  });

  it('stay speculative when not re-raised, instead of being resolved', () => {
    const { speculative } = process({
      findings: [],
      speculative: [candidate()],
    });
    const fp = speculative[0].fingerprint;
    const previous = state({
      [fp]: {
        status: 'speculative',
        first_seen: 't0',
        last_seen: 't0',
        finding: speculative[0],
      },
    });
    const { nextState, resolved } = classify({
      findings: [],
      previous,
      auditedFiles: ['src/a.cs'],
      deletedFiles: [],
      reviews: [],
      runAt,
      readByCategory: new Map([['logic', new Set(['src/a.cs'])]]),
    });
    assert.equal(nextState[fp].status, 'speculative');
    assert.equal(resolved.length, 0);
  });
});

describe('known findings confirmed by the verifier', () => {
  it('refresh last_seen and are counted as confirmed', () => {
    const previous = state({
      k: {
        status: 'open',
        first_seen: 't0',
        last_seen: 't0',
        finding: { file: 'src/a.cs', line: 1, category: 'logic', title: 't' },
      },
    });
    const { nextState, confirmed } = classify({
      findings: [],
      previous,
      auditedFiles: ['src/a.cs'],
      deletedFiles: [],
      reviews: [{ fingerprint: 'k', still_present: true, reason: 'unchanged' }],
      runAt,
    });
    assert.equal(nextState.k.last_seen, runAt);
    assert.deepEqual(confirmed, ['k']);
  });
});

describe('agents', () => {
  it('give the specialists no shell, and keep it for the verifier', () => {
    for (const name of ['security', 'concurrency', 'error-handling', 'logic', 'performance']) {
      const text = readFileSync(join('.claude', 'agents', `${name}.md`), 'utf8');
      assert.match(text, /^tools: Read, Grep, Glob$/m, name);
    }
    assert.match(readFileSync(join('.claude', 'agents', 'verifier.md'), 'utf8'), /^tools: .*Bash/m);
  });

  it('pass only the verifier in a speculative review', () => {
    const agents = buildAgents({
      rootDir: process.cwd(),
      models: { verifier: 'opus' },
      analyzers: [],
    });
    assert.deepEqual(Object.keys(agents), ['verifier']);
  });
});
