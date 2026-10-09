import { useEffect, useState } from 'react';
import type { Overview } from '@/lib/types';
import { useOverview } from './use-overview';

export interface JiraReadiness {
  ready: boolean;
  // What to configure before findings of this repository can be reported, when they cannot.
  missing: string | null;
}

export function jiraReadiness(ov: Pick<Overview, 'jira' | 'repos'>, repoName: string): JiraReadiness {
  const repo = ov.repos.find((r) => r.name === repoName);
  if (!ov.jira) return { ready: false, missing: 'Add a jira section with the site to repos.yaml to report findings to Jira.' };
  if (!ov.jira.ready) return { ready: false, missing: 'Set the Jira email and API token variables in .env, then restart the dashboard.' };
  if (!repo?.jira?.project) return { ready: false, missing: `Set jira.project for ${repoName} in repos.yaml to report its findings.` };
  return { ready: true, missing: null };
}

export function useJiraReadiness(repoName: string): JiraReadiness {
  return jiraReadiness(useOverview(), repoName);
}

// The value after it has stopped changing for `ms`, so a search box does not query Jira on every keystroke.
export function useDebounced<T>(value: T, ms = 250): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return settled;
}
