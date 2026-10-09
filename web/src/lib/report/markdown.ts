import { CATEGORY_LABEL, SEVERITIES } from '../domain';
import { formatDate } from '../format';
import type { FindingView } from '../types';
import {
  buildReportModel,
  categoryLabel,
  kindLabel,
  type NumberedFinding,
  paragraphs,
  type ReportFinding,
  type ReportRepo,
  SEVERITY_ABOUT,
  typeAnchor,
} from './model';

// Table cells hold one line, and a pipe would end the cell.
const cell = (s: unknown) =>
  String(s ?? '')
    .replace(/\r?\n+/g, ' ')
    .replace(/\|/g, '\\|')
    .trim();
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// A code block whose fence cannot be closed early by backticks inside the quoted code.
function fence(code: string): string[] {
  const longest = Math.max(2, ...[...code.matchAll(/`+/g)].map((m) => m[0].length));
  const marks = '`'.repeat(longest + 1);
  return [marks, code, marks];
}

function section(title: string, text: string | null | undefined): string[] {
  const body = paragraphs(text);
  return body.length ? [`**${title}**`, '', ...body.flatMap((p) => [p, ''])] : [];
}

function reproSection(r: ReportFinding['repro']): string[] {
  if (!r) return [];
  const out = ['**How to reproduce**', ''];
  if (r.preconditions.length) out.push('_Before you start_', '', ...r.preconditions.map((p) => `- ${cell(p)}`), '');
  out.push('_Steps_', '', ...r.steps.map((s, i) => `${i + 1}. ${cell(s)}`), '');
  if (r.expected) out.push(`**Expected:** ${cell(r.expected)}`, '');
  if (r.actual) out.push(`**Actual:** ${cell(r.actual)}`, '');
  return out;
}

// One finding as a ticket body: what an auditor pastes into Jira or a pull request comment.
export function findingMarkdown(x: FindingView): string {
  const out = [
    `### ${cell(x.title)}`,
    '',
    '| | |',
    '| --- | --- |',
    `| Severity | ${x.severity} |`,
    `| Type | ${kindLabel(x.kind)} |`,
    `| Category | ${CATEGORY_LABEL[x.category]} |`,
    ...(x.personal_data ? ['| Personal data | Yes |'] : []),
    `| Location | \`${cell(x.repo)}\` · \`${cell(x.file)}:${x.line}\` |`,
    `| Confidence | ${x.confidence}${x.verified ? ', reproduced by a test' : ''} |`,
    `| Fingerprint | \`${x.fingerprint}\` |`,
    '',
    ...section('What happens', x.scenario),
    ...reproSection(x.repro),
    ...section('Why it is a bug', x.description),
    ...section('How to fix', x.suggested_fix),
    ...section('Not confirmed', x.unconfirmed),
  ];
  if (x.snippet) out.push(`**Code at line ${x.line}**`, '', ...fence(x.snippet), '');
  return `${out.join('\n').trim()}\n`;
}

function detail(f: NumberedFinding): string[] {
  const status = f.status_pending ? `${f.status} (pending)` : f.status;
  const out = [
    `<a id="${f.anchor}"></a>`,
    '',
    `#### ${f.id} · ${cell(f.title)}`,
    '',
    '| | |',
    '| --- | --- |',
    `| Severity | ${f.severity} |`,
    `| Type | ${kindLabel(f.kind)} |`,
    `| Category | ${categoryLabel(f.category)} |`,
    ...(f.personal_data ? ['| Personal data | Yes |'] : []),
    `| Repository | \`${cell(f.repo)}\` |`,
    `| Location | \`${cell(f.file)}:${f.line}\` |`,
    `| Confidence | ${f.confidence}${f.verified ? ', reproduced by a test' : ''} |`,
    `| Status | ${status} |`,
    `| First seen | ${formatDate(f.first_seen)} |`,
    `| Reported by | ${cell((f.specialists ?? []).join(', ') || '—')} |`,
    '',
    ...section('What happens', f.scenario),
    ...reproSection(f.repro),
    ...section('Why it is a bug', f.description),
    ...section('How to fix', f.suggested_fix),
  ];
  if (f.snippet) out.push(`**Code at line ${f.line}**`, '', ...fence(f.snippet), '');
  if (f.reproduction) out.push('**Reproduction**', '', ...fence(f.reproduction), '');
  out.push(...section('Not confirmed', f.unconfirmed), ...section('Suppressed because', f.suppressed_reason), ...section('Resolution', f.resolution));
  out.push(
    `<sub>Fingerprint \`${f.fingerprint}\`${f.commit ? ` · commit \`${String(f.commit).slice(0, 10)}\`` : ''} · [${categoryLabel(f.category)}](#${typeAnchor(f.category)}) · [index](#index)</sub>`,
    '',
    '---',
    '',
  );
  return out;
}

export function buildMarkdownReport(findings: ReportFinding[], scope: string, repos: ReportRepo[] = []): string {
  const m = buildReportModel(findings, { scope, repos });
  const out = [
    `# Findings report · ${m.title}`,
    '',
    `Generated ${m.generatedAt.toLocaleString()} by RepoScout · ${m.total} ${m.total === 1 ? 'finding' : 'findings'} · ${scope}`,
    '',
  ];
  for (const r of m.repos) out.push(`- \`${r.name}\` · ${r.branch} @ \`${String(r.last_commit ?? '').slice(0, 10)}\``);
  if (m.repos.length) out.push('');

  out.push('<a id="summary"></a>', '', '## Summary', '');
  out.push(`| Severity | ${SEVERITIES.map(cap).join(' | ')} | Total |`, `| --- | ${SEVERITIES.map(() => '---:').join(' | ')} | ---: |`);
  out.push(`| Findings | ${m.severityTotals.join(' | ')} | ${m.total} |`, '');
  const kinds = [...m.kinds.map((k) => `${k.label} ${k.count}`), ...(m.personalData ? [`personal data ${m.personalData}`] : [])];
  if (kinds.length) out.push(`**Type:** ${kinds.join(' · ')}`, '');

  // Every category and every number links to the section that holds those findings.
  out.push('### By category', '', `| Category | ${SEVERITIES.map(cap).join(' | ')} | Total |`, `| --- | ${SEVERITIES.map(() => '---:').join(' | ')} | ---: |`);
  for (const r of m.matrix) {
    const cells = r.cells.map((c) => (c.count ? `[${c.count}](#${c.anchor})` : '–'));
    out.push(`| [${r.label}](#${r.anchor}) | ${cells.join(' | ')} | [${r.total}](#${r.anchor}) |`);
  }
  out.push('');
  if (m.perRepo.length) {
    out.push(
      '### By repository',
      '',
      `| Repository | ${SEVERITIES.map(cap).join(' | ')} | Total |`,
      `| --- | ${SEVERITIES.map(() => '---:').join(' | ')} | ---: |`,
    );
    for (const r of m.perRepo) out.push(`| \`${cell(r.repo)}\` | ${r.cells.map((n) => n || '–').join(' | ')} | ${r.total} |`);
    out.push('');
  }

  out.push('<a id="index"></a>', '', '## Findings at a glance', '');
  for (const t of m.byType) {
    out.push(`**[${t.label}](#${t.anchor})** · ${t.total}`, '', '| Id | Severity | Type | Finding | Location |', '| --- | --- | --- | --- | --- |');
    for (const f of t.severities.flatMap((g) => g.findings)) {
      const where = `${m.perRepo.length ? `${cell(f.repo)} · ` : ''}${cell(f.file)}:${f.line}`;
      out.push(
        `| [${f.id}](#${f.anchor}) | ${f.severity} | ${kindLabel(f.kind)}${f.personal_data ? ', personal data' : ''} | ${cell(f.title)} | \`${where}\` |`,
      );
    }
    out.push('');
  }

  for (const t of m.byType) {
    out.push(`<a id="${t.anchor}"></a>`, '', `## ${t.label} · ${t.total}`, '', `_${t.about}_ · [back to the summary](#summary)`, '');
    for (const g of t.severities) {
      out.push(`<a id="${g.anchor}"></a>`, '', `### ${t.label} · ${cap(g.severity)} · ${g.findings.length}`, '', `_${SEVERITY_ABOUT[g.severity]}_`, '');
      for (const f of g.findings) out.push(...detail(f));
    }
  }
  return `${out.join('\n').trim()}\n`;
}
