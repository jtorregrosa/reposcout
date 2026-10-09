import { useCallback } from 'react';
import { useSearchParams } from 'react-router';

// One enumerated value kept in the URL, so a reload or a shared link reopens it. The fallback is never written.
export function useSearchParam<T extends string>(key: string, allowed: readonly T[], fallback: T) {
  const [params, setParams] = useSearchParams();
  const raw = params.get(key);
  const value = allowed.includes(raw as T) ? (raw as T) : fallback;
  const set = useCallback(
    (next: T) =>
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          if (next === fallback) p.delete(key);
          else p.set(key, next);
          return p;
        },
        { replace: true },
      ),
    [key, fallback, setParams],
  );
  return [value, set] as const;
}
