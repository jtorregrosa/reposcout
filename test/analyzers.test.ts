import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { buildAgents } from '../src/claude/agents.js';
import { parseAnalyzers } from '../src/config/analyzers.js';
import { classify } from '../src/findings/classify.js';
import { auditedByAnalyzer, auditsByAnalyzer, fullyAudited, lastAuditedFor, recordAudits, unreadOnceByAnalyzer } from '../src/state/coverage.js';
import { asEntry, state } from './fixtures.js';

const runAt = '2026-10-07T12:00:00.000Z';
const open = (fp, category, file = 'src/a.cs') =>
  asEntry({
    status: 'open',
    first_seen: 't0',
    last_seen: 't0',
    finding: {
      fingerprint: fp,
      file,
      line: 1,
      category,
      severity: 'low',
      title: 't',
    },
  });

describe('parseAnalyzers', () => {
  it('accepts a comma list or an array and returns them in canonical order', () => {
    assert.deepEqual(parseAnalyzers('logic, security'), ['security', 'logic']);
    assert.deepEqual(parseAnalyzers(['error-handling']), ['error-handling']);
  });

  it('rejects an empty selection and unknown names', () => {
    assert.throws(() => parseAnalyzers([]), /at least one/);
    assert.throws(() => parseAnalyzers('security,style'), /unknown analyzer "style"/);
  });
});

describe('classify with a subset of analyzers', () => {
  it('never resolves a finding whose analyzer did not run, even when its file was re-audited', () => {
    const previous = state({ s: open('s', 'security'), l: open('l', 'logic') });
    const { missed, nextState } = classify({
      findings: [],
      previous,
      auditedFiles: ['src/a.cs'],
      deletedFiles: [],
      reviews: [],
      runAt,
      auditedCategories: ['security'],
    });
    assert.deepEqual(missed, ['s']);
    assert.equal(nextState.l.status, 'open');
    assert.equal(nextState.l.missed_runs, undefined);
  });

  it('does not resolve a finding whose specialist never opened the file, unless the verifier reviewed it', () => {
    const previous = state({
      l: open('l', 'logic'),
      s: open('s', 'security'),
      v: open('v', 'logic', 'src/b.cs'),
    });
    const readByCategory = new Map([
      ['security', new Set(['src/a.cs'])],
      ['logic', new Set<string>()],
    ]);
    const { resolved, missed, nextState } = classify({
      findings: [],
      previous,
      auditedFiles: ['src/a.cs', 'src/b.cs'],
      deletedFiles: [],
      reviews: [{ fingerprint: 'v', still_present: false, reason: 'fixed' }],
      runAt,
      readByCategory,
    });
    assert.deepEqual(
      resolved.map((f) => f.fingerprint),
      ['v'],
    );
    assert.deepEqual(missed, ['s'], 'security read the file and did not report it: one miss');
    assert.equal(nextState.l.status, 'open');
    assert.equal(nextState.l.missed_runs, undefined, 'logic never opened the file, so it is not a miss');
  });

  it('still resolves any category when the file was deleted', () => {
    const previous = state({ l: open('l', 'logic') });
    const { resolved } = classify({
      findings: [],
      previous,
      auditedFiles: [],
      deletedFiles: ['src/a.cs'],
      reviews: [],
      runAt,
      auditedCategories: ['security'],
    });
    assert.equal(resolved.length, 1);
  });
});

describe('per-analyzer audit history', () => {
  it('treats the older single map as covering every analyzer', () => {
    const by = auditsByAnalyzer({ file_audits: { 'a.cs': 't1' } });
    assert.equal(by.logic['a.cs'], 't1');
    assert.equal(fullyAudited(by), 1);
  });

  it('records a run only for the analyzers that ran', () => {
    const by = recordAudits(auditsByAnalyzer(null), {
      files: { security: ['a.cs'] },
      deleted: [],
      runAt,
    });
    assert.equal(by.security['a.cs'], runAt);
    assert.equal(by.logic['a.cs'], undefined);
    assert.equal(fullyAudited(by), 0);
  });

  it('ranks a file one selected analyzer never saw ahead of everything else', () => {
    const by = recordAudits(auditsByAnalyzer(null), {
      files: { security: ['a.cs'] },
      deleted: [],
      runAt,
    });
    assert.equal(lastAuditedFor(by, ['security'])['a.cs'], runAt);
    assert.equal(lastAuditedFor(by, ['security', 'logic'])['a.cs'], '');
  });

  it('forgets deleted files for every analyzer', () => {
    const by = recordAudits(auditsByAnalyzer({ file_audits: { 'a.cs': 't1' } }), { files: {}, deleted: ['a.cs'], runAt });
    assert.equal(fullyAudited(by), 0);
    assert.equal(by.security['a.cs'], undefined);
  });

  it('forgets files a full run no longer lists as auditable, such as a newly excluded stylesheet', () => {
    const prior = auditsByAnalyzer({
      file_audits: { 'a.cs': 't1', 'site.css': 't1' },
    });
    const by = recordAudits(prior, {
      files: {},
      deleted: [],
      runAt,
      eligible: ['a.cs'],
    });
    assert.equal(by.security['site.css'], undefined);
    assert.equal(by.security['a.cs'], 't1');
    assert.equal(fullyAudited(by), 1);
  });
});

describe('what each analyzer audited in a run', () => {
  const selected = ['a.cs', 'b.cs'];

  it('stamps a file only for the analyzers whose specialists opened it, whoever else did', () => {
    // Only logic opened a.cs; the verifier's reads never reach this map.
    const readBy = new Map([['logic', new Set(['a.cs'])]]);
    const { audited, unreadOnce } = auditedByAnalyzer({ analyzers: ['security', 'logic'], selected, readBy, unreadBefore: {} });
    assert.deepEqual(audited, { security: [], logic: ['a.cs'] });
    assert.deepEqual(unreadOnce, { security: ['a.cs', 'b.cs'], logic: ['b.cs'] });
    const by = recordAudits(auditsByAnalyzer(null), { files: audited, deleted: [], runAt });
    assert.equal(by.security['a.cs'], undefined, 'the full-mode rotation sends a.cs back to security');
    assert.equal(lastAuditedFor(by, ['security', 'logic'])['a.cs'], '');
  });

  it('records a file an analyzer left unread twice in a row, for that analyzer only', () => {
    const readBy = new Map([['logic', new Set(['a.cs', 'b.cs'])]]);
    const { audited, unreadOnce } = auditedByAnalyzer({
      analyzers: ['security', 'logic'],
      selected,
      readBy,
      unreadBefore: { security: ['a.cs'], logic: ['a.cs'] },
    });
    assert.deepEqual(audited, { security: ['a.cs'], logic: ['a.cs', 'b.cs'] });
    assert.deepEqual(unreadOnce, { security: ['b.cs'] });
  });

  it('keeps the list of an analyzer that did not run, and reads the older single list as every analyzer’s', () => {
    const before = unreadOnceByAnalyzer({ unread_once: ['a.cs'] });
    assert.deepEqual(before.performance, ['a.cs']);
    const { unreadOnce } = auditedByAnalyzer({ analyzers: ['logic'], selected: ['a.cs'], readBy: new Map(), unreadBefore: before });
    assert.deepEqual(unreadOnce.performance, ['a.cs']);
    assert.equal(unreadOnce.logic, undefined, 'logic left it unread a second time, so it is recorded and leaves the list');
  });
});

describe('buildAgents with a subset', () => {
  it('passes only the selected specialists and always the verifier', () => {
    const agents = buildAgents({
      rootDir: process.cwd(),
      models: { specialists: 'sonnet', verifier: 'opus' },
      analyzers: ['security', 'logic'],
    });
    assert.deepEqual(Object.keys(agents).sort(), ['logic', 'security', 'verifier']);
  });
});
