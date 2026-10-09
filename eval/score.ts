import { createHash } from 'node:crypto';
import { parse } from 'yaml';
import { z } from 'zod';
import { ANALYZERS, type Analyzer } from '../src/config/analyzers.js';
import type { RepoReport, RunUsage } from '../src/report/types.js';

// Scores one audit of a seeded corpus case against its ground truth. Pure: run.ts does the I/O.

// A finding matches a seeded bug in the same file when its line is within this many lines of the bug's range.
export const LINE_TOLERANCE = 3;
export const RESULT_SCHEMA = 'reposcout/eval@1';

const range = z.tuple([z.number().int().positive(), z.number().int().positive()]).refine(([a, b]) => a <= b, 'a line range must be [start, end]');

const truthSchema = z.object({
  case: z.string().min(1),
  description: z.string().optional(),
  clean_files: z.array(z.string()).default([]),
  bugs: z.array(
    z.object({
      id: z.string().min(1),
      file: z.string().min(1),
      // One range [start, end], or several for a bug whose evidence is split (a declaration and its use).
      lines: z.union([range, z.array(range).min(1)]),
      category: z.enum(ANALYZERS),
      severity: z.enum(['critical', 'high', 'medium', 'low']),
      description: z.string().min(1),
    }),
  ),
});

export type Truth = z.output<typeof truthSchema>;
export type TruthBug = Truth['bugs'][number];

export function parseTruth(text: string, source = 'truth.yaml'): Truth {
  const parsed = truthSchema.safeParse(parse(text));
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  throw new Error(`${source}: ${issue?.message ?? 'invalid'} (${issue?.path.join('.') ?? ''})`);
}

const rangesOf = (bug: TruthBug): [number, number][] => (Array.isArray(bug.lines[0]) ? (bug.lines as [number, number][]) : [bug.lines as [number, number]]);

export const withinBug = (bug: TruthBug, file: string, line: number, tolerance = LINE_TOLERANCE): boolean =>
  bug.file === file && rangesOf(bug).some(([start, end]) => line >= start - tolerance && line <= end + tolerance);

export interface ScoredFinding {
  file: string;
  line: number;
  category: Analyzer;
  title: string;
}

export interface FalsePositive extends ScoredFinding {
  // In a file the truth declares clean, rather than beside a seeded bug.
  control: boolean;
}

export interface CaseScore {
  case: string;
  analyzers: Analyzer[];
  // Seeded bugs whose category was audited; only these count for recall.
  bugs: number;
  found: string[];
  // Seeded bugs a finding of another category pointed at, and no finding of the right one.
  cross_category: string[];
  // Seeded bugs only a speculative candidate pointed at.
  speculative_hits: string[];
  missed: string[];
  findings: number;
  // Findings that pointed at a seeded bug already matched by an earlier one.
  duplicates: number;
  false_positives: FalsePositive[];
  recall: number | null;
  precision: number | null;
  recall_by_analyzer: Partial<Record<Analyzer, { found: number; total: number; recall: number | null }>>;
  lines: number;
  fp_per_kloc: number | null;
}

const ratio = (n: number, d: number): number | null => (d > 0 ? n / d : null);

// Confirmed findings are matched first, in report order: the same category scores a hit, another category on the
// same lines a cross-category match, a second finding on a matched bug a duplicate, and anything else a false
// positive. Speculative candidates never count as false positives; one on a bug no finding caught is a speculative
// hit. Precision counts every finding that pointed at a seeded bug, whatever its category, over all findings.
export function scoreCase({
  truth,
  findings,
  speculative = [],
  analyzers,
  lines,
  tolerance = LINE_TOLERANCE,
}: {
  truth: Truth;
  findings: ScoredFinding[];
  speculative?: ScoredFinding[];
  analyzers: readonly Analyzer[];
  lines: number;
  tolerance?: number;
}): CaseScore {
  const inScope = truth.bugs.filter((b) => analyzers.includes(b.category));
  const found = new Set<string>();
  const crossed = new Set<string>();
  const falsePositives: FalsePositive[] = [];
  let duplicates = 0;
  for (const f of findings) {
    const near = truth.bugs.filter((b) => withinBug(b, f.file, f.line, tolerance));
    const same = near.filter((b) => b.category === f.category);
    const fresh = same.find((b) => !found.has(b.id));
    if (fresh) found.add(fresh.id);
    else if (same.length) duplicates++;
    else if (near.length) for (const b of near) crossed.add(b.id);
    else falsePositives.push({ ...f, control: truth.clean_files.includes(f.file) });
  }
  const speculativeHits = new Set<string>();
  for (const s of speculative) {
    for (const b of truth.bugs.filter((bug) => withinBug(bug, s.file, s.line, tolerance))) if (!found.has(b.id)) speculativeHits.add(b.id);
  }
  const ids = (pred: (b: TruthBug) => boolean) => inScope.filter(pred).map((b) => b.id);
  const recallBy: CaseScore['recall_by_analyzer'] = {};
  for (const a of analyzers) {
    const total = inScope.filter((b) => b.category === a).length;
    const hit = inScope.filter((b) => b.category === a && found.has(b.id)).length;
    recallBy[a] = { found: hit, total, recall: ratio(hit, total) };
  }
  return {
    case: truth.case,
    analyzers: [...analyzers],
    bugs: inScope.length,
    found: ids((b) => found.has(b.id)),
    cross_category: ids((b) => !found.has(b.id) && crossed.has(b.id)),
    speculative_hits: ids((b) => !found.has(b.id) && speculativeHits.has(b.id)),
    missed: ids((b) => !found.has(b.id)),
    findings: findings.length,
    duplicates,
    false_positives: falsePositives,
    recall: ratio(inScope.filter((b) => found.has(b.id)).length, inScope.length),
    precision: ratio(findings.length - falsePositives.length, findings.length),
    recall_by_analyzer: recallBy,
    lines,
    fp_per_kloc: lines > 0 ? falsePositives.length / (lines / 1000) : null,
  };
}

// The findings and candidates of a report, in the shape the scorer takes.
export function reportFindings(report: Pick<RepoReport, 'findings' | 'speculative_new'>): { findings: ScoredFinding[]; speculative: ScoredFinding[] } {
  const pick = (f: ScoredFinding): ScoredFinding => ({ file: f.file, line: f.line, category: f.category, title: f.title });
  return { findings: report.findings.map(pick), speculative: report.speculative_new.map(pick) };
}

// Identifies the prompts a result was produced with: the first 12 hex characters of SHA-256 over the audit skill and
// every agent prompt, in path order, with line endings normalised so a Windows checkout hashes the same.
export function promptVersion(files: { path: string; text: string }[]): string {
  const hash = createHash('sha256');
  for (const f of [...files].sort((a, b) => a.path.localeCompare(b.path))) hash.update(`${f.path}\0${f.text.replace(/\r\n/g, '\n')}\0`);
  return hash.digest('hex').slice(0, 12);
}

export interface CaseUsage {
  cost_usd: number | null;
  wall_s: number;
  turns: number | null;
  input_tokens: number;
  output_tokens: number;
  five_hour: number | null;
  seven_day: number | null;
}

export function caseUsage(usage: RunUsage | null | undefined): CaseUsage | null {
  if (!usage) return null;
  const models = Object.values(usage.models ?? {});
  return {
    cost_usd: usage.cost_usd_equivalent,
    wall_s: Math.round(usage.wall_ms / 1000),
    turns: usage.num_turns,
    input_tokens: models.reduce((n, m) => n + m.input, 0),
    output_tokens: models.reduce((n, m) => n + m.output, 0),
    five_hour: usage.window_cost?.five_hour ?? null,
    seven_day: usage.window_cost?.seven_day ?? null,
  };
}

export interface CaseResult {
  score: CaseScore | null;
  usage: CaseUsage | null;
  case: string;
  error?: string;
}

export interface Totals {
  bugs: number;
  found: number;
  recall: number | null;
  precision: number | null;
  findings: number;
  false_positives: number;
  control_false_positives: number;
  fp_per_kloc: number | null;
  cross_category: number;
  speculative_hits: number;
  cost_usd: number | null;
  wall_s: number;
  five_hour: number | null;
  seven_day: number | null;
  recall_by_analyzer: Partial<Record<Analyzer, { found: number; total: number; recall: number | null }>>;
}

export interface EvalResult {
  schema: typeof RESULT_SCHEMA;
  at: string;
  prompt_version: string;
  models: Record<string, string>;
  analyzers: Analyzer[];
  cases: CaseResult[];
  totals: Totals;
}

const sumOrNull = (values: (number | null | undefined)[]): number | null => {
  const known = values.filter((v): v is number => typeof v === 'number');
  return known.length ? known.reduce((a, b) => a + b, 0) : null;
};

export function totals(cases: CaseResult[]): Totals {
  const scores = cases.map((c) => c.score).filter((s): s is CaseScore => !!s);
  const sum = (fn: (s: CaseScore) => number) => scores.reduce((n, s) => n + fn(s), 0);
  const bugs = sum((s) => s.bugs);
  const found = sum((s) => s.found.length);
  const findings = sum((s) => s.findings);
  const fps = sum((s) => s.false_positives.length);
  const lines = sum((s) => s.lines);
  const byAnalyzer: Totals['recall_by_analyzer'] = {};
  for (const s of scores) {
    for (const [a, r] of Object.entries(s.recall_by_analyzer) as [Analyzer, { found: number; total: number }][]) {
      const acc = byAnalyzer[a] ?? { found: 0, total: 0, recall: null };
      acc.found += r.found;
      acc.total += r.total;
      acc.recall = ratio(acc.found, acc.total);
      byAnalyzer[a] = acc;
    }
  }
  const usages = cases.map((c) => c.usage);
  return {
    bugs,
    found,
    recall: ratio(found, bugs),
    precision: ratio(findings - fps, findings),
    findings,
    false_positives: fps,
    control_false_positives: sum((s) => s.false_positives.filter((f) => f.control).length),
    fp_per_kloc: lines > 0 ? fps / (lines / 1000) : null,
    cross_category: sum((s) => s.cross_category.length),
    speculative_hits: sum((s) => s.speculative_hits.length),
    cost_usd: sumOrNull(usages.map((u) => u?.cost_usd)),
    wall_s: usages.reduce((n, u) => n + (u?.wall_s ?? 0), 0),
    five_hour: sumOrNull(usages.map((u) => u?.five_hour)),
    seven_day: sumOrNull(usages.map((u) => u?.seven_day)),
    recall_by_analyzer: byAnalyzer,
  };
}

// The metrics compared between two results, with whether a higher value is better.
const COMPARED: [string, (t: Totals) => number | null, boolean][] = [
  ['recall', (t) => t.recall, true],
  ['precision', (t) => t.precision, true],
  ['fp_per_kloc', (t) => t.fp_per_kloc, false],
  ['cross_category', (t) => t.cross_category, false],
  ['speculative_hits', (t) => t.speculative_hits, true],
  ['cost_usd', (t) => t.cost_usd, false],
  ...ANALYZERS.map((a): [string, (t: Totals) => number | null, boolean] => [`recall.${a}`, (t) => t.recall_by_analyzer[a]?.recall ?? null, true]),
];

export interface Delta {
  metric: string;
  before: number | null;
  after: number | null;
  delta: number | null;
  better: boolean | null;
}

export function compare(previous: Pick<EvalResult, 'totals'>, current: Pick<EvalResult, 'totals'>): Delta[] {
  return COMPARED.map(([metric, get, higherIsBetter]) => {
    const before = get(previous.totals);
    const after = get(current.totals);
    const delta = before != null && after != null ? after - before : null;
    return { metric, before, after, delta, better: delta == null || delta === 0 ? null : delta > 0 === higherIsBetter };
  }).filter((d) => d.before != null || d.after != null);
}

const pct = (v: number | null | undefined) => (v == null ? '–' : `${Math.round(v * 100)}%`);
const num = (v: number | null | undefined, digits = 2) => (v == null ? '–' : v.toFixed(digits));
const isRate = (metric: string) => metric.startsWith('recall') || metric === 'precision';

export function toMarkdown(result: EvalResult, previous: EvalResult | null): string {
  const t = result.totals;
  const lines = [
    `# RepoScout evaluation ${result.at}`,
    '',
    `Prompt version \`${result.prompt_version}\` · models ${Object.entries(result.models)
      .map(([k, v]) => `${k} ${v}`)
      .join(', ')} · analyzers ${result.analyzers.join(', ')}`,
    '',
    '| Case | Recall | Precision | Found | Missed | Cross-category | Speculative hits | FP (control) | FP/KLOC | Cost (USD) | Wall (s) |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const c of result.cases) {
    const s = c.score;
    if (!s) {
      lines.push(`| ${c.case} | failed: ${c.error ?? 'no report'} | | | | | | | | | |`);
      continue;
    }
    const fps = `${s.false_positives.length} (${s.false_positives.filter((f) => f.control).length})`;
    lines.push(
      `| ${c.case} | ${pct(s.recall)} | ${pct(s.precision)} | ${s.found.length}/${s.bugs} | ${s.missed.join(', ') || '–'} | ${s.cross_category.join(', ') || '–'} | ${s.speculative_hits.join(', ') || '–'} | ${fps} | ${num(s.fp_per_kloc, 1)} | ${num(c.usage?.cost_usd)} | ${c.usage?.wall_s ?? '–'} |`,
    );
  }
  lines.push(
    `| **Total** | **${pct(t.recall)}** | **${pct(t.precision)}** | ${t.found}/${t.bugs} | | ${t.cross_category} | ${t.speculative_hits} | ${t.false_positives} (${t.control_false_positives}) | ${num(t.fp_per_kloc, 1)} | ${num(t.cost_usd)} | ${t.wall_s} |`,
    '',
    '| Analyzer | Recall |',
    '| --- | --- |',
    ...Object.entries(t.recall_by_analyzer).map(([a, r]) => `| ${a} | ${pct(r?.recall)} (${r?.found}/${r?.total}) |`),
  );
  if (t.five_hour != null || t.seven_day != null) lines.push('', `Subscription windows used: 5-hour ${pct(t.five_hour)}, weekly ${pct(t.seven_day)}.`);
  if (previous) {
    lines.push(
      '',
      `## Compared with ${previous.at} (prompt version \`${previous.prompt_version}\`)`,
      '',
      '| Metric | Before | After | Delta |',
      '| --- | --- | --- | --- |',
    );
    for (const d of compare(previous, result)) {
      const fmt = isRate(d.metric) ? pct : (v: number | null) => num(v);
      const sign = d.delta != null && d.delta > 0 ? '+' : '';
      const delta = d.delta == null ? '–' : isRate(d.metric) ? `${sign}${Math.round(d.delta * 100)} pts` : `${sign}${num(d.delta)}`;
      lines.push(`| ${d.metric} | ${fmt(d.before)} | ${fmt(d.after)} | ${delta}${d.better == null ? '' : d.better ? ' (better)' : ' (worse)'} |`);
    }
  }
  return `${lines.join('\n')}\n`;
}
