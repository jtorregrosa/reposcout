import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { buildMarkdownReport } from './markdown';
import { buildReportModel, paragraphs, type ReportFinding } from './model';

const finding = (over: Partial<ReportFinding>): ReportFinding => ({
  fingerprint: 'f'.repeat(32),
  repo: 'demo',
  file: 'src/a.cs',
  line: 3,
  category: 'logic',
  severity: 'low',
  confidence: 'high',
  verified: false,
  status: 'open',
  title: 'Title',
  description: 'Description of the defect.',
  scenario: 'A scenario that triggers it.',
  suggested_fix: 'The smallest fix.',
  first_seen: '2026-10-07T00:00:00.000Z',
  ...over,
});

describe('paragraphs', () => {
  it('splits long prose at sentence ends into readable paragraphs', () => {
    const sentence = 'The handler reads the header the client controls and trusts it as an authorization decision without checking anything else.';
    const text = Array.from({ length: 6 }, () => sentence).join(' ');
    const out = paragraphs(text);
    assert.ok(out.length > 1);
    assert.equal(out.join(' '), text, 'no text is lost or reordered');
  });

  it('never splits inside a file name or a version number', () => {
    assert.deepEqual(paragraphs('See bearer.strategy.ts:28 and v1.2.3 for details.'), ['See bearer.strategy.ts:28 and v1.2.3 for details.']);
  });

  it('keeps short prose as one paragraph and ignores empty text', () => {
    assert.deepEqual(paragraphs('One sentence. Another one.'), ['One sentence. Another one.']);
    assert.deepEqual(paragraphs(null), []);
  });
});

describe('report model', () => {
  it('titles the report after its repository, or counts them', () => {
    assert.equal(buildReportModel([finding({})], { scope: 's' }).title, 'demo');
    assert.equal(buildReportModel([finding({}), finding({ repo: 'other' })], { scope: 's' }).title, '2 repositories');
  });

  it('adds a per-repository table only when there is more than one repository', () => {
    assert.equal(buildReportModel([finding({})], { scope: 's' }).perRepo.length, 0);
    assert.equal(buildReportModel([finding({}), finding({ repo: 'other' })], { scope: 's' }).perRepo.length, 2);
  });
});

describe('Markdown report', () => {
  it('fences quoted code so backticks inside it cannot end the block early', () => {
    const md = buildMarkdownReport([finding({ snippet: 'const s = ```not a fence```;' })], 'all');
    assert.match(md, /````\nconst s = ```not a fence```;\n````/);
  });

  it('escapes pipes in table cells', () => {
    const md = buildMarkdownReport([finding({ title: 'a | b' })], 'all');
    assert.ok(md.includes('a \\| b'));
  });
});
