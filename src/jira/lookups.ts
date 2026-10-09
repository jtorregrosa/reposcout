import { type JiraClient, JiraError, segment } from './client.js';
import type { ParentRef, SprintRef, UserRef } from './types.js';

interface SearchResult {
  issues?: { key: string; fields?: { summary?: string; issuetype?: { id?: string; name?: string } } }[];
}

// JQL strings are quoted values; a quote or backslash inside one is escaped so search text cannot end the string.
const jqlString = (v: string) => `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

// Characters JQL's text search treats as operators are dropped from the words of a summary search.
const searchWords = (q: string) => q.replace(/[+\-&|!(){}[\]^~*?:\\/"']/g, ' ').trim();

async function search(client: JiraClient, jql: string, max = 20): Promise<NonNullable<SearchResult['issues']>> {
  const r = await client.get<SearchResult>('/rest/api/3/search/jql', { jql, fields: 'summary,issuetype', maxResults: max });
  return r.issues ?? [];
}

async function projectId(client: JiraClient, project: string): Promise<string> {
  const p = await client.get<{ id: string }>(`/rest/api/3/project/${segment(project)}`);
  return String(p.id);
}

// The issue types one hierarchy level above the type being created: an epic for a story or a bug, in most projects.
export async function parentTypes(client: JiraClient, project: string, typeId: string): Promise<{ id: string; name: string }[]> {
  const types = await client.get<{ id: string; name: string; hierarchyLevel?: number }[]>('/rest/api/3/issuetype/project', {
    projectId: await projectId(client, project),
  });
  const level = types.find((t) => String(t.id) === typeId)?.hierarchyLevel ?? 0;
  return types.filter((t) => (t.hierarchyLevel ?? 0) === level + 1).map((t) => ({ id: String(t.id), name: t.name }));
}

const toParent = (i: NonNullable<SearchResult['issues']>[number]): ParentRef => ({
  key: i.key,
  summary: i.fields?.summary ?? '',
  type: i.fields?.issuetype?.name ?? '',
});

export async function searchParents(client: JiraClient, project: string, typeId: string, q: string): Promise<ParentRef[]> {
  const types = await parentTypes(client, project, typeId);
  if (!types.length) return [];
  const clauses = [`project = ${jqlString(project)}`, `issuetype in (${types.map((t) => t.id).join(', ')})`, 'statusCategory != Done'];
  const term = q.trim();
  const words = searchWords(term);
  if (/^[A-Z][A-Z0-9_]+-\d+$/i.test(term)) clauses.push(`(key = ${jqlString(term.toUpperCase())} OR summary ~ ${jqlString(words)})`);
  else if (words) clauses.push(`summary ~ ${jqlString(`${words}*`)}`);
  return (await search(client, `${clauses.join(' AND ')} ORDER BY updated DESC`)).map(toParent);
}

// A configured parent is used only once Jira confirms it exists and its type can be a parent here.
export async function checkParent(client: JiraClient, project: string, typeId: string, key: string): Promise<ParentRef> {
  const types = await parentTypes(client, project, typeId);
  let issue: { key: string; fields?: { summary?: string; issuetype?: { id?: string; name?: string } } };
  try {
    issue = await client.get(`/rest/api/3/issue/${segment(key)}`, { fields: 'summary,issuetype' });
  } catch (e) {
    if (e instanceof JiraError && e.status === 404) throw new JiraError(400, `the parent ${key} does not exist or is not visible to this account`);
    throw e;
  }
  if (!types.some((t) => t.id === String(issue.fields?.issuetype?.id))) {
    throw new JiraError(400, `${key} is a ${issue.fields?.issuetype?.name ?? 'issue'}, which cannot be the parent of this issue type`);
  }
  return toParent(issue);
}

export async function searchUsers(client: JiraClient, project: string, q: string): Promise<UserRef[]> {
  const users = await client.get<{ accountId: string; displayName?: string; accountType?: string }[]>('/rest/api/3/user/assignable/search', {
    project,
    query: q,
    maxResults: 20,
  });
  return users.filter((u) => u.accountType !== 'app').map((u) => ({ account_id: u.accountId, name: u.displayName ?? u.accountId }));
}

// The active and future sprints of the project's scrum boards.
export async function projectSprints(client: JiraClient, project: string): Promise<SprintRef[]> {
  const boards = await client.get<{ values?: { id: number }[] }>('/rest/agile/1.0/board', { projectKeyOrId: project, type: 'scrum', maxResults: 20 });
  const seen = new Map<number, SprintRef>();
  for (const b of boards.values ?? []) {
    const sprints = await client.get<{ values?: { id: number; name: string; state: string }[] }>(`/rest/agile/1.0/board/${segment(b.id)}/sprint`, {
      state: 'active,future',
      maxResults: 50,
    });
    for (const s of sprints.values ?? []) seen.set(s.id, { id: s.id, name: s.name, state: s.state });
  }
  return [...seen.values()].sort((a, b) => (a.state === b.state ? a.name.localeCompare(b.name) : a.state === 'active' ? -1 : 1));
}

// The issue an earlier report filed for this fingerprint, found by the label every report carries.
export async function issueWithLabel(client: JiraClient, project: string, label: string): Promise<string | null> {
  const found = await search(client, `project = ${jqlString(project)} AND labels = ${jqlString(label)} ORDER BY created ASC`, 1);
  return found[0]?.key ?? null;
}
