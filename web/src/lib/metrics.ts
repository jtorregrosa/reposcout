import type { PrecisionCell, RunResult, UsageRow, YieldRow } from './types';

export interface PrecisionRow {
  key: string | null;
  kept: number;
  suppressed: number;
  refuted: number;
  dismissed: number;
  // kept / (kept + dismissed), or null when nothing was judged yet.
  precision: number | null;
}

export type PrecisionDimension = 'category' | 'model' | 'prompt_version';

// Precision along one dimension, for one repository or all of them. Rows keep their counts, so a precision
// computed from three findings reads as the small sample it is.
export function precisionBy(cells: readonly PrecisionCell[], dimension: PrecisionDimension, repo: string | null = null): PrecisionRow[] {
  const rows = new Map<string | null, PrecisionRow>();
  for (const c of cells) {
    if (repo && c.repo !== repo) continue;
    const key = c[dimension];
    const row = rows.get(key) ?? { key, kept: 0, suppressed: 0, refuted: 0, dismissed: 0, precision: null };
    row.kept += c.kept;
    row.suppressed += c.suppressed;
    row.refuted += c.refuted;
    rows.set(key, row);
  }
  return [...rows.values()]
    .map((r) => {
      const dismissed = r.suppressed + r.refuted;
      return { ...r, dismissed, precision: r.kept + dismissed ? r.kept / (r.kept + dismissed) : null };
    })
    .sort((a, b) => b.kept + b.dismissed - (a.kept + a.dismissed) || String(a.key).localeCompare(String(b.key)));
}

export interface YieldSummary {
  analyzer: string;
  runs: number;
  // Summed over the runs whose specialist replies could be parsed; unparsed counts the others.
  candidates: number | null;
  unparsed: number;
  kept: number;
  speculative: number;
  discarded: number;
  tokens: number | null;
  cost_usd: number | null;
  // This analyzer's share of the total cost given, or of the specialists' cost when none is.
  cost_share: number | null;
}

const sumOrNull = (values: (number | null)[]) => (values.some((v) => v != null) ? values.reduce<number>((s, v) => s + (v ?? 0), 0) : null);

// Each analyzer's yield summed over the given rows.
export function yieldByAnalyzer(rows: readonly YieldRow[], total: number | null = null): YieldSummary[] {
  const by = new Map<string, YieldRow[]>();
  for (const r of rows) by.set(r.analyzer, [...(by.get(r.analyzer) ?? []), r]);
  const totalCost = total ?? sumOrNull(rows.map((r) => r.cost_usd));
  return [...by.entries()]
    .map(([analyzer, list]) => {
      const parsed = list.filter((r) => r.candidates != null);
      const cost = sumOrNull(list.map((r) => r.cost_usd));
      return {
        analyzer,
        runs: list.length,
        candidates: parsed.length ? parsed.reduce((s, r) => s + (r.candidates ?? 0), 0) : null,
        unparsed: list.length - parsed.length,
        kept: list.reduce((s, r) => s + r.kept, 0),
        speculative: list.reduce((s, r) => s + r.speculative, 0),
        discarded: list.reduce((s, r) => s + r.discarded, 0),
        tokens: sumOrNull(list.map((r) => r.tokens)),
        cost_usd: cost,
        cost_share: cost != null && totalCost ? cost / totalCost : null,
      };
    })
    .sort((a, b) => a.analyzer.localeCompare(b.analyzer));
}

export interface CostSummary {
  // Summed over the runs that reported one; runs counts those.
  total: number | null;
  runs: number;
  findings: number;
  confirmed: number;
  per_finding: number | null;
  per_confirmed: number | null;
}

// What the period's runs cost, and what each new finding cost: every run counts, including the ones that found
// nothing or failed, since they were paid for too.
export function costSummary(usage: readonly UsageRow[], results: readonly RunResult[]): CostSummary {
  const costed = usage.filter((u) => typeof u.cost_usd_equivalent === 'number');
  const total = costed.length ? costed.reduce((s, u) => s + (u.cost_usd_equivalent ?? 0), 0) : null;
  const confirmed = results.reduce((s, r) => s + r.new_findings, 0);
  const findings = confirmed + results.reduce((s, r) => s + r.new_speculative, 0);
  return {
    total,
    runs: costed.length,
    findings,
    confirmed,
    per_finding: total != null && findings ? total / findings : null,
    per_confirmed: total != null && confirmed ? total / confirmed : null,
  };
}
