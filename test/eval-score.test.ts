import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'vitest';
import {
  type CaseResult,
  compare,
  type EvalResult,
  parseTruth,
  promptVersion,
  RESULT_SCHEMA,
  type ScoredFinding,
  scoreCase,
  toMarkdown,
  totals,
} from '../eval/score.js';
import { ANALYZERS, type Analyzer } from '../src/config/analyzers.js';

const truth = parseTruth(`
case: demo
clean_files: [src/clean.ts]
bugs:
  - { id: S1, file: src/api.ts, lines: [10, 12], category: security, severity: high, description: injection }
  - { id: L1, file: src/api.ts, lines: [30, 30], category: logic, severity: medium, description: off by one }
  - { id: C1, file: src/cache.ts, lines: [[5, 5], [20, 22]], category: concurrency, severity: high, description: unlocked map }
  - { id: P1, file: src/cache.ts, lines: [40, 41], category: performance, severity: low, description: unbounded }
`);

const f = (file: string, line: number, category: Analyzer, title = `${category} at ${file}:${line}`): ScoredFinding => ({ file, line, category, title });
const all = [...ANALYZERS];

describe('eval scoring', () => {
  it('matches by file, category and a line within the range widened by 3', () => {
    const score = scoreCase({ truth, findings: [f('src/api.ts', 15, 'security'), f('src/api.ts', 34, 'logic')], analyzers: all, lines: 500 });
    assert.deepEqual(score.found, ['S1']);
    assert.deepEqual(
      score.false_positives.map((x) => x.line),
      [34],
    );
    assert.deepEqual(score.missed, ['L1', 'C1', 'P1']);
    assert.equal(score.recall, 1 / 4);
    assert.equal(score.precision, 1 / 2);
    assert.equal(score.fp_per_kloc, 2);
  });

  it('matches any range of a bug with several', () => {
    const score = scoreCase({ truth, findings: [f('src/cache.ts', 6, 'concurrency')], analyzers: all, lines: 100 });
    assert.deepEqual(score.found, ['C1']);
    assert.deepEqual(scoreCase({ truth, findings: [f('src/cache.ts', 23, 'concurrency')], analyzers: all, lines: 100 }).found, ['C1']);
    assert.deepEqual(scoreCase({ truth, findings: [f('src/cache.ts', 13, 'concurrency')], analyzers: all, lines: 100 }).found, []);
  });

  it('counts a finding of another category on a seeded bug as cross-category, not as a false positive', () => {
    const score = scoreCase({ truth, findings: [f('src/cache.ts', 40, 'security')], analyzers: all, lines: 100 });
    assert.deepEqual(score.found, []);
    assert.deepEqual(score.cross_category, ['P1']);
    assert.equal(score.false_positives.length, 0);
    assert.equal(score.precision, 1);
  });

  it('drops a cross-category match once the right category found the bug too, and counts a second hit as a duplicate', () => {
    const score = scoreCase({
      truth,
      findings: [f('src/cache.ts', 40, 'security'), f('src/cache.ts', 41, 'performance'), f('src/cache.ts', 42, 'performance')],
      analyzers: all,
      lines: 100,
    });
    assert.deepEqual(score.found, ['P1']);
    assert.deepEqual(score.cross_category, []);
    assert.equal(score.duplicates, 1);
    assert.equal(score.precision, 1);
  });

  it('marks false positives in clean control files', () => {
    const score = scoreCase({ truth, findings: [f('src/clean.ts', 3, 'logic'), f('src/api.ts', 50, 'logic')], analyzers: all, lines: 100 });
    assert.deepEqual(
      score.false_positives.map((x) => [x.file, x.control]),
      [
        ['src/clean.ts', true],
        ['src/api.ts', false],
      ],
    );
  });

  it('counts speculative candidates only as hits on bugs no finding caught, never as false positives', () => {
    const score = scoreCase({
      truth,
      findings: [f('src/api.ts', 11, 'security')],
      speculative: [f('src/api.ts', 11, 'security'), f('src/api.ts', 30, 'logic'), f('src/clean.ts', 1, 'logic')],
      analyzers: all,
      lines: 100,
    });
    assert.deepEqual(score.speculative_hits, ['L1']);
    assert.equal(score.false_positives.length, 0);
    assert.deepEqual(score.missed, ['L1', 'C1', 'P1']);
  });

  it('computes recall over the analyzers that ran only', () => {
    const score = scoreCase({ truth, findings: [f('src/api.ts', 10, 'security')], analyzers: ['security', 'logic'], lines: 100 });
    assert.equal(score.bugs, 2);
    assert.equal(score.recall, 1 / 2);
    assert.deepEqual(score.recall_by_analyzer, { security: { found: 1, total: 1, recall: 1 }, logic: { found: 0, total: 1, recall: 0 } });
  });

  it('has no recall or precision without bugs or findings', () => {
    const score = scoreCase({ truth: { ...truth, bugs: [] }, findings: [], analyzers: all, lines: 0 });
    assert.equal(score.recall, null);
    assert.equal(score.precision, null);
    assert.equal(score.fp_per_kloc, null);
  });

  it('rejects a truth file with an unknown category or an inverted range', () => {
    assert.throws(() => parseTruth('case: x\nbugs: [{ id: a, file: f, lines: [1, 2], category: style, severity: low, description: d }]'), /bugs\.0\.category/);
    assert.throws(() => parseTruth('case: x\nbugs: [{ id: a, file: f, lines: [5, 2], category: logic, severity: low, description: d }]'), /bugs\.0\.lines/);
  });
});

describe('eval results', () => {
  const caseResult = (findings: ScoredFinding[], cost: number): CaseResult => ({
    case: 'demo',
    score: scoreCase({ truth, findings, analyzers: all, lines: 1000 }),
    usage: { cost_usd: cost, wall_s: 60, turns: 10, input_tokens: 1, output_tokens: 1, five_hour: 0.03, seven_day: 0.01 },
  });
  const result = (cases: CaseResult[], at: string): EvalResult => ({
    schema: RESULT_SCHEMA,
    at,
    prompt_version: 'abcdef012345',
    models: { orchestrator: 'sonnet' },
    analyzers: all,
    cases,
    totals: totals(cases),
  });

  it('adds up the cases', () => {
    const t = totals([
      caseResult([f('src/api.ts', 10, 'security')], 1),
      caseResult([f('src/clean.ts', 1, 'logic')], 2),
      { case: 'x', score: null, usage: null },
    ]);
    assert.equal(t.bugs, 8);
    assert.equal(t.found, 1);
    assert.equal(t.recall, 1 / 8);
    assert.equal(t.precision, 1 / 2);
    assert.equal(t.false_positives, 1);
    assert.equal(t.control_false_positives, 1);
    assert.equal(t.fp_per_kloc, 0.5);
    assert.equal(t.cost_usd, 3);
    assert.equal(t.five_hour, 0.06);
    assert.deepEqual(t.recall_by_analyzer.security, { found: 1, total: 2, recall: 0.5 });
  });

  it('compares with the previous result metric by metric', () => {
    const before = result([caseResult([f('src/api.ts', 10, 'security'), f('src/clean.ts', 1, 'logic')], 2)], '2026-01-01');
    const after = result([caseResult([f('src/api.ts', 10, 'security'), f('src/api.ts', 30, 'logic')], 1)], '2026-02-01');
    const deltas = Object.fromEntries(compare(before, after).map((d) => [d.metric, d]));
    assert.equal(deltas.recall?.delta, 1 / 4);
    assert.equal(deltas.recall?.better, true);
    assert.equal(deltas.fp_per_kloc?.delta, -1);
    assert.equal(deltas.fp_per_kloc?.better, true);
    assert.equal(deltas.cost_usd?.better, true);
    assert.equal(deltas['recall.security']?.better, null);
    const md = toMarkdown(after, before);
    assert.match(md, /\| demo \| 50% \| 100% \| 2\/4 \|/);
    assert.match(md, /\| recall \| 25% \| 50% \| \+25 pts \(better\) \|/);
  });

  it('identifies the prompts by a hash that ignores order and line endings', () => {
    const a = promptVersion([
      { path: '.claude/agents/logic.md', text: 'one\ntwo\n' },
      { path: '.claude/skills/audit/SKILL.md', text: 'skill\n' },
    ]);
    const b = promptVersion([
      { path: '.claude/skills/audit/SKILL.md', text: 'skill\r\n' },
      { path: '.claude/agents/logic.md', text: 'one\r\ntwo\r\n' },
    ]);
    assert.match(a, /^[0-9a-f]{12}$/);
    assert.equal(a, b);
    assert.notEqual(a, promptVersion([{ path: '.claude/agents/logic.md', text: 'one\ntwo!\n' }]));
  });
});

// The corpus itself: every seeded bug points at real lines, and the cases together cover every category.
describe('eval corpus', () => {
  const corpus = join(import.meta.dirname, '..', 'eval', 'corpus');
  const cases = readdirSync(corpus).filter((d) => existsSync(join(corpus, d, 'truth.yaml')));

  it('has seeded bugs in every category, inside real files, and clean control files', () => {
    const bugs = cases.flatMap((c) => {
      const t = parseTruth(readFileSync(join(corpus, c, 'truth.yaml'), 'utf8'), c);
      assert.equal(t.case, c);
      assert.ok(t.clean_files.length >= 2, `${c} needs clean control files`);
      for (const clean of t.clean_files) assert.ok(existsSync(join(corpus, c, clean)), `${c}/${clean}`);
      for (const bug of t.bugs) {
        const lineCount = readFileSync(join(corpus, c, bug.file), 'utf8').split('\n').length;
        const ends = (Array.isArray(bug.lines[0]) ? bug.lines.flat() : bug.lines) as number[];
        assert.ok(Math.max(...ends) <= lineCount, `${c} ${bug.id} points past the end of ${bug.file}`);
        assert.ok(!t.clean_files.includes(bug.file), `${c} ${bug.id} is in a clean file`);
      }
      return t.bugs;
    });
    assert.ok(cases.length >= 2);
    assert.ok(bugs.length >= 12, `${bugs.length} seeded bugs`);
    assert.equal(new Set(bugs.map((b) => b.id)).size, bugs.length);
    for (const a of ANALYZERS) assert.ok(bugs.filter((b) => b.category === a).length >= 2, `fewer than two ${a} bugs`);
  });
});
