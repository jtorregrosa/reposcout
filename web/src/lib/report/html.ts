// A self-contained HTML findings report: it is downloaded and opened from disk, so it carries its own styles and
// loads nothing. Finding text quotes audited code, so every value is escaped before any markup is added.
import { markSvg } from '../brand';
import { SEVERITIES } from '../domain';
import { formatDate } from '../format';
import {
  buildReportModel,
  categoryLabel,
  kindLabel,
  type NumberedFinding,
  paragraphs,
  type ReportFinding,
  type ReportModel,
  type ReportRepo,
  SEVERITY_ABOUT,
  splitPath,
  typeAnchor,
} from './model';
import { REPORT_STYLE } from './style';

export type { ReportFinding };

const esc = (s: unknown) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

// Backtick spans in the auditors' prose become code; the text is escaped first, so a span can never carry markup.
const prose = (text: string) => esc(text).replace(/`([^`]+)`/g, '<code>$1</code>');
const paras = (text: string | null | undefined) =>
  paragraphs(text)
    .map((p) => `<p>${prose(p)}</p>`)
    .join('');
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const sev = (s: string) => `--c: var(--${(SEVERITIES as readonly string[]).includes(s) ? s : 'low'})`;
const pill = (s: string) => `<span class="pill" style="${sev(s)}">${esc(s)}</span>`;

function cover(m: ReportModel): string {
  const commits = m.repos.map((r) => `${esc(r.name)} · ${esc(r.branch)} @ <code>${esc(String(r.last_commit ?? '').slice(0, 10))}</code>`).join('<br>');
  return `
<header class="cover">
  <div class="brand">${markSvg()}<div class="eyebrow">RepoScout · Findings report</div></div>
  <h1>${esc(m.title)}</h1>
  <p class="subtitle">${m.total} ${m.total === 1 ? 'finding' : 'findings'}</p>
  <dl class="meta">
    <dt>Generated</dt><dd>${esc(m.generatedAt.toLocaleString())}</dd>
    <dt>Scope</dt><dd>${esc(m.scope)}</dd>
    ${commits ? `<dt>Audited code</dt><dd>${commits}</dd>` : ''}
  </dl>
</header>`;
}

function summary(m: ReportModel): string {
  const kpis = [
    `<div class="kpi"><div class="n">${m.total}</div><div class="l">findings</div></div>`,
    ...SEVERITIES.map((s, i) => `<div class="kpi" style="${sev(s)}"><div class="n">${m.severityTotals[i]}</div><div class="l">${s}</div></div>`),
  ].join('');
  const head = `<tr><th>Category</th>${SEVERITIES.map((s) => `<th class="num"><span class="dot" style="${sev(s)}"></span>${cap(s)}</th>`).join('')}<th class="num">Total</th></tr>`;
  const zero = '<td class="num zero">–</td>';
  // Every number opens the findings it counts: a cell its category at that severity, a row total the whole category.
  const matrix = `
<div class="panel">
  <h3>By category and severity</h3>
  <table class="matrix">
    <thead>${head}</thead>
    <tbody>${m.matrix
      .map(
        (r) =>
          `<tr><td><a href="#${r.anchor}">${esc(r.label)}</a></td>${r.cells
            .map((c) => (c.count ? `<td class="num"><a href="#${c.anchor}">${c.count}</a></td>` : zero))
            .join('')}<td class="num"><a href="#${r.anchor}"><b>${r.total}</b></a></td></tr>`,
      )
      .join('')}</tbody>
    <tfoot><tr><td>Total</td>${m.severityTotals.map((n) => `<td class="num">${n}</td>`).join('')}<td class="num">${m.total}</td></tr></tfoot>
  </table>
</div>`;
  const perRepo = m.perRepo.length
    ? `
<div class="panel">
  <h3>By repository</h3>
  <table>
    <thead><tr><th>Repository</th>${SEVERITIES.map((s) => `<th class="num"><span class="dot" style="${sev(s)}"></span></th>`).join('')}<th class="num">Total</th></tr></thead>
    <tbody>${m.perRepo.map((r) => `<tr><td>${esc(r.repo)}</td>${r.cells.map((n) => (n ? `<td class="num">${n}</td>` : zero)).join('')}<td class="num"><b>${r.total}</b></td></tr>`).join('')}</tbody>
  </table>
</div>`
    : '';
  const sections = m.byType
    .map(
      (t) => `
<div class="type-card">
  <a class="type-name" href="#${t.anchor}">${esc(t.label)}</a>
  <span class="type-total">${t.total} ${t.total === 1 ? 'finding' : 'findings'}</span>
  <span class="type-sevs">${t.severities.map((g) => `<a href="#${g.anchor}" style="${sev(g.severity)}"><span class="dot"></span>${g.findings.length} ${g.severity}</a>`).join('')}</span>
</div>`,
    )
    .join('');
  return `
<section class="block" id="summary">
  <h2>Summary</h2>
  <p class="lead">How many findings this report holds, and where. Every finding below was confirmed by the verifier against the code. Select a category or a number to go to those findings.</p>
  <div class="kpis">${kpis}</div>
  ${kinds(m)}
  <nav class="type-nav" aria-label="Sections by category">${sections}</nav>
  <div class="summary-grid${perRepo ? ' two' : ''}">${matrix}${perRepo}</div>
</section>`;
}

function kinds(m: ReportModel): string {
  const tags = m.kinds.map((k) => `<span class="tag${k.kind ? ` ${k.kind}` : ''}">${esc(k.label)} <b>${k.count}</b></span>`);
  if (m.personalData) tags.push(`<span class="tag personal">Personal data <b>${m.personalData}</b></span>`);
  return tags.length ? `<p class="kinds"><span class="kinds-label">Type</span>${tags.join('')}</p>` : '';
}

function tag(f: NumberedFinding): string {
  const kind = f.kind ? `<span class="tag ${f.kind}">${esc(kindLabel(f.kind))}</span>` : '';
  return `${kind}${f.personal_data ? '<span class="tag personal">Personal data</span>' : ''}`;
}

function index(m: ReportModel): string {
  const showRepo = m.perRepo.length > 0;
  const rows = m.byType
    .map((t) => {
      const group = `<tr class="group"><td colspan="3"><a href="#${t.anchor}">${esc(t.label)}</a> <span class="count">${t.total}</span></td></tr>`;
      const items = t.severities
        .flatMap((g) => g.findings)
        .map((f) => {
          const where = `${showRepo ? `${esc(f.repo)} · ` : ''}${esc(f.file)}:${f.line}`;
          return `<tr><td class="id"><a href="#${f.anchor}">${f.id}</a></td><td>${pill(f.severity)}</td><td><a href="#${f.anchor}">${esc(f.title)}</a> ${tag(f)}<div class="loc">${where}</div></td></tr>`;
        })
        .join('');
      return group + items;
    })
    .join('');
  return `
<section class="block" id="index">
  <h2>Findings at a glance</h2>
  <p class="lead">By category, most severe first inside each. Each id links to the finding's details.</p>
  <div class="panel index">
    <table>
      <thead><tr><th>Id</th><th>Severity</th><th>Finding</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
</section>`;
}

function repro(r: ReportFinding['repro']): string {
  if (!r) return '';
  const pre = r.preconditions.length
    ? `<div class="r-label">Before you start</div><ul>${r.preconditions.map((p) => `<li>${prose(p)}</li>`).join('')}</ul>`
    : '';
  const steps = `<div class="r-label">Steps</div><ol>${r.steps.map((s) => `<li>${prose(s)}</li>`).join('')}</ol>`;
  const outcome =
    r.expected || r.actual
      ? `<div class="outcome">${r.expected ? `<div class="expected"><div class="r-label">Expected</div>${paras(r.expected)}</div>` : ''}${r.actual ? `<div class="actual"><div class="r-label">Actual</div>${paras(r.actual)}</div>` : ''}</div>`
      : '';
  return `<div class="repro">${pre}${steps}${outcome}</div>`;
}

function part(title: string, body: string, kind = ''): string {
  return body ? `<div class="part${kind ? ` ${kind}` : ''}"><h4>${title}</h4><div>${body}</div></div>` : '';
}

function finding(f: NumberedFinding): string {
  const { dir, name } = splitPath(f.file);
  const status = f.status_pending ? `${f.status} (pending)` : f.status;
  const facts = [
    ['Repository', esc(f.repo)],
    ['Type', esc(kindLabel(f.kind))],
    ['Category', esc(categoryLabel(f.category))],
    ...(f.personal_data ? [['Personal data', 'Yes']] : []),
    ['Confidence', `${esc(f.confidence)}${f.verified ? ' · reproduced by a test' : ''}`],
    ['Status', esc(status)],
    ['Location', `<span class="path">${esc(dir)}<b>${esc(name)}</b>:${f.line}</span>`, 'wide'],
    ['First seen', esc(formatDate(f.first_seen))],
    ['Reported by', esc((f.specialists ?? []).join(', ') || '—')],
  ]
    .map(([label, value, wide]) => `<div${wide ? ` class="${wide}"` : ''}><dt>${label}</dt><dd>${value}</dd></div>`)
    .join('');
  return `
<article class="finding" id="${f.anchor}" style="${sev(f.severity)}">
  <div class="f-head">
    <div class="f-kicker"><span class="id">${f.id}</span>${pill(f.severity)}${tag(f)}<span>${esc(categoryLabel(f.category))}</span></div>
    <h3>${esc(f.title)}</h3>
  </div>
  <dl class="facts">${facts}</dl>
  <div class="f-body">
    ${part('What happens', paras(f.scenario))}
    ${part('How to reproduce', repro(f.repro), 'steps')}
    ${part('Why it is a bug', paras(f.description))}
    ${part('How to fix', paras(f.suggested_fix), 'fix')}
    ${f.snippet ? part(`Code at line ${f.line}`, `<pre class="snippet">${esc(f.snippet)}</pre>`) : ''}
    ${f.reproduction ? part('Reproduction', `<pre class="snippet">${esc(f.reproduction)}</pre>`) : ''}
    ${part('Not confirmed', paras(f.unconfirmed), 'note')}
    ${part('Suppressed because', paras(f.suppressed_reason), 'note')}
    ${part('Resolution', paras(f.resolution), 'note')}
  </div>
  <div class="f-foot"><span class="fp">fingerprint ${esc(f.fingerprint)}${f.commit ? ` · commit ${esc(String(f.commit).slice(0, 10))}` : ''}</span><span class="links"><a class="back" href="#${typeAnchor(f.category)}">↑ ${esc(categoryLabel(f.category))}</a><a class="back" href="#index">↑ Index</a></span></div>
</article>`;
}

function details(m: ReportModel): string {
  return m.byType
    .map(
      (t) => `
<section class="type" id="${t.anchor}">
  <div class="type-head"><h2>${esc(t.label)}</h2><span class="count">${t.total} ${t.total === 1 ? 'finding' : 'findings'}</span><a class="back" href="#summary">↑ Summary</a></div>
  <p class="type-about">${esc(t.about)}</p>
  ${t.severities
    .map(
      (g) => `
  <div class="sev-group" id="${g.anchor}" style="${sev(g.severity)}">
    <h3 class="sev-head"><span class="dot"></span>${esc(t.label)} · ${cap(g.severity)} <span class="count">· ${g.findings.length}</span></h3>
    <p class="sev-about">${esc(SEVERITY_ABOUT[g.severity])}</p>
    ${g.findings.map(finding).join('')}
  </div>`,
    )
    .join('')}
</section>`,
    )
    .join('');
}

export function buildHtmlReport(findings: ReportFinding[], options: { scope: string; repos?: ReportRepo[] }): string {
  const m = buildReportModel(findings, options);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>RepoScout findings · ${esc(m.title)}</title>
<style>${REPORT_STYLE}</style>
</head>
<body>
<div class="page">
  ${cover(m)}
  ${summary(m)}
  ${index(m)}
  ${details(m)}
  <footer class="end">Generated by RepoScout from the audit history. "Reproduced by a test" marks the findings a test demonstrated. A fingerprint identifies a finding across runs; it is what <code>suppressed</code> in repos.yaml refers to.</footer>
</div>
</body>
</html>`;
}
