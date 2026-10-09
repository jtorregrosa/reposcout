import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'vitest';
import { goneFiles } from '../src/audit/plan.js';
import { classify, MISSES_TO_RESOLVE } from '../src/findings/classify.js';
import { anchorSnippet, fingerprint, locateSnippet } from '../src/findings/fingerprint.js';
import { processFindings, QUOTE_NOT_FOUND, validateFinding } from '../src/findings/process.js';
import type { Finding, FindingsState } from '../src/findings/types.js';
import { silentLogger } from '../src/telemetry/logger.js';
import { asFinding, state } from './fixtures.js';

const finding = (over = {}) =>
  asFinding({
    fingerprint: 'fp1',
    file: 'src/a.cs',
    line: 3,
    category: 'logic',
    severity: 'high',
    title: 'Wrong comparison',
    ...over,
  });

describe('fingerprint', () => {
  it('ignores whitespace differences and line numbers', () => {
    const a = fingerprint({
      repo: 'r',
      file: 'src/a.cs',
      category: 'logic',
      snippet: 'if (a  >  b)\n  return;',
    });
    const b = fingerprint({
      repo: 'r',
      file: 'src/a.cs',
      category: 'logic',
      snippet: ' if (a > b) return; ',
    });
    assert.equal(a, b);
  });

  it('changes when the repository, file or category changes', () => {
    const base = {
      repo: 'r',
      file: 'src/a.cs',
      category: 'logic',
      snippet: 'x = y;',
    };
    const fp = fingerprint(base);
    assert.notEqual(fp, fingerprint({ ...base, repo: 'q' }));
    assert.notEqual(fp, fingerprint({ ...base, file: 'src/b.cs' }));
    assert.notEqual(fp, fingerprint({ ...base, category: 'security' }));
  });
});

describe('anchorSnippet', () => {
  const text = 'line one\n  var total = price * qty;\n}\n';

  it('uses the model snippet when it occurs in the file', () => {
    assert.equal(anchorSnippet(text, 1, 'var total =   price * qty;'), 'var total = price * qty;');
  });

  it('falls back to the line in the file when the model snippet is not there', () => {
    assert.equal(anchorSnippet(text, 2, 'invented code'), 'var total = price * qty;');
  });

  it('widens to neighbouring lines when the line itself is trivial', () => {
    assert.equal(anchorSnippet(text, 3, ''), 'var total = price * qty; }');
  });
});

describe('validateFinding', () => {
  const valid = {
    file: 'src/a.cs',
    line: 4,
    category: 'security',
    severity: 'high',
    confidence: 'medium',
    verified: false,
    title: 'Token audience is not validated',
    description: 'ValidateAudience is false so tokens for other APIs are accepted.',
    scenario: 'A token minted for another API is replayed against /users and accepted.',
    suggested_fix: 'Set ValidateAudience = true and configure ValidAudience.',
  };
  const auditedSet = new Set(['src/a.cs']);

  it('accepts a finding with complete evidence', () => {
    assert.equal(validateFinding(valid, { auditedSet }), null);
  });

  it('rejects a finding without a scenario', () => {
    assert.match(validateFinding({ ...valid, scenario: '' }, { auditedSet }), /scenario/);
  });

  it('rejects a finding in a file that was not audited', () => {
    assert.match(validateFinding({ ...valid, file: 'src/other.cs' }, { auditedSet }), /audited set/);
  });

  it('rejects unknown severities', () => {
    assert.match(validateFinding({ ...valid, severity: 'blocker' }, { auditedSet }), /severity/);
  });
});

describe('classify', () => {
  const runAt = '2026-10-07T00:00:00.000Z';
  const open = (f, first = '2026-10-01T00:00:00.000Z') => ({
    status: 'open',
    first_seen: first,
    last_seen: first,
    finding: f,
  });

  it('marks unseen findings as new and repeated ones as existing', () => {
    const previous = state({ fp1: open(finding()) });
    const { reported } = classify({
      findings: [finding(), finding({ fingerprint: 'fp2' })],
      previous,
      auditedFiles: ['src/a.cs'],
      deletedFiles: [],
      reviews: [],
      runAt,
    });
    assert.deepEqual(
      reported.map((f) => [f.fingerprint, f.status]),
      [
        ['fp1', 'existing'],
        ['fp2', 'new'],
      ],
    );
    assert.equal(reported[0].first_seen, '2026-10-01T00:00:00.000Z');
  });

  const rerun = (previous: { findings: FindingsState }, over: Partial<Parameters<typeof classify>[0]> = {}) =>
    classify({ findings: [], previous, auditedFiles: ['src/a.cs'], deletedFiles: [], reviews: [], runAt, ...over });

  it(`resolves an open finding only after ${MISSES_TO_RESOLVE} re-audits in a row that did not report it`, () => {
    const first = rerun(state({ fp1: open(finding()) }));
    assert.equal(first.resolved.length, 0);
    assert.equal(first.nextState.fp1.status, 'open');
    assert.equal(first.nextState.fp1.missed_runs, 1);
    assert.deepEqual(first.missed, ['fp1']);
    const second = rerun({ findings: first.nextState });
    assert.equal(second.nextState.fp1.status, 'resolved');
    assert.match(second.resolved[0].resolution, /2 consecutive re-audits/);
    assert.equal(second.nextState.fp1.missed_runs, undefined);
  });

  it('resets the misses when the finding is seen again, so a flapping finding stays open', () => {
    const missedOnce = rerun(state({ fp1: open(finding()) })).nextState;
    const seen = rerun({ findings: missedOnce }, { findings: [finding()] }).nextState;
    assert.equal(seen.fp1.missed_runs, undefined);
    const missedAgain = rerun({ findings: seen }).nextState;
    assert.equal(missedAgain.fp1.status, 'open');
    assert.equal(missedAgain.fp1.missed_runs, 1);
    const confirmedByReview = rerun({ findings: missedAgain }, { reviews: [{ fingerprint: 'fp1', still_present: true }] }).nextState;
    assert.equal(confirmedByReview.fp1.missed_runs, undefined);
  });

  it('does not count a run whose specialist never opened the file as a miss', () => {
    const missedOnce = rerun(state({ fp1: open(finding()) })).nextState;
    const { nextState } = rerun({ findings: missedOnce }, { readByCategory: new Map([['logic', new Set<string>()]]) });
    assert.equal(nextState.fp1.status, 'open');
    assert.equal(nextState.fp1.missed_runs, 1);
  });

  it('resolves at once when the verifier reviews it as gone', () => {
    const { resolved, nextState } = rerun(state({ fp1: open(finding()) }), { reviews: [{ fingerprint: 'fp1', still_present: false, reason: 'guard added' }] });
    assert.equal(nextState.fp1.status, 'resolved');
    assert.equal(resolved[0].resolution, 'guard added');
  });

  it('keeps an open finding when the verifier says it is still present', () => {
    const previous = state({ fp1: open(finding()) });
    const { resolved, nextState } = classify({
      findings: [],
      previous,
      auditedFiles: ['src/a.cs'],
      deletedFiles: [],
      reviews: [{ fingerprint: 'fp1', still_present: true, reason: 'unchanged' }],
      runAt,
    });
    assert.equal(resolved.length, 0);
    assert.equal(nextState.fp1.status, 'open');
  });

  it('keeps an open finding whose file was not audited this run', () => {
    const previous = state({ fp1: open(finding()) });
    const { resolved, carried } = classify({
      findings: [],
      previous,
      auditedFiles: ['src/b.cs'],
      deletedFiles: [],
      reviews: [],
      runAt,
    });
    assert.equal(resolved.length, 0);
    assert.deepEqual(carried, ['fp1']);
  });

  it('resolves an open finding whose file was deleted', () => {
    const previous = state({ fp1: open(finding()) });
    const { resolved } = classify({
      findings: [],
      previous,
      auditedFiles: [],
      deletedFiles: ['src/a.cs'],
      reviews: [],
      runAt,
    });
    assert.equal(resolved[0].resolution, 'file deleted');
  });

  it('reports a previously resolved finding that reappears as new and reopened, keeping its first sighting', () => {
    const previous = state({ fp1: { ...open(finding()), status: 'resolved', resolved_at: 't1', resolution: 'fixed' } });
    const { reported, nextState } = classify({
      findings: [finding()],
      previous,
      auditedFiles: ['src/a.cs'],
      deletedFiles: [],
      reviews: [],
      runAt,
    });
    assert.equal(reported[0].status, 'new');
    assert.equal(reported[0].reopened, true);
    assert.equal(reported[0].first_seen, '2026-10-01T00:00:00.000Z');
    assert.deepEqual(nextState.fp1, { status: 'open', first_seen: '2026-10-01T00:00:00.000Z', last_seen: runAt, reopened_at: runAt, finding: finding() });
  });

  it('does not flag a first sighting as reopened', () => {
    const { reported } = rerun(state({}), { findings: [finding()] });
    assert.equal(reported[0].reopened, undefined);
    assert.equal(reported[0].first_seen, runAt);
  });
});

describe('suppression', () => {
  const runAt = '2026-10-07T00:00:00.000Z';
  const entry = (status: string, over = {}) => ({ status, first_seen: 't0', last_seen: 't0', finding: finding(), ...over });
  const run = (previous: { findings: FindingsState }, suppressed: Map<string, string>, findings: Finding[] = [], speculative: Finding[] = []) =>
    classify({ findings, speculative, previous, auditedFiles: [], deletedFiles: [], reviews: [], runAt, suppressed });
  const list = new Map([['fp1', 'not reachable']]);

  for (const status of ['speculative', 'resolved', 'open'] as const) {
    it(`returns a ${status} finding to ${status} when it leaves the suppression list`, () => {
      const suppressedState = run(state({ fp1: entry(status, status === 'resolved' ? { resolved_at: 't1', resolution: 'fixed' } : {}) }), list).nextState;
      assert.equal(suppressedState.fp1.status, 'suppressed');
      assert.equal(suppressedState.fp1.status_before_suppression, status);
      const again = run({ findings: suppressedState }, list).nextState;
      assert.equal(again.fp1.status_before_suppression, status, 'a run that keeps it suppressed keeps what it was');
      const back = run({ findings: again }, new Map()).nextState;
      assert.equal(back.fp1.status, status);
      assert.equal(back.fp1.status_before_suppression, undefined);
      assert.equal(back.fp1.reason, undefined);
      if (status === 'resolved') assert.equal(back.fp1.resolution, 'fixed');
    });
  }

  it('records what a finding reported while suppressed would have been', () => {
    assert.equal(run(state({}), list, [finding()]).nextState.fp1.status_before_suppression, 'open');
    assert.equal(run(state({}), list, [], [finding()]).nextState.fp1.status_before_suppression, 'speculative');
  });

  it('returns a suppression recorded before the status was kept to open', () => {
    const { nextState, carried } = run(state({ fp1: entry('suppressed', { reason: 'old' }) }), new Map());
    assert.equal(nextState.fp1.status, 'open');
    assert.deepEqual(carried, ['fp1']);
  });
});

describe('a finding an auditor refuted', () => {
  const runAt = '2026-10-07T00:00:00.000Z';
  const refuted = { status: 'refuted', first_seen: 't0', last_seen: 't0', refuted_at: 't1', resolution: 'Refuted by jorge: not a bug', finding: finding() };
  const run = (refutedByAuditor: Set<string>, findings: Finding[] = [], speculative: Finding[] = []) =>
    classify({
      findings,
      speculative,
      previous: state({ fp1: refuted }),
      auditedFiles: ['src/a.cs'],
      deletedFiles: [],
      reviews: [],
      runAt,
      refutedByAuditor,
      readByCategory: new Map([['logic', new Set(['src/a.cs'])]]),
    });

  it('stays refuted and unreported when the verifier confirms it again', () => {
    const { reported, nextState } = run(new Set(['fp1']), [finding()]);
    assert.deepEqual(reported, []);
    assert.equal(nextState.fp1.status, 'refuted');
    assert.equal(nextState.fp1.resolution, 'Refuted by jorge: not a bug');
    assert.equal(nextState.fp1.last_seen, runAt);
  });

  it('stays refuted when a run reproduces it', () => {
    const { reported, nextState } = run(new Set(['fp1']), [finding({ verified: true })]);
    assert.deepEqual(reported, []);
    assert.equal(nextState.fp1.status, 'refuted');
  });

  it('stays refuted when it is raised as speculative', () => {
    const { speculativeNew, nextState } = run(new Set(['fp1']), [], [finding()]);
    assert.deepEqual(speculativeNew, []);
    assert.equal(nextState.fp1.status, 'refuted');
  });

  it('opens again when only a speculative review or a candidate decision refuted it', () => {
    const { reported, nextState } = run(new Set(), [finding()]);
    assert.equal(reported[0]?.status, 'new');
    assert.equal(nextState.fp1.status, 'open');
  });
});

describe('locateSnippet', () => {
  const text = ['using System;', '', 'class A {', '  void Run() {', '    var total = price * qty;', '    Save(total);', '  }', '}'].join('\n');

  it('keeps the line when the quote is on it', () => {
    assert.deepEqual(locateSnippet(text, 5, 'var total = price * qty;'), { line: 5, quote: 'near' });
  });

  it('moves the line to the nearest occurrence of the quote within the window', () => {
    assert.deepEqual(locateSnippet(text, 2, '    var total =  price * qty;\n    Save(total);'), { line: 5, quote: 'near' });
    assert.deepEqual(locateSnippet(text, 8, '42: Save(total);'), { line: 6, quote: 'near' }, 'a copied line number is ignored');
  });

  it('keeps the line when the quote is in the file but far from it', () => {
    const far = `${text}\n${Array.from({ length: 10 }, (_, i) => `// filler ${i}`).join('\n')}\nreturn result;`;
    assert.deepEqual(locateSnippet(far, 1, 'return result;'), { line: 1, quote: 'far' });
  });

  it('reports a quote that is nowhere in the file', () => {
    assert.equal(locateSnippet(text, 5, 'var total = price + tax;').quote, 'absent');
  });

  it('does not judge a missing or trivial quote', () => {
    assert.equal(locateSnippet(text, 5, undefined).quote, 'unchecked');
    assert.equal(locateSnippet(text, 5, '}').quote, 'unchecked');
  });
});

describe('a full run and deleted files', () => {
  const entry = (status: string, file: string, fp: string) => ({ status, first_seen: 't0', last_seen: 't0', finding: finding({ fingerprint: fp, file }) });

  it('treats the files of open and speculative findings no longer in the tree as deleted', () => {
    const previous = state({
      gone: entry('open', 'src/gone.cs', 'gone'),
      spec: entry('speculative', 'src/old.cs', 'spec'),
      kept: entry('open', 'src/a.cs', 'kept'),
      closed: entry('resolved', 'src/older.cs', 'closed'),
    });
    const deleted = goneFiles(previous, new Set(['src/a.cs']));
    assert.deepEqual(deleted, ['src/gone.cs', 'src/old.cs']);
    const { resolved, nextState } = classify({ findings: [], previous, auditedFiles: [], deletedFiles: deleted, reviews: [], runAt: 't1' });
    assert.deepEqual(
      resolved.map((f) => [f.fingerprint, f.resolution]),
      [['gone', 'file deleted']],
    );
    assert.equal(nextState.spec, undefined, 'a speculative candidate in a deleted file is dropped, as in incremental mode');
    assert.equal(nextState.kept.status, 'open');
  });
});

describe('processFindings and the quoted code', () => {
  const source = ['namespace Demo;', 'class Cart {', '  int Total(int price, int qty) {', '    var total = price * qty;', '    return total;', '  }', '}'].join(
    '\n',
  );
  const cloneDir = mkdtempSync(join(tmpdir(), 'reposcout-process-'));
  mkdirSync(join(cloneDir, 'src'), { recursive: true });
  writeFileSync(join(cloneDir, 'src', 'a.cs'), source);
  const raw = (over = {}) => ({
    file: 'src/a.cs',
    line: 4,
    category: 'logic',
    severity: 'high',
    confidence: 'high',
    verified: true,
    title: 'Total overflows for large carts',
    description: 'price * qty is computed in int and overflows silently.',
    scenario: 'A cart with price 100000 and qty 30000 gets a negative total.',
    suggested_fix: 'Compute in long or checked arithmetic.',
    snippet: 'var total = price * qty;',
    ...over,
  });
  const recorder = () => {
    const warnings: { message: string; fields?: Record<string, unknown> }[] = [];
    return { warnings, log: { ...silentLogger, warn: (message: string, fields?: Record<string, unknown>) => warnings.push({ message, fields }) } };
  };
  const run = (findings: unknown[], speculative: unknown[] = [], log = silentLogger) =>
    processFindings({ raw: { findings, speculative }, repoName: 'demo', commit: 'abc', cloneDir, auditedFiles: ['src/a.cs'], log });

  it('re-anchors a finding a few lines off to the line it quotes, with that line’s fingerprint', () => {
    const exact = run([raw()]).accepted[0];
    const off = run([raw({ line: 2 })]).accepted[0];
    assert.equal(off.line, 4);
    assert.equal(off.fingerprint, exact.fingerprint);
  });

  it('keeps a finding whose quote is nowhere in the file as speculative, never open', () => {
    const { accepted, speculative } = run([raw({ snippet: 'var total = price + qty * tax;' })]);
    assert.equal(accepted.length, 0);
    assert.equal(speculative.length, 1);
    assert.equal(speculative[0].unconfirmed, QUOTE_NOT_FOUND);
    assert.equal(speculative[0].verified, false);
    assert.equal(speculative[0].snippet, 'var total = price * qty;', 'the snippet shows the real line');
  });

  it('warns when two distinct findings get the same fingerprint, and not for a repeat of the same one', () => {
    const { warnings, log } = recorder();
    const { accepted } = run([raw(), raw({ title: 'Total is not rounded' }), raw()], [], log);
    assert.equal(accepted.length, 1);
    const collisions = warnings.filter((w) => /same fingerprint/.test(w.message));
    assert.equal(collisions.length, 1);
    assert.deepEqual(collisions[0].fields?.dropped, { title: 'Total is not rounded', line: 4 });
  });
});
