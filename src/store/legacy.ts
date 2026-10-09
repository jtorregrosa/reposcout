import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { FindingEntry } from '../findings/types.js';
import { parseJsonLines, readJsonOrNull } from '../fs.js';
import type { Layout } from '../paths.js';
import { type Failures, REPORT_SCHEMA, type RepoReport } from '../report/types.js';
import { auditsByAnalyzer } from '../state/coverage.js';
import type { Census, RepoState, UsageRow } from '../state/types.js';
import type { Store } from './store.js';

const IMPORTED = 'legacy_json_imported_at';
const DATE_DIR = /^\d{4}-\d{2}-\d{2}$/;
const STATE_FILE = /^(?!census\.json$)(.+)\.json$/;

export interface ImportSummary {
  repos: number;
  findings: number;
  usage: number;
  reports: number;
  failures: number;
}

const hasLegacy = (layout: Layout) =>
  existsSync(layout.stateDir) && readdirSync(layout.stateDir).some((f) => STATE_FILE.test(f) || f === 'usage.jsonl' || f === 'census.json');

// The history a JSON state can still tell: when a finding appeared, and how it ended if it did.
function legacyEvents(entry: FindingEntry): { at: string; from: string | null; to: string; note: string | null }[] {
  const initial = entry.status === 'speculative' || entry.status === 'refuted' ? 'speculative' : 'open';
  const events: { at: string; from: string | null; to: string; note: string | null }[] = [{ at: entry.first_seen, from: null, to: initial, note: null }];
  if (entry.status !== initial) {
    events.push({
      at: entry.resolved_at ?? entry.refuted_at ?? entry.last_seen,
      from: initial,
      to: entry.status,
      note: entry.resolution ?? entry.reason ?? null,
    });
  }
  return events;
}

function importState(store: Store, layout: Layout, summary: ImportSummary): void {
  for (const file of readdirSync(layout.stateDir)) {
    const m = STATE_FILE.exec(file);
    if (!m) continue;
    const raw = readJsonOrNull<RepoState>(join(layout.stateDir, file));
    if (!raw?.findings) continue;
    const name = raw.repo ?? (m[1] as string);
    // Older state kept one audit map for every analyzer; it is split per analyzer on the way in.
    const { file_audits: _legacy, ...rest } = raw;
    const state: RepoState = { ...rest, repo: name, branch: raw.branch ?? 'main', file_audits_by_analyzer: auditsByAnalyzer(raw) };
    store.writeRepoState(name, state, { runId: null, at: raw.last_run_at ?? new Date().toISOString() });
    // writeRepoState recorded each finding as appearing at the import; replace that with what the JSON knew.
    store.db.prepare('DELETE FROM finding_events WHERE repo = ?').run(name);
    const event = store.db.prepare('INSERT INTO finding_events (repo, fingerprint, at, run_id, from_status, to_status, note) VALUES (?, ?, ?, NULL, ?, ?, ?)');
    for (const [fingerprint, entry] of Object.entries(state.findings)) {
      for (const e of legacyEvents(entry)) event.run(name, fingerprint, e.at, e.from, e.to, e.note);
      summary.findings++;
    }
    summary.repos++;
  }
}

function importReports(store: Store, layout: Layout, summary: ImportSummary): void {
  if (!existsSync(layout.reportsDir)) return;
  for (const date of readdirSync(layout.reportsDir)
    .filter((d) => DATE_DIR.test(d))
    .sort()) {
    const dateDir = join(layout.reportsDir, date);
    const add = (path: string, runFallback: string) => {
      const r = readJsonOrNull<Partial<RepoReport>>(path);
      if (r?.schema !== REPORT_SCHEMA) return;
      const report = {
        ...r,
        repo: r.repo ?? basename(path, '.json'),
        run_id: r.run_id ?? runFallback,
        generated_at: r.generated_at ?? `${date}T00:00:00.000Z`,
      } as RepoReport;
      store.saveReport(report, date);
      summary.reports++;
    };
    const runsDir = join(dateDir, 'runs');
    if (existsSync(runsDir)) {
      for (const run of readdirSync(runsDir))
        for (const f of readdirSync(join(runsDir, run)).filter((x) => x.endsWith('.json'))) add(join(runsDir, run, f), run);
    }
    // The day's latest report, which older versions wrote without a per-run copy.
    for (const f of readdirSync(dateDir).filter((x) => x.endsWith('.json') && x !== 'failures.json')) {
      const r = readJsonOrNull<Partial<RepoReport>>(join(dateDir, f));
      const exists = r?.run_id && store.db.prepare('SELECT 1 FROM reports WHERE run_id = ? AND repo = ?').get(r.run_id, r.repo ?? basename(f, '.json'));
      if (!exists) add(join(dateDir, f), `legacy-${date}`);
    }
    const failures = readJsonOrNull<Failures>(join(dateDir, 'failures.json'));
    if (failures && Object.keys(failures).length) {
      store.replaceFailures(date, failures);
      summary.failures += Object.keys(failures).length;
    }
  }
}

export function importLegacy(store: Store, layout: Layout): ImportSummary {
  const summary: ImportSummary = { repos: 0, findings: 0, usage: 0, reports: 0, failures: 0 };
  store.transaction(() => {
    if (existsSync(layout.stateDir)) importState(store, layout, summary);
    const census = readJsonOrNull<Census>(layout.legacyCensusFile) ?? {};
    for (const [repo, c] of Object.entries(census)) store.recordCensus(repo, c);
    if (existsSync(layout.legacyUsageFile)) {
      for (const row of parseJsonLines<UsageRow>(readFileSync(layout.legacyUsageFile, 'utf8'))) {
        store.appendUsage(row);
        summary.usage++;
      }
    }
    importReports(store, layout, summary);
    store.setMeta(IMPORTED, new Date().toISOString());
  });
  return summary;
}

// The JSON files are read once, into a database that has never been written. They are left where they are.
export function importLegacyOnce(store: Store, layout: Layout): ImportSummary | null {
  if (store.getMeta(IMPORTED) || store.repoNames().length || !hasLegacy(layout)) return null;
  return importLegacy(store, layout);
}
