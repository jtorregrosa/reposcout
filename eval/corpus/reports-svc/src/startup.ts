import type { Db } from './db';

interface FeatureFlag {
  name: string;
  enabled: number;
}

// Read once when the process starts. The table holds the dozen flags product has defined; editing one needs a
// restart, which is the documented way to roll a flag out.
export async function loadFeatureFlags(db: Db): Promise<ReadonlyMap<string, boolean>> {
  const rows = await db.query<FeatureFlag>('SELECT name, enabled FROM feature_flags');
  return new Map(rows.map((r) => [r.name, r.enabled === 1]));
}
