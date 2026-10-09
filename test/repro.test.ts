import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'vitest';
import { parseRepro, processFindings } from '../src/findings/process.js';
import { silentLogger } from '../src/telemetry/logger.js';
import { buildHtmlReport, type ReportFinding } from '../web/src/lib/report/html.js';
import { buildMarkdownReport } from '../web/src/lib/report/markdown.js';

const repro = {
  preconditions: ['An account with any valid token'],
  steps: ['Send `GET /api/users` with `Referer: https://x/admin`', 'Read the response'],
  expected: 'Only the caller is listed.',
  actual: 'Every user account is listed.',
};

describe('parseRepro', () => {
  it('keeps well-formed steps', () => {
    assert.deepEqual(parseRepro(repro), repro);
  });

  it('drops a block without steps, or one that is not an object', () => {
    assert.equal(parseRepro({ preconditions: ['x'], steps: [] }), null);
    assert.equal(parseRepro('do this, then that'), null);
    assert.equal(parseRepro(null), null);
  });

  it('keeps only text, and caps how many steps it takes', () => {
    const r = parseRepro({ steps: ['one', 7, '', ...Array.from({ length: 20 }, (_, i) => `step ${i}`)], expected: 3 });
    assert.equal(r?.steps[0], 'one');
    assert.equal(r?.steps.length, 12);
    assert.equal(r?.expected, null);
    assert.deepEqual(r?.preconditions, []);
  });
});

describe('a finding with reproduction steps', () => {
  const clone = () => {
    const dir = mkdtempSync(join(tmpdir(), 'reposcout-repro-'));
    writeFileSync(join(dir, 'a.cs'), 'class A { void M() { Run(); } }\n');
    return dir;
  };
  const candidate = (over: object) => ({
    file: 'a.cs',
    line: 1,
    snippet: 'class A',
    category: 'logic',
    severity: 'low',
    confidence: 'high',
    verified: false,
    title: 'A finding title',
    description: 'A description long enough.',
    scenario: 'A scenario long enough.',
    suggested_fix: 'A fix long enough.',
    ...over,
  });

  it('carries them into the accepted finding', () => {
    const { accepted } = processFindings({
      raw: { findings: [candidate({ repro })] },
      repoName: 'r',
      commit: 'c',
      cloneDir: clone(),
      auditedFiles: ['a.cs'],
      log: silentLogger,
    });
    assert.deepEqual(accepted[0]?.repro, repro);
  });

  it('is kept without them when they are malformed', () => {
    const { accepted, rejected } = processFindings({
      raw: { findings: [candidate({ repro: 'just do it' })] },
      repoName: 'r',
      commit: 'c',
      cloneDir: clone(),
      auditedFiles: ['a.cs'],
      log: silentLogger,
    });
    assert.equal(accepted.length, 1);
    assert.equal(accepted[0]?.repro, undefined);
    assert.equal(rejected.length, 0);
  });
});

describe('reports', () => {
  const finding: ReportFinding = {
    fingerprint: 'f'.repeat(32),
    repo: 'demo',
    file: 'src/a.cs',
    line: 3,
    category: 'security',
    severity: 'high',
    confidence: 'high',
    verified: false,
    status: 'open',
    title: 'Title',
    description: 'Description.',
    scenario: 'Scenario.',
    suggested_fix: 'Fix.',
    first_seen: '2026-10-07T00:00:00.000Z',
    repro,
  };

  it('lists the steps in order in the HTML report, with code formatted and escaped', () => {
    const html = buildHtmlReport([finding], { scope: 'all' });
    assert.match(html, /How to reproduce/);
    assert.ok(html.indexOf('GET /api/users') < html.indexOf('Read the response'));
    assert.match(html, /<code>GET \/api\/users<\/code>/);
    assert.match(html, /Every user account is listed/);
  });

  it('numbers the steps in the Markdown report', () => {
    const md = buildMarkdownReport([finding], 'all');
    assert.match(md, /1\. Send `GET \/api\/users`/);
    assert.match(md, /2\. Read the response/);
    assert.match(md, /\*\*Actual:\*\* Every user account is listed\./);
  });
});
