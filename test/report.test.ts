import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { buildHtmlReport, type ReportFinding } from '../web/src/lib/report/html.js';
import { buildMarkdownReport } from '../web/src/lib/report/markdown.js';

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

describe('buildHtmlReport', () => {
  it('escapes every piece of finding text, which quotes audited code', () => {
    const html = buildHtmlReport(
      [
        finding({
          title: '<script>alert(1)</script>',
          snippet: '<img src=x onerror=alert(1)>',
          file: 'src/"a".cs',
        }),
      ],
      { scope: 'all' },
    );
    assert.ok(!html.includes('<script>alert(1)'));
    assert.ok(!html.includes('<img src=x'));
    assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  });

  const mixed = () => [
    finding({ category: 'logic', severity: 'low', title: 'L-low' }),
    finding({ category: 'logic', severity: 'high', title: 'L-high' }),
    finding({ category: 'security', severity: 'medium', title: 'S-medium' }),
  ];

  it('groups findings by type, most severe first inside each type, and numbers them in that order', () => {
    const html = buildHtmlReport(mixed(), { scope: 'all' });
    const details = html.slice(html.indexOf('<section class="type"'));
    const at = (s: string) => details.indexOf(s);
    assert.ok(at('id="type-security"') < at('id="type-logic"'), 'types in their fixed order');
    assert.ok(at('S-medium') < at('L-high'), 'a medium security finding comes before a high logic one');
    assert.ok(at('id="type-logic-high"') < at('L-high') && at('L-high') < at('id="type-logic-low"'));
    assert.ok(at('L-high') < at('L-low'));
    assert.ok(at('id="f-01"') < at('S-medium') && at('S-medium') < at('id="f-02"'));
  });

  it('links the summary to every type section and to each type at each severity', () => {
    const html = buildHtmlReport(mixed(), { scope: 'all' });
    const summary = html.slice(html.indexOf('id="summary"'), html.indexOf('id="index"'));
    assert.match(summary, /href="#type-security"/);
    assert.match(summary, /href="#type-logic-high">1</);
    assert.match(summary, /href="#type-logic-low">1</);
  });

  it('has a target for every link it contains', () => {
    const html = buildHtmlReport(mixed(), { scope: 'all' });
    const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
    const targets = [...html.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);
    assert.ok(targets.length > 10);
    assert.deepEqual(
      targets.filter((t) => !ids.has(t)),
      [],
    );
  });

  it('lists every finding in the index, linked to its details', () => {
    const html = buildHtmlReport([finding({ title: 'One' }), finding({ title: 'Two', severity: 'high' })], { scope: 'all' });
    const index = html.slice(html.indexOf('id="index"'), html.indexOf('<section class="type"'));
    assert.match(index, /href="#f-01">F-01/);
    assert.match(index, /href="#f-02">F-02/);
  });

  it('formats code spans in the prose without letting them carry markup', () => {
    const html = buildHtmlReport([finding({ description: 'It calls `payload.find()` and `<img onerror=x>` here.' })], { scope: 'all' });
    assert.ok(html.includes('<code>payload.find()</code>'));
    assert.ok(html.includes('<code>&lt;img onerror=x&gt;</code>'));
    assert.ok(!html.includes('<img onerror'));
  });

  it('is self-contained: no external scripts, stylesheets or fonts', () => {
    const html = buildHtmlReport([finding({})], { scope: 'all' });
    assert.ok(!/<script\b/i.test(html));
    assert.ok(!/<link\b/i.test(html));
    assert.ok(!/https?:\/\//.test(html));
  });
});

describe('buildMarkdownReport', () => {
  it('has a target for every link it contains, as the Azure DevOps and GitHub renderers need', () => {
    const md = buildMarkdownReport([finding({ category: 'security', severity: 'high', title: 'A' }), finding({ category: 'logic', title: 'B' })], 'all');
    const ids = new Set([...md.matchAll(/<a id="([^"]+)"><\/a>/g)].map((m) => m[1]));
    const targets = [...md.matchAll(/\]\(#([^)]+)\)/g)].map((m) => m[1]);
    assert.ok(targets.includes('type-security-high'));
    assert.deepEqual(
      targets.filter((t) => !ids.has(t)),
      [],
    );
  });
});

describe('the type of each finding in a report', () => {
  const findings = [
    finding({ fingerprint: 'a'.repeat(32), kind: 'vulnerability', personal_data: true }),
    finding({ fingerprint: 'b'.repeat(32), kind: 'chore' }),
    finding({ fingerprint: 'c'.repeat(32) }),
  ];

  it('is counted in the summary and shown on every finding', () => {
    const html = buildHtmlReport(findings, { scope: 'all' });
    assert.match(html, /<span class="tag vulnerability">Vulnerability <b>1<\/b><\/span>/);
    assert.match(html, /<span class="tag">Not classified <b>1<\/b><\/span>/);
    assert.match(html, /<span class="tag personal">Personal data <b>1<\/b><\/span>/);
    assert.match(html, /<dt>Type<\/dt><dd>Chore<\/dd>/);
    assert.match(html, /<dt>Category<\/dt><dd>Logic<\/dd>/);
  });

  it('appears in the Markdown summary, index and details', () => {
    const md = buildMarkdownReport(findings, 'all');
    assert.match(md, /\*\*Type:\*\* Vulnerability 1 · Chore 1 · Not classified 1 · personal data 1/);
    assert.match(md, /\| Vulnerability, personal data \| Title \|/);
    assert.match(md, /\| Type \| Chore \|/);
    assert.match(md, /\| Personal data \| Yes \|/);
  });
});
