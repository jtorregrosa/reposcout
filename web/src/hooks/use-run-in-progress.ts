import { useQuery } from '@tanstack/react-query';
import { useRun } from '@/app/live';
import { overviewQuery } from '@/lib/queries';
import type { Overview } from '@/lib/types';

const lockHeld = (ov: Overview) => !!ov.active;

// A run holds the lock, whoever started it: the live stream knows first, the overview after its next refresh.
export function useRunInProgress(): boolean {
  const live = useRun();
  const { data: locked = false } = useQuery({ ...overviewQuery, select: lockHeld });
  return live.active || locked;
}
