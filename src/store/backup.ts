import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeJson } from '../fs.js';
import type { Decision } from '../state/types.js';
import type { Snapshot, Store } from './store.js';

// The export format is versioned apart from the schema, so an export restores into a newer RepoScout.
export const EXPORT_FORMAT = 'reposcout/export@1';

interface Manifest {
  format: string;
  schema_version: number;
  exported_at: string;
  repositories: string[];
}

export interface ExportSummary {
  repos: number;
  history: number;
}

export interface RestoreSummary {
  repos: number;
  findings: number;
  history: number;
  decisions: number;
  labels: number;
  reports: number;
  usage: number;
  failures: number;
}

export class ExportFormatError extends Error {
  override name = 'ExportFormatError';
}

const jsonLines = (rows: unknown[]) => rows.map((r) => `${JSON.stringify(r)}\n`).join('');

export function writeExport(store: Store, dir: string, at = new Date().toISOString()): ExportSummary {
  const s = store.snapshot();
  const manifest: Manifest = { format: EXPORT_FORMAT, schema_version: s.schemaVersion, exported_at: at, repositories: s.states.map((st) => st.repo) };
  const stateDir = join(dir, 'state');
  mkdirSync(stateDir, { recursive: true });
  for (const state of s.states) writeJson(join(stateDir, `${state.repo}.json`), state);
  writeJson(join(stateDir, 'census.json'), s.census);
  writeFileSync(join(stateDir, 'usage.jsonl'), jsonLines(s.usage));
  writeJson(join(dir, 'finding-history.json'), s.history);
  writeJson(join(dir, 'finding-stages.json'), s.stages);
  writeJson(join(dir, 'decisions.json'), s.decisions);
  writeJson(join(dir, 'labels.json'), s.labels);
  writeJson(join(dir, 'analyzer-yield.json'), s.yields);
  writeFileSync(join(dir, 'reports.jsonl'), jsonLines(s.reports));
  writeJson(join(dir, 'failures.json'), s.failures);
  // Last, so a directory with a manifest is a complete export.
  writeJson(join(dir, 'manifest.json'), manifest);
  return { repos: s.states.length, history: s.history.length };
}

// Strict, unlike the readers for files a run writes: a restore that skipped a bad line would lose data silently.
function read<T>(dir: string, file: string): T {
  return JSON.parse(readFileSync(join(dir, file), 'utf8')) as T;
}

function readLines<T>(dir: string, file: string): T[] {
  return readFileSync(join(dir, file), 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as T);
}

function readManifest(dir: string): Manifest {
  const path = join(dir, 'manifest.json');
  let manifest: Partial<Manifest> | null = null;
  try {
    manifest = existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as Partial<Manifest>) : null;
  } catch {
    manifest = null;
  }
  if (manifest?.format !== EXPORT_FORMAT || !Array.isArray(manifest.repositories)) {
    throw new ExportFormatError(`${dir} is not a ${EXPORT_FORMAT} export: its manifest.json is missing or names another format.`);
  }
  return manifest as Manifest;
}

const groupBy = <T>(rows: T[], key: (row: T) => string) => {
  const out = new Map<string, T[]>();
  for (const r of rows) out.set(key(r), [...(out.get(key(r)) ?? []), r]);
  return out;
};

// Into an empty database, all or nothing. Decisions and labels go in before the state, which re-applies them.
export function restoreExport(store: Store, dir: string): RestoreSummary {
  const manifest = readManifest(dir);
  return store.transaction(() => {
    // An export from before decisions recorded their status holds only decisions on speculative candidates.
    const decisions = read<(Omit<Snapshot['decisions'][number], 'decided_on'> & Partial<Pick<Decision, 'decided_on'>>)[]>(dir, 'decisions.json');
    const labels = read<Snapshot['labels']>(dir, 'labels.json');
    for (const { repo, fingerprint, decided_on = 'speculative', ...d } of decisions) store.restoreDecision(repo, fingerprint, { ...d, decided_on });
    for (const { repo, fingerprint, ...o } of labels) store.restoreLabels(repo, fingerprint, o);

    const history = groupBy(read<Snapshot['history']>(dir, 'finding-history.json'), (e) => e.repo);
    const stages = groupBy(read<Snapshot['stages']>(dir, 'finding-stages.json'), (e) => e.repo);
    const summary: RestoreSummary = {
      repos: 0,
      findings: 0,
      history: 0,
      decisions: decisions.length,
      labels: labels.length,
      reports: 0,
      usage: 0,
      failures: 0,
    };
    for (const repo of manifest.repositories) {
      const state = read<Snapshot['states'][number]>(dir, join('state', `${repo}.json`));
      store.writeRepoState(repo, state, { runId: null, at: state.last_run_at ?? manifest.exported_at });
      store.restoreHistory(repo, history.get(repo) ?? []);
      store.restoreStages(repo, stages.get(repo) ?? []);
      summary.repos++;
      summary.findings += Object.keys(state.findings ?? {}).length;
      summary.history += history.get(repo)?.length ?? 0;
    }

    for (const [repo, c] of Object.entries(read<Snapshot['census']>(dir, join('state', 'census.json')))) store.recordCensus(repo, c);
    for (const row of readLines<Snapshot['usage'][number]>(dir, join('state', 'usage.jsonl'))) {
      store.appendUsage(row);
      summary.usage++;
    }
    for (const y of read<Snapshot['yields']>(dir, 'analyzer-yield.json')) {
      store.saveYield({ runId: y.run_id, repo: y.repo, at: y.at, mode: y.mode, promptVersion: y.prompt_version, model: y.model }, [y]);
    }
    for (const { date, report } of readLines<Snapshot['reports'][number]>(dir, 'reports.jsonl')) {
      store.saveReport(report, date);
      summary.reports++;
    }
    const failures = read<Snapshot['failures']>(dir, 'failures.json');
    for (const [date, rows] of groupBy(failures, (f) => f.date)) {
      store.replaceFailures(date, Object.fromEntries(rows.map((f) => [f.repo, { error: f.error, ...(f.deferred ? { deferred: true } : {}), at: f.at }])));
    }
    summary.failures = failures.length;
    store.setMeta('export_restored_at', new Date().toISOString());
    return summary;
  });
}
