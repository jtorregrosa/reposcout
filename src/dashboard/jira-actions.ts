import { loadJiraSite } from '../config/config.js';
import { ActionError } from '../errors.js';
import { createJiraClient, type JiraError, jiraCredentials, projectKey } from '../jira/client.js';
import { projectSprints, searchParents, searchUsers } from '../jira/lookups.js';
import { issueTypeId } from '../jira/metadata.js';
import { type ReportContext, reportFindings, reportForm } from '../jira/report.js';
import type { ReportBody } from '../jira/types.js';
import { layout } from '../paths.js';
import { IssueError, openStore } from '../store/index.js';
import { auditorName } from './actions.js';

const FINGERPRINT = /^[0-9a-f]{32}$/;

export interface JiraDeps {
  jiraFetch?: typeof fetch;
  jiraSleep?: (ms: number) => Promise<void>;
}

function context(root: string, configPath: string, deps: JiraDeps, by = auditorName()): ReportContext {
  const site = loadJiraSite(configPath);
  if (!site) throw new ActionError(400, 'reporting to Jira needs a top-level jira section with the site in repos.yaml');
  const client = createJiraClient(jiraCredentials(site), {
    ...(deps.jiraFetch ? { fetchFn: deps.jiraFetch } : {}),
    ...(deps.jiraSleep ? { sleep: deps.jiraSleep } : {}),
  });
  return { configPath, store: openStore(layout(root)), client, by };
}

// Jira's own refusals keep their status; anything else from Jira is an upstream failure.
export function jiraStatus(e: JiraError): number {
  return e.status === 400 || e.status === 404 ? e.status : 502;
}

export function reportAction({ root, configPath, body }: { root: string; configPath: string; body: ReportBody }, deps: JiraDeps = {}) {
  return reportFindings(context(root, configPath, deps), body);
}

export function unlinkAction(
  { root, repo, fingerprint }: { root: string; repo: string; fingerprint: string },
  { by = auditorName(), now = () => new Date().toISOString() }: { by?: string; now?: () => string } = {},
) {
  if (!FINGERPRINT.test(fingerprint)) throw new ActionError(400, 'fingerprint must be 32 hex characters');
  try {
    const link = openStore(layout(root)).unlinkIssue(repo, fingerprint, by, now());
    return { fingerprint, unlinked: link.key };
  } catch (e) {
    if (e instanceof IssueError) throw new ActionError(e.kind === 'no-issue' || e.kind === 'not-found' ? 404 : 409, e.message);
    throw e;
  }
}

export type LookupKind = 'meta' | 'parents' | 'users' | 'sprints';

const param = (q: URLSearchParams, name: string) => q.get(name) ?? undefined;

// The report form's reads from Jira. Each one spends the credential, so the server asks for the session token first.
export async function jiraLookup(kind: LookupKind, q: URLSearchParams, { root, configPath }: { root: string; configPath: string }, deps: JiraDeps = {}) {
  const ctx = context(root, configPath, deps);
  const project = param(q, 'project');
  if (kind === 'meta') {
    const repo = param(q, 'repo');
    if (!repo) throw new ActionError(400, 'repo is required');
    return reportForm(ctx, repo, project === undefined ? undefined : projectKey(project), param(q, 'issue_type'));
  }
  const key = projectKey(project);
  if (kind === 'parents') {
    const typeName = param(q, 'issue_type');
    if (!typeName) throw new ActionError(400, 'issue_type is required');
    const term = (param(q, 'q') ?? '').slice(0, 100);
    return searchParents(ctx.client, key, await issueTypeId(ctx.client, key, typeName), term);
  }
  if (kind === 'users') return searchUsers(ctx.client, key, (param(q, 'q') ?? '').slice(0, 100));
  return projectSprints(ctx.client, key);
}
