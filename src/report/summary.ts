import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ANALYZERS, type Analyzer, type Mode } from '../config/analyzers.js';
import type { ClosedFinding } from '../findings/classify.js';
import { type Discard, type Finding, type Rejection, SEVERITY_RANK, type Severity } from '../findings/types.js';
import type { Failures, RepoReport } from './types.js';

interface Located {
  severity: Severity;
  file: string;
  line: number;
}

const bySeverity = (a: Located, b: Located) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.file.localeCompare(b.file) || a.line - b.line;
const cell = (s: unknown) =>
  String(s ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, ' ');

type ReportFinding = RepoReport['findings'][number];

// One repository's day: every run and sweep pass it had that day, so a pass that found something is not hidden by
// a later one that found nothing.
export interface RepoDay {
  repo: string;
  branch: string;
  // The latest run's commit, and the commit the first run started from.
  commit: string;
  previous_commit: string | null;
  modes: Mode[];
  runs: number;
  analyzers: Analyzer[];
  // Summed over the runs; a sweep's passes audit different files.
  files: number;
  omitted: number;
  fresh: ReportFinding[];
  resolved: ClosedFinding[];
  // Open findings an audit saw again today without reporting them as new.
  seen_again: number;
  // As of the latest run.
  open_total: number;
  speculative_new: Finding[];
  speculative_total: number;
  refuted: ClosedFinding[];
  speculative_unreviewed: string[];
  suppressed: number;
  read: { selected: number; read: number; unread: number };
  discarded: Discard[];
  rejected: Rejection[];
  turns: number | null;
  subagent_runs: number | null;
  seconds: number;
  // Why the latest run could not reproduce anything with a test, or null when it could (or did not say).
  verification_off: string | null;
}

// Union by fingerprint; the latest occurrence wins, in the order it was first seen.
function union<T extends { fingerprint: string }>(lists: T[][]): T[] {
  const out = new Map<string, T>();
  for (const f of lists.flat()) out.set(f.fingerprint, f);
  return [...out.values()];
}

const sumOrNull = (values: (number | null | undefined)[]) => (values.every((v) => v == null) ? null : values.reduce<number>((s, v) => s + (v ?? 0), 0));

// reports: one repository's reports of the day, oldest first.
export function aggregateDay(reports: RepoReport[]): RepoDay {
  const first = reports[0] as RepoReport;
  const last = reports.at(-1) as RepoReport;
  const all = <T>(pick: (r: RepoReport) => T[] | undefined) => reports.map((r) => pick(r) ?? []);
  const fresh = union(all((r) => r.findings.filter((f) => f.status === 'new')));
  const freshFps = new Set(fresh.map((f) => f.fingerprint));
  const existing = union(all((r) => r.findings.filter((f) => f.status === 'existing'))).filter((f) => !freshFps.has(f.fingerprint));
  return {
    repo: last.repo,
    branch: last.branch,
    commit: last.commit,
    previous_commit: first.previous_commit,
    modes: [...new Set(reports.map((r) => r.mode))],
    runs: reports.length,
    analyzers: ANALYZERS.filter((a) => reports.some((r) => r.analyzers?.includes(a))),
    files: reports.reduce((s, r) => s + r.audited_files.length, 0),
    omitted: last.omitted_files_count,
    fresh,
    resolved: union(all((r) => r.resolved)),
    seen_again: existing.length + reports.reduce((s, r) => s + (r.confirmed_known ?? 0), 0),
    open_total: last.open_total,
    speculative_new: union(all((r) => r.speculative_new)),
    speculative_total: last.speculative_total ?? 0,
    refuted: union(all((r) => r.refuted)),
    speculative_unreviewed: last.speculative_unreviewed ?? [],
    suppressed: last.suppressed_count,
    read: {
      selected: reports.reduce((s, r) => s + (r.read_coverage?.selected ?? 0), 0),
      read: reports.reduce((s, r) => s + (r.read_coverage?.read ?? 0), 0),
      unread: reports.reduce((s, r) => s + (r.read_coverage?.unread?.length ?? 0), 0),
    },
    discarded: reports.flatMap((r) => r.discarded ?? []),
    rejected: reports.flatMap((r) => r.rejected ?? []),
    turns: sumOrNull(reports.map((r) => r.usage?.num_turns)),
    subagent_runs: sumOrNull(reports.map((r) => r.usage?.subagent_runs)),
    seconds: Math.round(reports.reduce((s, r) => s + (r.usage?.wall_ms ?? r.usage?.duration_ms ?? 0), 0) / 1000),
    verification_off: last.verification?.enabled === false ? (last.verification.reason ?? 'disabled') : null,
  };
}

// Every report of the day grouped by repository, each group oldest first.
export function aggregateReports(reports: RepoReport[]): RepoDay[] {
  const byRepo = new Map<string, RepoReport[]>();
  for (const r of reports) byRepo.set(r.repo, [...(byRepo.get(r.repo) ?? []), r]);
  return [...byRepo.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, rs]) => aggregateDay([...rs].sort((a, b) => a.generated_at.localeCompare(b.generated_at) || a.run_id.localeCompare(b.run_id))));
}

function findingRows(findings: ReportFinding[]): string[] {
  return [...findings]
    .sort(bySeverity)
    .map(
      (f) =>
        `| ${f.severity} | ${f.category} | \`${cell(f.file)}:${f.line}\` | ${cell(f.title)}${f.reopened ? ' (reopened)' : ''} | ${f.confidence}${f.verified ? ', verified' : ''} |`,
    );
}

function details(f: ReportFinding): string {
  return [
    `#### ${cell(f.title)}`,
    '',
    `\`${f.file}:${f.line}\` · ${f.severity} · ${f.category} · confidence ${f.confidence} · fingerprint \`${f.fingerprint}\`${f.reopened ? ` · reopened, first seen ${f.first_seen}` : ''}`,
    '',
    `**Scenario.** ${f.scenario}`,
    '',
    `**Why it is a bug.** ${f.description}`,
    '',
    `**Suggested fix.** ${f.suggested_fix}`,
    '',
  ].join('\n');
}

const modeOf = (d: RepoDay) => d.modes.join(' + ');

function repoSection(d: RepoDay): string {
  const out = [`## ${d.repo}`, ''];
  const analyzers = d.analyzers.length < ANALYZERS.length ? ` · analyzers ${d.analyzers.join(', ')}` : '';
  const since = d.previous_commit ? ` · since \`${d.previous_commit.slice(0, 10)}\`` : '';
  const runs = d.runs > 1 ? ` · ${d.runs} runs` : '';
  const capped = d.omitted ? `, ${d.omitted} over the cap` : '';
  out.push(`\`${d.branch}\` @ \`${d.commit.slice(0, 10)}\` · mode ${modeOf(d)}${runs}${analyzers}${since} · ${d.files} files audited${capped}`, '');
  const reopened = d.fresh.filter((f) => f.reopened).length;
  out.push(
    `**${d.fresh.length} new**${reopened ? ` (${reopened} reopened)` : ''}, **${d.resolved.length} resolved**, ${d.open_total} open in total (${d.seen_again} of them seen again today; open findings are not repeated here), **${d.speculative_new.length} new speculative** (${d.speculative_total} in total)${d.refuted.length ? `, ${d.refuted.length} refuted` : ''}, ${d.discarded.length} discarded by the verifier, ${d.rejected.length} rejected by validation${d.suppressed ? `, ${d.suppressed} suppressed` : ''}.`,
    '',
  );
  if (d.verification_off) {
    out.push(`> **Verification is off** (${d.verification_off}): no finding here was reproduced by a test; each was confirmed from the code only.`, '');
  }
  if (d.fresh.length) {
    out.push('### New', '', '| Severity | Category | Location | Title | Confidence |', '| --- | --- | --- | --- | --- |', ...findingRows(d.fresh), '');
    out.push(...[...d.fresh].sort(bySeverity).map(details));
  }
  if (d.speculative_new.length) {
    out.push(
      '### New speculative',
      '',
      'Plausible but unconfirmed. `--mode speculative` re-examines them.',
      '',
      '| Severity if real | Category | Location | Title | Unconfirmed |',
      '| --- | --- | --- | --- | --- |',
    );
    out.push(
      ...[...d.speculative_new]
        .sort(bySeverity)
        .map((f) => `| ${f.severity} | ${f.category} | \`${cell(f.file)}:${f.line}\` | ${cell(f.title)} | ${cell(f.unconfirmed ?? '')} |`),
      '',
    );
  }
  if (d.refuted.length) {
    out.push('### Refuted or duplicate', '', '| Outcome | Category | Location | Title | Why |', '| --- | --- | --- | --- | --- |');
    out.push(...d.refuted.map((f) => `| ${f.status} | ${f.category} | \`${cell(f.file)}:${f.line}\` | ${cell(f.title)} | ${cell(f.resolution)} |`), '');
  }
  if (d.speculative_unreviewed.length) {
    out.push(
      `The verifier gave no verdict for ${d.speculative_unreviewed.length} speculative candidates; they stay speculative: ${d.speculative_unreviewed.map((f) => `\`${f}\``).join(', ')}.`,
      '',
    );
  }
  if (d.read.unread) {
    out.push(`Files opened by a specialist: ${d.read.read} of ${d.read.selected}. The rest are queued again for the next run.`, '');
  }
  if (d.discarded.length) {
    out.push(
      `<details><summary>Discarded by the verifier (${d.discarded.length}): review if a title looks real</summary>`,
      '',
      '| Reason | File | Title | Proposed by |',
      '| --- | --- | --- | --- |',
    );
    out.push(
      ...d.discarded.map(
        (x) => `| ${cell(x.reason)} | \`${cell(x.file)}\` | ${cell(x.title)} | ${cell(Array.isArray(x.specialists) ? x.specialists.join(', ') : '')} |`,
      ),
      '',
      '</details>',
      '',
    );
  }
  if (d.resolved.length) {
    out.push('### Resolved', '', '| Severity | Category | Location | Title | Resolution |', '| --- | --- | --- | --- | --- |');
    out.push(
      ...[...d.resolved]
        .sort(bySeverity)
        .map((f) => `| ${f.severity} | ${f.category} | \`${cell(f.file)}:${f.line}\` | ${cell(f.title)} | ${cell(f.resolution)} |`),
      '',
    );
  }
  return out.join('\n');
}

export function renderSummary(date: string, reports: RepoReport[], failures: Failures): string {
  const days = aggregateReports(reports);
  const lines = [`# RepoScout summary, ${date}`, ''];
  lines.push(
    "Only new and resolved findings are listed, across all of the day's runs. The full set, including findings still open, is in each `<repo>.json`.",
    '',
  );
  lines.push(
    '| Repository | Mode | Runs | Commit | Files | New | Resolved | Open | Orchestrator turns | Subagent runs | Duration |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  );
  for (const d of days) {
    lines.push(
      `| ${d.repo} | ${modeOf(d)} | ${d.runs} | \`${d.commit.slice(0, 10)}\` | ${d.files} | ${d.fresh.length} | ${d.resolved.length} | ${d.open_total} | ${d.turns ?? '?'} | ${d.subagent_runs ?? '?'} | ${d.seconds} s |`,
    );
  }
  for (const [repo, f] of Object.entries(failures))
    lines.push(`| ${repo} | ${f.deferred ? 'deferred' : 'failed'} | | | | | | | | | ${cell(f.error).slice(0, 120)} |`);
  lines.push('');
  for (const d of days) lines.push(repoSection(d));
  return `${lines.join('\n').trim()}\n`;
}

// reports: every report of the day, as the store lists them.
export function writeSummary(dateDir: string, date: string, reports: RepoReport[], failures: Failures): void {
  writeFileSync(join(dateDir, 'summary.md'), renderSummary(date, reports, failures));
}
