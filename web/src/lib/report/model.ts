// The structure both exports share: findings in reading order, numbered, grouped by severity, with the summaries
// an auditor reads before them. HTML and Markdown only differ in how they print it.
import { CATEGORIES, CATEGORY_ABOUT, CATEGORY_LABEL, KIND_LABEL, KINDS, SEVERITIES, severityRank } from '../domain';
import type { Category, FindingView, Kind, RepoView, Severity } from '../types';

export type ReportFinding = Pick<
  FindingView,
  | 'fingerprint'
  | 'repo'
  | 'file'
  | 'line'
  | 'category'
  | 'severity'
  | 'confidence'
  | 'verified'
  | 'status'
  | 'title'
  | 'description'
  | 'scenario'
  | 'suggested_fix'
  | 'first_seen'
> &
  Partial<
    Pick<
      FindingView,
      | 'status_pending'
      | 'specialists'
      | 'suppressed_reason'
      | 'unconfirmed'
      | 'resolution'
      | 'snippet'
      | 'commit'
      | 'reproduction'
      | 'repro'
      | 'kind'
      | 'personal_data'
      | 'issue'
    >
  >;

export type ReportRepo = Pick<RepoView, 'name' | 'branch' | 'last_commit'>;

export interface NumberedFinding extends ReportFinding {
  id: string;
  anchor: string;
}

export interface ReportModel {
  title: string;
  scope: string;
  generatedAt: Date;
  repos: ReportRepo[];
  total: number;
  byType: TypeSection[];
  matrix: { category: Category; label: string; anchor: string; cells: { count: number; anchor: string }[]; total: number }[];
  severityTotals: number[];
  // How many of each type, those not classified last; only the ones present.
  kinds: { kind: Kind | null; label: string; count: number }[];
  personalData: number;
  perRepo: { repo: string; cells: number[]; total: number }[];
  ordered: NumberedFinding[];
}

export interface TypeSection {
  category: Category;
  label: string;
  about: string;
  anchor: string;
  total: number;
  severities: { severity: Severity; anchor: string; findings: NumberedFinding[] }[];
}

// Anchors every link in both formats points at: a type section, and a severity inside it.
export const typeAnchor = (category: string) => `type-${category}`;
export const severityAnchor = (category: string, severity: string) => `type-${category}-${severity}`;

export const SEVERITY_ABOUT: Record<Severity, string> = {
  critical: 'Exploitable or data-losing as the code stands. Fix before anything else.',
  high: 'A real defect with serious impact under conditions that occur in practice.',
  medium: 'A real defect with limited impact, or one that needs an uncommon condition.',
  low: 'Minor impact or narrow conditions. Worth fixing when the code is touched.',
};

const categoryRank = (c: string) => {
  const i = (CATEGORIES as readonly string[]).indexOf(c);
  return i < 0 ? CATEGORIES.length : i;
};

// By type; inside a type, most severe first, then where the code is.
const readingOrder = (a: ReportFinding, b: ReportFinding) =>
  categoryRank(a.category) - categoryRank(b.category) ||
  severityRank(a.severity) - severityRank(b.severity) ||
  a.repo.localeCompare(b.repo) ||
  a.file.localeCompare(b.file) ||
  a.line - b.line;

export const categoryLabel = (c: string) => CATEGORY_LABEL[c as Category] ?? c;
export const kindLabel = (k: Kind | undefined) => (k ? KIND_LABEL[k] : 'Not classified');

export function buildReportModel(findings: ReportFinding[], { scope, repos = [] }: { scope: string; repos?: ReportRepo[] }): ReportModel {
  const width = String(findings.length).length < 2 ? 2 : String(findings.length).length;
  const ordered = [...findings].sort(readingOrder).map((f, i) => {
    const n = String(i + 1).padStart(width, '0');
    return { ...f, id: `F-${n}`, anchor: `f-${n}` };
  });
  const repoNames = [...new Set(ordered.map((f) => f.repo))].sort();
  const count = (pred: (f: ReportFinding) => boolean) => ordered.filter(pred).length;
  return {
    title: repoNames.length === 1 ? (repoNames[0] as string) : repoNames.length ? `${repoNames.length} repositories` : 'No findings',
    scope,
    generatedAt: new Date(),
    repos,
    total: ordered.length,
    ordered,
    byType: CATEGORIES.map((category) => {
      const inType = ordered.filter((f) => f.category === category);
      return {
        category,
        label: CATEGORY_LABEL[category],
        about: CATEGORY_ABOUT[category],
        anchor: typeAnchor(category),
        total: inType.length,
        severities: SEVERITIES.map((severity) => ({
          severity,
          anchor: severityAnchor(category, severity),
          findings: inType.filter((f) => f.severity === severity),
        })).filter((g) => g.findings.length),
      };
    }).filter((t) => t.total),
    matrix: CATEGORIES.map((category) => {
      const cells = SEVERITIES.map((s) => ({ count: count((f) => f.category === category && f.severity === s), anchor: severityAnchor(category, s) }));
      return { category, label: CATEGORY_LABEL[category], anchor: typeAnchor(category), cells, total: cells.reduce((a, c) => a + c.count, 0) };
    }).filter((r) => r.total),
    severityTotals: SEVERITIES.map((s) => count((f) => f.severity === s)),
    kinds: [...KINDS, null]
      .map((kind) => ({ kind, label: kindLabel(kind ?? undefined), count: count((f) => (f.kind ?? null) === kind) }))
      .filter((k) => k.count),
    personalData: count((f) => f.personal_data === true),
    perRepo:
      repoNames.length > 1
        ? repoNames.map((repo) => {
            const cells = SEVERITIES.map((s) => count((f) => f.repo === repo && f.severity === s));
            return { repo, cells, total: cells.reduce((a, b) => a + b, 0) };
          })
        : [],
  };
}

// A sentence ends at a full stop, question or exclamation mark followed by a space and a capital, quote or code.
const SENTENCE_END = /(?<=[.!?])\s+(?=[A-Z"'`(])/;
const PARAGRAPH_CHARS = 320;

// Splits the long single-paragraph prose the auditors write into paragraphs of a few sentences, so a reader can
// take it in pieces. Explicit line breaks are kept as paragraph breaks.
export function paragraphs(text: string | null | undefined): string[] {
  const out: string[] = [];
  for (const block of String(text ?? '')
    .split(/\n\s*\n|\r?\n/)
    .map((b) => b.trim())
    .filter(Boolean)) {
    let current = '';
    for (const sentence of block.split(SENTENCE_END)) {
      if (current && current.length + sentence.length > PARAGRAPH_CHARS) {
        out.push(current);
        current = sentence;
      } else current = current ? `${current} ${sentence}` : sentence;
    }
    if (current) out.push(current);
  }
  return out;
}

export function splitPath(file: string): { dir: string; name: string } {
  const i = file.lastIndexOf('/');
  return i < 0 ? { dir: '', name: file } : { dir: file.slice(0, i + 1), name: file.slice(i + 1) };
}
