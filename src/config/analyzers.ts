// Each specialist reports findings in the category of the same name.
export const ANALYZERS = ['security', 'concurrency', 'error-handling', 'logic', 'performance'] as const;
export type Analyzer = (typeof ANALYZERS)[number];

export const isAnalyzer = (value: unknown): value is Analyzer => (ANALYZERS as readonly unknown[]).includes(value);

export function parseAnalyzers(value: unknown, label = 'analyzers'): Analyzer[] {
  const list =
    typeof value === 'string'
      ? value
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : value;
  if (!Array.isArray(list) || list.length === 0) throw new Error(`${label} must name at least one of: ${ANALYZERS.join(', ')}`);
  const unknown = list.filter((a) => !isAnalyzer(a));
  if (unknown.length) throw new Error(`${label}: unknown analyzer "${unknown[0]}"; use ${ANALYZERS.join(', ')}`);
  return ANALYZERS.filter((a) => list.includes(a));
}

// A run is all-or-nothing: state is written only when it succeeds. 500 files took the 5-hour window from 3% to
// 19% in two minutes and would have hit the limit before finishing, losing everything, while 120 cost ~4%.
export const MAX_FILES_CEILING = 150;

export const isValidMaxFiles = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= MAX_FILES_CEILING;

export const maxFilesMessage = (label: string) =>
  `${label} must be an integer from 1 to ${MAX_FILES_CEILING}; larger runs risk the subscription limit mid-run, which discards the whole run`;

export function checkMaxFiles(value: unknown, label: string): number {
  const n = Number(value);
  if (!isValidMaxFiles(n)) throw new Error(maxFilesMessage(label));
  return n;
}

export const MODES = ['incremental', 'full', 'speculative', 'validate'] as const;
export type Mode = (typeof MODES)[number];
export const isMode = (value: unknown): value is Mode => (MODES as readonly unknown[]).includes(value);

export const AUTH_MODES = ['isolated', 'login'] as const;
export type AuthMode = (typeof AUTH_MODES)[number];
