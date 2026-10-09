import { queryOptions } from '@tanstack/react-query';
import { api, type FindingRef } from './api';

export const queryKeys = {
  overview: ['overview'] as const,
  finding: {
    all: ['finding'] as const,
    history: (ref: FindingRef) => ['finding', 'history', ref.repo, ref.fingerprint] as const,
    stages: (ref: FindingRef) => ['finding', 'stages', ref.repo, ref.fingerprint] as const,
    validations: (ref: FindingRef) => ['finding', 'validations', ref.repo, ref.fingerprint] as const,
  },
  runEvents: (runId: string) => ['run-events', runId] as const,
};

// Refreshed by the live stream whenever state/ or repos.yaml changes, so it never polls.
export const overviewQuery = queryOptions({ queryKey: queryKeys.overview, queryFn: api.overview, staleTime: Number.POSITIVE_INFINITY });

export const findingHistoryQuery = (ref: FindingRef) =>
  queryOptions({ queryKey: queryKeys.finding.history(ref), queryFn: () => api.findingHistory(ref.repo, ref.fingerprint) });

export const stageHistoryQuery = (ref: FindingRef) =>
  queryOptions({ queryKey: queryKeys.finding.stages(ref), queryFn: () => api.stageHistory(ref.repo, ref.fingerprint) });

export const validationsQuery = (ref: FindingRef) =>
  queryOptions({ queryKey: queryKeys.finding.validations(ref), queryFn: () => api.validationAttempts(ref.repo, ref.fingerprint) });

// A finished run's event log never changes.
export const runEventsQuery = (runId: string) =>
  queryOptions({ queryKey: queryKeys.runEvents(runId), queryFn: () => api.runEvents(runId), staleTime: Number.POSITIVE_INFINITY });
