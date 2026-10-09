import { statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ExitCode, errorMessage } from '../errors.js';
import { layout, ROOT } from '../paths.js';
import { restoreExport, writeExport } from '../store/backup.js';
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

export function dbImportCommand({ from }: { from?: string } = {}): ExitCode {
  const paths = layout();
  const store = new Store(paths.dbFile);
  try {
    if (store.repoNames().length) {
      console.error('reposcout: the database already holds state; importing again would duplicate usage and history. Nothing was changed.');
      return ExitCode.Failed;
    }
    if (from) {
      const dir = resolve(ROOT, from);
      const r = restoreExport(store, dir);
      console.log(
        `Restored ${r.repos} repositories, ${r.findings} findings, ${r.history} history events, ${r.decisions} decisions, ${r.labels} label corrections, ${r.reports} reports, ${r.usage} usage rows and ${r.failures} failures from ${dir} into ${paths.dbFile}.`,
      );
      return ExitCode.Ok;
    }
    const summary = importLegacy(store, paths);
    console.log(
      `Imported ${summary.repos} repositories, ${summary.findings} findings, ${summary.reports} reports, ${summary.usage} usage rows and ${summary.failures} failures into ${paths.dbFile}.`,
    );
    return ExitCode.Ok;
  } catch (e) {
    console.error(`reposcout: ${errorMessage(e)} Nothing was changed.`);
    return ExitCode.Failed;
  } finally {
    store.close();
  }
}

// Writes the database as JSON: readable, diffable, and restorable into an empty database with db import --from.
export function dbExportCommand({ out }: { out?: string }): ExitCode {
  const store = openStore(layout());
  const dir = resolve(ROOT, out ?? join('exports', new Date().toISOString().replace(/[:.]/g, '-')));
  const summary = writeExport(store, dir);
  console.log(`Exported ${summary.repos} repositories and ${summary.history} history events to ${dir}`);
  return ExitCode.Ok;
}
