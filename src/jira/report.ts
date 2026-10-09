import { readFileSync } from 'node:fs';
import { parseConfig, type RepoConfig } from '../config/config.js';
import { ActionError } from '../errors.js';
import type { Store } from '../store/index.js';
import { IssueError } from '../store/index.js';
import { findingDescription, fingerprintLabel, issueSummary } from './adf.js';
import { issueKey, type JiraClient, JiraError, projectKey } from './client.js';
import { checkParent, issueWithLabel, parentTypes } from './lookups.js';
import { allSpecs, buildFields, issueTypeId, issueTypes, rawFields } from './metadata.js';
import type { FormValue, ReportBody, ReportForm, ReportOutcome } from './types.js';
import { toJiraFields } from './values.js';

const FINGERPRINT = /^[0-9a-f]{32}$/;
export const MAX_REPORT_BATCH = 50;

export interface ReportContext {
  configPath: string;
  store: Store;
  client: JiraClient;
  by: string;
  now?: () => string;
}

function repoConfig(configPath: string, name: string): RepoConfig {
  const repo = parseConfig(readFileSync(configPath, 'utf8'), configPath).find((r) => r.name === name);
  if (!repo) throw new ActionError(400, `unknown repository "${name}"`);
  return repo;
}

// What the report form starts from: the repository's target, resolved against Jira for a project and issue type the
// auditor may have changed.
export async function reportForm(ctx: ReportContext, repoName: string, project?: string, issueType?: string): Promise<ReportForm> {
  const target = repoConfig(ctx.configPath, repoName).jira ?? {};
  const key = project ?? target.project;
  if (!key) throw new ActionError(400, `repository "${repoName}" has no Jira project; set jira.project in repos.yaml`);
  projectKey(key);
  const types = await issueTypes(ctx.client, key);
  const typeName = issueType ?? target.issue_type ?? types[0]?.name;
  if (!typeName) throw new ActionError(400, `${key} offers no issue type you can create`);
  const typeId = await issueTypeId(ctx.client, key, typeName);
  const { fields, unknown } = buildFields(await rawFields(ctx.client, key, typeId), target.fields ?? {});
  const parents = await parentTypes(ctx.client, key, typeId);
  let parent: ReportForm['parent'] = null;
  let parentError: string | null = null;
  if (target.parent && parents.length) {
    try {
      parent = await checkParent(ctx.client, key, typeId, target.parent);
    } catch (e) {
      if (!(e instanceof JiraError)) throw e;
      parentError = e.message;
    }
  } else if (target.parent) parentError = `${typeName} issues cannot have a parent in ${key}`;
  return {
    project: key,
    issue_type: types.find((t) => t.id === typeId)?.name ?? typeName,
    issue_types: types,
    fields,
    labels: target.labels ?? [],
    parent,
    parent_error: parentError,
    parent_allowed: parents.length > 0,
    unknown_defaults: unknown,
  };
}

function checkBody(body: ReportBody): void {
  projectKey(body.project);
  if (body.parent != null) issueKey(body.parent);
  const fps = body.fingerprints;
  if (!fps.length || fps.length > MAX_REPORT_BATCH) throw new ActionError(400, `report 1 to ${MAX_REPORT_BATCH} findings at a time`);
  if (fps.some((f) => !FINGERPRINT.test(f)) || new Set(fps).size !== fps.length)
    throw new ActionError(400, 'fingerprints must be distinct and 32 hex characters');
  if (body.labels.some((l) => /\s/.test(l) || !l)) throw new ActionError(400, 'labels cannot be empty or hold spaces');
}

// Files one issue per finding, one at a time: a refusal for one finding stops nothing, and every outcome is returned.
// Field values and the parent are checked once, against fresh metadata, before anything is created.
export async function reportFindings(ctx: ReportContext, body: ReportBody): Promise<ReportOutcome[]> {
  checkBody(body);
  repoConfig(ctx.configPath, body.repo);
  const typeId = await issueTypeId(ctx.client, body.project, body.issue_type, true);
  const values: Record<string, FormValue | null> = body.fields;
  const custom = toJiraFields(allSpecs(await rawFields(ctx.client, body.project, typeId, true)), values);
  if (body.parent) await checkParent(ctx.client, body.project, typeId, body.parent);
  const state = ctx.store.readRepoState(body.repo);
  const now = ctx.now ?? (() => new Date().toISOString());

  const outcomes: ReportOutcome[] = [];
  for (const fingerprint of body.fingerprints) {
    const refused = ctx.store.notReportable(body.repo, fingerprint);
    const entry = state?.findings[fingerprint];
    if (refused || !entry) {
      outcomes.push({ fingerprint, ok: false, error: refused?.message ?? 'no such finding in this repository', fields: {} });
      continue;
    }
    const label = fingerprintLabel(fingerprint);
    let key: string;
    let adopted = false;
    try {
      const existing = await issueWithLabel(ctx.client, body.project, label);
      if (existing) {
        key = existing;
        adopted = true;
      } else {
        const created = await ctx.client.post<{ key: string }>('/rest/api/3/issue', {
          fields: {
            project: { key: body.project },
            issuetype: { id: typeId },
            summary: issueSummary(body.summaries[fingerprint] || entry.finding.title),
            description: findingDescription({ ...entry.finding, fingerprint, repo: body.repo }),
            labels: [...new Set([...body.labels, 'reposcout', label])],
            ...(body.parent ? { parent: { key: body.parent } } : {}),
            ...custom,
          },
        });
        key = created.key;
      }
    } catch (e) {
      if (!(e instanceof JiraError)) throw e;
      outcomes.push({ fingerprint, ok: false, error: e.message, fields: e.fields });
      continue;
    }
    const url = `${ctx.client.site}/browse/${key}`;
    try {
      ctx.store.linkIssue(body.repo, fingerprint, { key, url, project: body.project, reported_by: ctx.by, reported_at: now() });
      outcomes.push({ fingerprint, ok: true, key, url, adopted });
    } catch (e) {
      if (!(e instanceof IssueError)) throw e;
      outcomes.push({
        fingerprint,
        ok: false,
        error: `${key} exists in Jira but was not recorded here (${e.message}); reporting the finding again links it`,
        fields: {},
      });
    }
  }
  return outcomes;
}
