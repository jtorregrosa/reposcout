import type { Finding } from '../findings/types.js';

// Atlassian Document Format. Every piece of finding text goes into a text node, so Jira shows it literally: wiki markup
// or HTML quoted from an audited repository stays inert.
type Node = { type: string; version?: number; attrs?: Record<string, unknown>; content?: Node[]; text?: string; marks?: { type: string }[] };

const text = (t: string, strong = false): Node => ({ type: 'text', text: t, ...(strong ? { marks: [{ type: 'strong' }] } : {}) });
const heading = (t: string): Node => ({ type: 'heading', attrs: { level: 3 }, content: [text(t)] });
const paragraph = (...content: Node[]): Node => ({ type: 'paragraph', content });

// Blank lines separate paragraphs; empty text is left out because Jira refuses empty text nodes.
const paragraphs = (body: string | undefined): Node[] =>
  (body ?? '')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => paragraph(text(p)));

const orderedList = (items: string[]): Node => ({
  type: 'orderedList',
  content: items.filter((i) => i.trim()).map((i) => ({ type: 'listItem', content: [paragraph(text(i))] })),
});

const LANGUAGES: Record<string, string> = {
  cs: 'csharp',
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  py: 'python',
  java: 'java',
  go: 'go',
  rb: 'ruby',
  php: 'php',
  sql: 'sql',
  kt: 'kotlin',
  rs: 'rust',
};

const languageOf = (file: string) => LANGUAGES[file.split('.').pop()?.toLowerCase() ?? ''] ?? null;

const fact = (label: string, value: string): Node => paragraph(text(`${label}: `, true), text(value));

export type ReportedFinding = Pick<
  Finding,
  'fingerprint' | 'repo' | 'commit' | 'file' | 'line' | 'category' | 'severity' | 'description' | 'scenario' | 'suggested_fix' | 'snippet' | 'repro' | 'kind'
>;

export function findingDescription(f: ReportedFinding): Node {
  const content: Node[] = [
    fact('Location', `${f.repo} · ${f.file}:${f.line} at ${f.commit.slice(0, 10)}`),
    fact('Severity', f.severity),
    fact('Category', f.category),
    ...(f.kind ? [fact('Type', f.kind)] : []),
    heading('Scenario'),
    ...paragraphs(f.scenario),
    heading('Why it is a bug'),
    ...paragraphs(f.description),
  ];
  const r = f.repro;
  if (r && (r.steps.length || r.preconditions.length)) {
    content.push(heading('How to reproduce'));
    if (r.preconditions.length) content.push(paragraph(text('Before you start', true)), orderedList(r.preconditions));
    if (r.steps.length) content.push(orderedList(r.steps));
    if (r.expected) content.push(fact('Expected', r.expected));
    if (r.actual) content.push(fact('Actual', r.actual));
  }
  if (f.snippet?.trim()) {
    const lang = languageOf(f.file);
    content.push(heading(`Code at line ${f.line}`), { type: 'codeBlock', ...(lang ? { attrs: { language: lang } } : {}), content: [text(f.snippet)] });
  }
  content.push(heading('Suggested fix'), ...paragraphs(f.suggested_fix), fact('RepoScout fingerprint', f.fingerprint));
  return { type: 'doc', version: 1, content };
}

const SUMMARY_MAX = 255;

export const issueSummary = (title: string) => {
  const one = title.replace(/\s+/g, ' ').trim();
  return one.length > SUMMARY_MAX ? `${one.slice(0, SUMMARY_MAX - 1)}…` : one;
};

export const fingerprintLabel = (fingerprint: string) => `reposcout-${fingerprint}`;
