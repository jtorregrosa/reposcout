import type { Db } from '../db';

const BATCH = 1_000;

// Nightly: removes expired password-reset tokens a batch at a time, so no single statement holds locks for long.
export async function purgeExpiredResetTokens(db: Db, now: Date): Promise<number> {
  let removed = 0;
  for (;;) {
    const expired = await db.query<{ id: string }>('SELECT id FROM reset_tokens WHERE expires_at < ? ORDER BY id LIMIT ?', [now.toISOString(), BATCH]);
    if (!expired.length) return removed;
    const ids = expired.map((r) => r.id);
    await db.query(`DELETE FROM reset_tokens WHERE id IN (${ids.map(() => '?').join(', ')})`, ids);
    removed += ids.length;
    if (ids.length < BATCH) return removed;
  }
}
