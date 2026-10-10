import { queryOptions } from '@tanstack/react-query';
import { api, type FindingRef, jira, settings } from './api';

export const queryKeys = {
  overview: ['overview'] as const,
  config: ['config'] as const,
  checks: ['checks'] as const,
  finding: {
    all: ['finding'] as const,
    history: (ref: FindingRef) => ['finding', 'history', ref.repo, ref.fingerprint] as const,
    stages: (ref: FindingRef) => ['finding', 'stages', ref.repo, ref.fingerprint] as const,
    validations: (ref: FindingRef) => ['finding', 'validations', ref.repo, ref.fingerprint] as const,
  },
  runEvents: (runId: string) => ['run-events', runId] as const,
  jira: {
    all: ['jira'] as const,
    form: (repo: string, project?: string, issueType?: string) => ['jira', 'form', repo, project ?? null, issueType ?? null] as const,
    parents: (project: string, issueType: string, q: string) => ['jira', 'parents', project, issueType, q] as const,
    users: (project: string, q: string) => ['jira', 'users', project, q] as const,
    sprints: (project: string) => ['jira', 'sprints', project] as const,
  },
};

// Refreshed by the live stream whenever state/ or repos.yaml changes, so it never polls.
export const overviewQuery = queryOptions({ queryKey: queryKeys.overview, queryFn: api.overview, staleTime: Number.POSITIVE_INFINITY });

export const findingHistoryQuery = (ref: FindingRef) =>
  queryOptions({ queryKey: queryKeys.finding.history(ref), queryFn: () => api.findingHistory(ref.repo, ref.fingerprint) });

export const stageHistoryQuery = (ref: FindingRef) =>
  queryOptions({ queryKey: queryKeys.finding.stages(ref), queryFn: () => api.stageHistory(ref.repo, ref.fingerprint) });

export const validationsQuery = (ref: FindingRef) =>
  queryOptions({ queryKey: queryKeys.finding.validations(ref), queryFn: () => api.validationAttempts(ref.repo, ref.fingerprint) });

// Refreshed with the overview, since both follow repos.yaml.
export const configQuery = queryOptions({ queryKey: queryKeys.config, queryFn: settings.config, staleTime: Number.POSITIVE_INFINITY });

// The checks call Jira, so they run when the section opens or on request, never in the background.
export const checksQuery = queryOptions({ queryKey: queryKeys.checks, queryFn: settings.checks, staleTime: Number.POSITIVE_INFINITY, retry: false });

// A finished run's event log never changes.
export const runEventsQuery = (runId: string) =>
  queryOptions({ queryKey: queryKeys.runEvents(runId), queryFn: () => api.runEvents(runId), staleTime: Number.POSITIVE_INFINITY });

// Jira's metadata changes rarely while a form is open; a failed lookup is shown, not retried in a loop.
export const jiraFormQuery = (repo: string, project?: string, issueType?: string) =>
  queryOptions({
    queryKey: queryKeys.jira.form(repo, project, issueType),
    queryFn: () => jira.form(repo, project, issueType),
    staleTime: 60_000,
    retry: false,
  });

export const jiraParentsQuery = (project: string, issueType: string, q: string) =>
  queryOptions({
    queryKey: queryKeys.jira.parents(project, issueType, q),
    queryFn: () => jira.parents(project, issueType, q),
    staleTime: 60_000,
    retry: false,
  });

export const jiraUsersQuery = (project: string, q: string) =>
  queryOptions({ queryKey: queryKeys.jira.users(project, q), queryFn: () => jira.users(project, q), staleTime: 60_000, retry: false });

export const jiraSprintsQuery = (project: string) =>
  queryOptions({ queryKey: queryKeys.jira.sprints(project), queryFn: () => jira.sprints(project), staleTime: 60_000, retry: false });
