import { appendFileSync, mkdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ExitCode } from '../errors.js';
import { writeJson } from '../fs.js';
import { layout, ROOT } from '../paths.js';
import { openStore, Store } from '../store/index.js';
import { importLegacy } from '../store/legacy.js';

const count = (store: Store, sql: string) => store.db.prepare(sql).pluck().get() as number;

export function dbInfoCommand(): ExitCode {
  const paths = layout();
  const store = openStore(paths);
  const size = (f: string) => {
    try {
      return statSync(f).size;
    } catch {
      return 0;
    }
  };
  const statuses = store.db.prepare('SELECT status, COUNT(*) AS n FROM findings GROUP BY status ORDER BY n DESC').all() as { status: string; n: number }[];
  const lines = [
    `database        ${paths.dbFile}`,
    `size            ${((size(paths.dbFile) + size(`${paths.dbFile}-wal`)) / 1024 / 1024).toFixed(1)} MB`,
    `schema version  ${store.schemaVersion}`,
    `imported JSON   ${store.getMeta('legacy_json_imported_at') ?? 'no'}`,
    `repositories    ${count(store, 'SELECT COUNT(*) FROM repos')}`,
    `findings        ${count(store, 'SELECT COUNT(*) FROM findings')} (${statuses.map((s) => `${s.n} ${s.status}`).join(', ') || 'none'})`,
    `history events  ${count(store, 'SELECT COUNT(*) FROM finding_events')}`,
    `reports         ${count(store, 'SELECT COUNT(*) FROM reports')}`,
    `usage rows      ${count(store, 'SELECT COUNT(*) FROM usage')}`,
    `analyzer yield  ${count(store, 'SELECT COUNT(*) FROM analyzer_yield')} rows`,
  ];
  console.log(lines.join('\n'));
  return ExitCode.Ok;
}

export function dbImportCommand(): ExitCode {
  const paths = layout();
  const store = new Store(paths.dbFile);
  try {
    if (store.repoNames().length) {
      console.error('reposcout: the database already holds state; importing again would duplicate usage and history. Nothing was changed.');
      return ExitCode.Failed;
    }
    const summary = importLegacy(store, paths);
    console.log(
      `Imported ${summary.repos} repositories, ${summary.findings} findings, ${summary.reports} reports, ${summary.usage} usage rows and ${summary.failures} failures into ${paths.dbFile}.`,
    );
    return ExitCode.Ok;
  } finally {
    store.close();
  }
}

// Writes the state back out in the JSON shape RepoScout used before SQLite, plus each finding's history: readable,
// diffable, and importable again into an empty database.
export function dbExportCommand({ out }: { out?: string }): ExitCode {
  const paths = layout();
  const store = openStore(paths);
  const dir = resolve(ROOT, out ?? join('exports', new Date().toISOString().replace(/[:.]/g, '-')));
  const stateDir = join(dir, 'state');
  mkdirSync(stateDir, { recursive: true });
  for (const repo of store.repoNames()) {
    const state = store.readRepoState(repo);
    if (state) writeJson(join(stateDir, `${repo}.json`), state);
  }
  writeJson(join(stateDir, 'census.json'), store.census());
  const usage = join(stateDir, 'usage.jsonl');
  for (const row of store.usage(Number.MAX_SAFE_INTEGER)) appendFileSync(usage, `${JSON.stringify(row)}\n`);
  const events = store.db.prepare('SELECT repo, fingerprint, at, run_id, from_status, to_status, note FROM finding_events ORDER BY id').all();
  writeJson(join(dir, 'finding-history.json'), events);
  writeJson(join(dir, 'analyzer-yield.json'), store.yields(Number.MAX_SAFE_INTEGER));
  console.log(`Exported ${store.repoNames().length} repositories and ${events.length} history events to ${dir}`);
  return ExitCode.Ok;
}
