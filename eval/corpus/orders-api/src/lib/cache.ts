interface Entry {
  value: unknown;
  expires: number;
}

const entries = new Map<string, Entry>();

// Process-wide memoisation for read-mostly lookups.
export function remember<T>(key: string, ttlMs: number, load: () => T): T {
  const hit = entries.get(key);
  if (hit && hit.expires > Date.now()) return hit.value as T;
  const value = load();
  entries.set(key, { value, expires: Date.now() + ttlMs });
  return value;
}

export function forget(key: string): void {
  entries.delete(key);
}
