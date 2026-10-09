import { useSuspenseQuery } from '@tanstack/react-query';
import { overviewQuery } from '@/lib/queries';
import type { Overview } from '@/lib/types';

export function useOverview(): Overview {
  return useSuspenseQuery(overviewQuery).data;
}

// Re-renders the caller only when the selected slice changes; pass a stable `select`.
export function useOverviewSelect<T>(select: (ov: Overview) => T): T {
  return useSuspenseQuery({ ...overviewQuery, select }).data;
}
