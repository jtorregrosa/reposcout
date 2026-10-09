import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export const OVERVIEW_KEY = ['overview'] as const;

// Refreshed by the live stream whenever state/ or repos.yaml changes, so it never polls.
export function useOverview() {
  return useQuery({ queryKey: OVERVIEW_KEY, queryFn: api.overview, staleTime: Number.POSITIVE_INFINITY });
}
