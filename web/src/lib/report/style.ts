// The downloaded report's own stylesheet. It is a standalone document opened from disk, so its tokens live here,
// in its :root, rather than in the dashboard's theme.
export const REPORT_STYLE = `
:root {
  --bg: #f5f6f8; --paper: #ffffff; --ink: #1a1d24; --muted: #5d6573; --faint: #8a919d; --line: #e3e6eb; --soft: #f1f3f6;
  --accent: #2f5bd3; --code-bg: #f3f5f8; --fix-bg: #eef3fd; --ok: #2f855a;
  --mark-hat: #2f5bd3; --mark-dents: #2448ae; --mark-band: #b8a06a; --mark-face: #1a1d24;
  --critical: #a51d1d; --high: #c2410c; --medium: #a86f00; --low: #5b6474;
  --radius: 10px; --mono: ui-monospace, "Cascadia Code", "SF Mono", Consolas, monospace;
  --prose: 72ch;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0f1115; --paper: #171a20; --ink: #e6e8ed; --muted: #a0a8b6; --faint: #7a8291; --line: #2a2f38; --soft: #1e222a;
    --accent: #8aa6ff; --code-bg: #12151b; --fix-bg: #18213a; --ok: #68d391;
    --mark-hat: #5b7fe6; --mark-dents: #3f64cf; --mark-band: #c9b37e; --mark-face: #e6e8ed;
    --critical: #f87171; --high: #fb923c; --medium: #facc15; --low: #a3acba;
    color-scheme: dark;
  }
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; scroll-behavior: smooth; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 15px/1.65 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
.page { max-width: 1000px; margin: 0 auto; padding: 48px 28px 96px; }
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
code, pre, .mono { font-family: var(--mono); font-variant-ligatures: none; }
code { font-size: .88em; background: var(--code-bg); border: 1px solid var(--line); border-radius: 4px; padding: .05em .35em; overflow-wrap: anywhere; }
h1, h2, h3 { line-height: 1.25; letter-spacing: -.01em; }

/* Cover */
.cover { padding-bottom: 28px; border-bottom: 1px solid var(--line); }
.brand { display: flex; align-items: center; gap: 10px; }
.brand svg { width: 32px; height: 32px; flex: none; }
.eyebrow { text-transform: uppercase; letter-spacing: .14em; font-size: 12px; font-weight: 700; color: var(--accent); }
.cover h1 { font-size: 36px; margin: 8px 0 4px; }
.cover .subtitle { font-size: 18px; color: var(--muted); margin: 0 0 18px; }
.meta { display: grid; grid-template-columns: max-content 1fr; gap: 4px 20px; font-size: 14px; margin: 0; }
.meta dt { color: var(--muted); }
.meta dd { margin: 0; }

/* Sections */
section.block { margin-top: 48px; }
section.block > h2 { font-size: 22px; margin: 0 0 6px; }
section.block > .lead { color: var(--muted); margin: 0 0 20px; max-width: var(--prose); }
.panel { background: var(--paper); border: 1px solid var(--line); border-radius: var(--radius); padding: 20px 24px; }

/* Summary */
.kpis { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 12px; margin-bottom: 20px; }
.kpi { background: var(--paper); border: 1px solid var(--line); border-top: 3px solid var(--c, var(--accent)); border-radius: var(--radius); padding: 14px 16px; }
.kpi .n { font-size: 30px; font-weight: 750; line-height: 1.1; font-variant-numeric: tabular-nums; }
.kpi .l { font-size: 12px; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); margin-top: 4px; }
.summary-grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; }
.panel h3 { font-size: 13px; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); margin: 0 0 12px; }

table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
th { font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); font-weight: 600; text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--line); }
td { padding: 9px 10px; border-bottom: 1px solid var(--line); vertical-align: top; }
tr:last-child td { border-bottom: 0; }
th.num, td.num { text-align: right; }
td.zero { color: var(--faint); }
tfoot td { font-weight: 700; border-top: 2px solid var(--line); border-bottom: 0; }
.dot { width: 9px; height: 9px; border-radius: 50%; display: inline-block; background: var(--c); margin-right: 6px; vertical-align: 1px; }

/* Index */
.index td { font-size: 14px; }
.index .id { font-family: var(--mono); font-size: 13px; white-space: nowrap; }
.index .loc { font-family: var(--mono); font-size: 12px; color: var(--muted); overflow-wrap: anywhere; }
.index .type { white-space: nowrap; color: var(--muted); }
.pill { display: inline-block; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .07em; color: var(--c); border: 1px solid var(--c); border-radius: 999px; padding: 1px 8px; white-space: nowrap; }

/* Types */
.kinds { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: -4px 0 20px; }
.kinds-label { font-size: 12px; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); margin-right: 4px; }
.tag { display: inline-block; font-size: 12px; font-weight: 600; color: var(--muted); border: 1px solid var(--line); border-radius: 6px; padding: 0 7px; white-space: nowrap; }
.tag.vulnerability { color: var(--critical); border-color: var(--critical); }
.tag.bug { color: var(--high); border-color: var(--high); }
.tag.personal { color: var(--accent); border-color: var(--accent); }

/* Sections by category */
.type-nav { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 20px; }
.type-card { display: grid; gap: 4px; background: var(--paper); border: 1px solid var(--line); border-radius: var(--radius); padding: 14px 16px; color: var(--ink); }
.type-name { font-weight: 700; font-size: 16px; color: var(--accent); }
.type-total { font-size: 13px; color: var(--muted); }
.type-sevs { display: flex; flex-wrap: wrap; gap: 4px 12px; font-size: 12.5px; margin-top: 4px; }
.type-sevs a { color: var(--muted); }
.type-sevs a:hover { color: var(--accent); }
.matrix a { display: block; color: var(--accent); }
.matrix td.num a { text-decoration: underline; text-decoration-color: var(--line); text-underline-offset: 3px; }
.matrix td.num a:hover { text-decoration-color: var(--accent); }
.index tr.group td { background: var(--soft); font-weight: 700; padding-top: 12px; }
.index tr.group .count { color: var(--muted); font-weight: 400; }
section.type { margin-top: 64px; scroll-margin-top: 16px; }
.type-head { display: flex; align-items: baseline; gap: 12px; padding-bottom: 10px; border-bottom: 3px solid var(--ink); }
.type-head h2 { font-size: 28px; margin: 0; }
.type-head .count { color: var(--muted); }
.type-head .back { margin-left: auto; font-size: 13px; }
.type-about { color: var(--muted); margin: 10px 0 8px; max-width: var(--prose); }
.sev-group { margin-top: 28px; scroll-margin-top: 16px; }
.sev-head { display: flex; align-items: center; gap: 8px; font-size: 14px; text-transform: uppercase; letter-spacing: .1em; color: var(--c); margin: 0; padding-bottom: 6px; border-bottom: 1px solid var(--line); }
.sev-head .count { color: var(--muted); letter-spacing: normal; }
.sev-about { color: var(--muted); font-size: 13.5px; margin: 8px 0 16px; max-width: var(--prose); }

/* A finding */
article.finding { background: var(--paper); border: 1px solid var(--line); border-left: 5px solid var(--c); border-radius: var(--radius); margin: 0 0 28px; overflow: hidden; }
.f-head { padding: 18px 24px 16px; border-bottom: 1px solid var(--line); }
.f-kicker { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; font-size: 13px; color: var(--muted); }
.f-kicker .id { font-family: var(--mono); font-weight: 700; color: var(--ink); }
.f-head h3 { font-size: 20px; margin: 8px 0 0; }
.facts { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px 20px; margin: 0; padding: 16px 24px; background: var(--soft); border-bottom: 1px solid var(--line); font-size: 13.5px; }
.facts div { min-width: 0; }
.facts dt { font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); margin-bottom: 2px; }
.facts dd { margin: 0; overflow-wrap: anywhere; }
.facts .wide { grid-column: span 2; }
.facts .path { font-family: var(--mono); font-size: 12.5px; }
.facts .path b { font-weight: 700; }
.f-body { padding: 20px 24px 8px; }
.part { display: grid; grid-template-columns: 150px minmax(0, 1fr); gap: 4px 24px; margin-bottom: 18px; }
.part > h4 { margin: 2px 0 0; font-size: 12px; text-transform: uppercase; letter-spacing: .09em; color: var(--muted); }
.part > div { max-width: var(--prose); }
.part p { margin: 0 0 10px; }
.part p:last-child { margin-bottom: 0; }
.part.fix > div { background: var(--fix-bg); border-radius: 8px; padding: 12px 16px; max-width: none; }
.part.fix > h4 { color: var(--accent); }
.part.note > div { border-left: 3px solid var(--line); padding-left: 14px; color: var(--muted); }
.repro .r-label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); margin: 0 0 4px; }
.repro ul, .repro ol { margin: 0 0 12px; padding-left: 22px; }
.repro li { margin-bottom: 4px; }
.repro ol li::marker { font-weight: 700; color: var(--muted); }
.outcome { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.outcome > div { border-radius: 8px; padding: 10px 12px; border: 1px solid var(--line); }
.outcome .expected { border-left: 3px solid var(--ok); }
.outcome .actual { border-left: 3px solid var(--critical); }
.outcome p { margin: 0 0 6px; }
.outcome p:last-child { margin: 0; }
pre.snippet { margin: 0; background: var(--code-bg); border: 1px solid var(--line); border-radius: 8px; padding: 12px 14px; font-size: 12.5px; line-height: 1.55; white-space: pre-wrap; overflow-wrap: anywhere; }
.f-foot { display: flex; justify-content: space-between; gap: 12px; padding: 10px 24px 14px; font-size: 12px; color: var(--faint); }
.f-foot .fp { font-family: var(--mono); overflow-wrap: anywhere; }
.f-foot .links { display: flex; gap: 14px; white-space: nowrap; }
footer.end { margin-top: 56px; color: var(--muted); font-size: 13px; border-top: 1px solid var(--line); padding-top: 14px; max-width: var(--prose); }

@media (min-width: 860px) {
  .summary-grid.two { grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); }
}
@media (max-width: 760px) {
  .page { padding: 28px 16px 56px; }
  .cover h1 { font-size: 28px; }
  .kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .kpis .kpi:first-child { grid-column: 1 / -1; }
  .facts { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .outcome { grid-template-columns: minmax(0, 1fr); }
  .part { grid-template-columns: minmax(0, 1fr); }
  .index .loc, .index .type { display: none; }
}

@media print {
  :root {
    --bg: #ffffff; --paper: #ffffff; --ink: #111111; --muted: #4f5662; --faint: #6b7280; --line: #d6dae0; --soft: #f4f5f7; --code-bg: #f6f7f9; --fix-bg: #f0f4fc;
    --accent: #2447b0; --ok: #276749; --critical: #9b1c1c; --high: #b9400c; --medium: #8a5d00; --low: #4f5662; color-scheme: light;
    --mark-hat: #2f5bd3; --mark-dents: #2448ae; --mark-band: #b8a06a; --mark-face: #1a1d24;
  }
  @page { margin: 16mm 14mm; }
  body { font-size: 10.5pt; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .page { max-width: none; padding: 0; }
  .back { display: none; }
  section.type { break-before: page; margin-top: 0; }
  .sev-head { break-after: avoid; }
  .type-card { break-inside: avoid; }
  .f-head, .facts, .part, .kpis, .panel { break-inside: avoid; }
  article.finding { break-inside: auto; }
  a { color: inherit; }
}
`;
