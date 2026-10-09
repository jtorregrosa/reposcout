export interface Pool {
  query(sql: string, params: unknown[]): Promise<unknown[]>;
}

export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
}

// Every statement goes through the driver with bound parameters; callers pass values, never SQL fragments.
export function createDb(pool: Pool): Db {
  return {
    async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      const rows = await pool.query(sql, params);
      return rows as T[];
    },
  };
}
