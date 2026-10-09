import type { Layout } from '../paths.js';
import type { Logger } from '../telemetry/logger.js';
import { importLegacyOnce } from './legacy.js';
import { Store } from './store.js';

export type { DatedReport, PrecisionFact, WriteContext } from './store.js';
export { DecisionError, Store } from './store.js';

const open = new Map<string, Store>();

// One connection per database for the life of the process: the dashboard relies on it to notice other
// processes' commits, and a run never needs a second one.
export function openStore(layout: Layout, log?: Logger): Store {
  let store = open.get(layout.dbFile);
  if (store) return store;
  store = new Store(layout.dbFile);
  const imported = importLegacyOnce(store, layout);
  if (imported) log?.info('imported the JSON state into SQLite; the JSON files are left as they were', { db: layout.dbFile, ...imported });
  open.set(layout.dbFile, store);
  return store;
}

export function closeStores(): void {
  for (const store of open.values()) store.close();
  open.clear();
}
