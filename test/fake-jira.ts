// An in-memory Jira Cloud that answers the endpoints RepoScout calls, as a fetch function the client can be given.

const SPRINT = 'com.pyxis.greenhopper.jira:gh-sprint';

export interface FakeCall {
  method: string;
  path: string;
  query: Record<string, string>;
  body: unknown;
  auth: string | null;
}

interface FakeIssue {
  key: string;
  type: string;
  summary: string;
  labels: string[];
  fields: Record<string, unknown>;
}

export interface FakeJira {
  fetch: typeof fetch;
  calls: FakeCall[];
  issues: Map<string, FakeIssue>;
  // Answers the next request with this status (and Retry-After, Location or body) instead of handling it.
  failNext: (status: number, extra?: { retryAfter?: number; location?: string; body?: unknown }) => void;
  creates: () => FakeCall[];
}

const TYPES = [
  { id: '1', name: 'Bug', hierarchyLevel: 0 },
  { id: '2', name: 'Epic', hierarchyLevel: 1 },
  { id: '3', name: 'Sub-task', hierarchyLevel: -1, subtask: true },
];

const BUG_FIELDS = [
  { fieldId: 'summary', name: 'Summary', required: true, schema: { type: 'string', system: 'summary' } },
  { fieldId: 'description', name: 'Description', required: false, schema: { type: 'string', system: 'description' } },
  { fieldId: 'labels', name: 'Labels', required: false, schema: { type: 'array', items: 'string', system: 'labels' } },
  { fieldId: 'reporter', name: 'Reporter', required: true, hasDefaultValue: true, schema: { type: 'user', system: 'reporter' } },
  {
    fieldId: 'customfield_100',
    name: 'Team',
    required: true,
    schema: { type: 'option', custom: 'select' },
    allowedValues: [
      { id: '1', value: 'Security' },
      { id: '2', value: 'Core' },
    ],
  },
  {
    fieldId: 'customfield_101',
    name: 'Severity',
    required: false,
    schema: { type: 'option', custom: 'select' },
    allowedValues: [
      { id: '10', value: 'High' },
      { id: '11', value: 'Low' },
    ],
  },
  { fieldId: 'customfield_102', name: 'Story points', required: false, schema: { type: 'number' } },
  { fieldId: 'customfield_103', name: 'Sprint', required: false, schema: { type: 'array', items: 'json', custom: SPRINT } },
  { fieldId: 'customfield_104', name: 'Owner', required: false, schema: { type: 'user' } },
  { fieldId: 'customfield_105', name: 'Due', required: false, schema: { type: 'date' } },
  { fieldId: 'customfield_106', name: 'Area', required: false, schema: { type: 'option-with-child', custom: 'cascadingselect' } },
];

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

export function fakeJira(): FakeJira {
  const calls: FakeCall[] = [];
  const issues = new Map<string, FakeIssue>([['API-1', { key: 'API-1', type: '2', summary: 'Checkout hardening', labels: [], fields: {} }]]);
  let seq = 100;
  let forced: { status: number; retryAfter?: number; location?: string; body?: unknown } | null = null;

  const issueView = (i: FakeIssue) => {
    const t = TYPES.find((x) => x.id === i.type);
    return { key: i.key, fields: { summary: i.summary, issuetype: { id: i.type, name: t?.name } } };
  };

  const handle = (method: string, path: string, query: Record<string, string>, body: unknown): Response => {
    if (method === 'GET' && path === '/rest/api/3/myself') return json(200, { displayName: 'Reporter bot' });
    if (method === 'GET' && path === '/rest/api/3/project/API') return json(200, { id: '10000', key: 'API' });
    if (method === 'GET' && path.startsWith('/rest/api/3/project/')) return json(404, { errorMessages: ['No project could be found'] });
    if (method === 'GET' && path === '/rest/api/3/issuetype/project') return json(200, TYPES);
    if (method === 'GET' && path === '/rest/api/3/issue/createmeta/API/issuetypes') {
      return json(200, { issueTypes: TYPES, total: TYPES.length, startAt: 0, maxResults: 50 });
    }
    if (method === 'GET' && path === '/rest/api/3/issue/createmeta/API/issuetypes/1') {
      return json(200, { fields: BUG_FIELDS, total: BUG_FIELDS.length, startAt: 0, maxResults: 50 });
    }
    if (method === 'GET' && path === '/rest/api/3/search/jql') {
      const jql = query.jql ?? '';
      const label = /labels = "([^"]+)"/.exec(jql)?.[1];
      if (label) return json(200, { issues: [...issues.values()].filter((i) => i.labels.includes(label)).map(issueView) });
      if (jql.includes('issuetype in (2)')) {
        const words = /summary ~ "([^"*]+)\*?"/.exec(jql)?.[1]?.toLowerCase();
        const key = /key = "([^"]+)"/.exec(jql)?.[1];
        const epics = [...issues.values()].filter((i) => i.type === '2' && (key ? i.key === key : !words || i.summary.toLowerCase().includes(words)));
        return json(200, { issues: epics.map(issueView) });
      }
      return json(200, { issues: [] });
    }
    const issue = /^\/rest\/api\/3\/issue\/([A-Z]+-\d+)$/.exec(path);
    if (method === 'GET' && issue) {
      const found = issues.get(issue[1] as string);
      return found ? json(200, issueView(found)) : json(404, { errorMessages: ['Issue does not exist or you do not have permission to see it.'] });
    }
    if (method === 'GET' && path === '/rest/api/3/user/assignable/search') {
      return json(200, [
        { accountId: 'acc-1', displayName: 'Ada Lovelace', accountType: 'atlassian' },
        { accountId: 'bot', displayName: 'Automation', accountType: 'app' },
      ]);
    }
    if (method === 'GET' && path === '/rest/agile/1.0/board') return json(200, { values: [{ id: 7 }] });
    if (method === 'GET' && path === '/rest/agile/1.0/board/7/sprint') {
      return json(200, {
        values: [
          { id: 43, name: 'Sprint 43', state: 'future' },
          { id: 42, name: 'Sprint 42', state: 'active' },
        ],
      });
    }
    if (method === 'POST' && path === '/rest/api/3/issue') {
      const fields = (body as { fields: Record<string, unknown> }).fields;
      if (!fields.customfield_100) return json(400, { errorMessages: [], errors: { customfield_100: 'Team is required.' } });
      const key = `API-${seq++}`;
      issues.set(key, {
        key,
        type: String((fields.issuetype as { id: string }).id),
        summary: String(fields.summary),
        labels: (fields.labels as string[]) ?? [],
        fields,
      });
      return json(201, { id: String(seq), key, self: `https://acme.atlassian.net/rest/api/3/issue/${seq}` });
    }
    return json(404, { errorMessages: [`fake Jira has no ${method} ${path}`] });
  };

  const fetchFn = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const headers = new Headers(init?.headers);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path: url.pathname, query: Object.fromEntries(url.searchParams), body, auth: headers.get('authorization') });
    if (forced) {
      const f = forced;
      forced = null;
      const extra: Record<string, string> = {};
      if (f.retryAfter != null) extra['Retry-After'] = String(f.retryAfter);
      if (f.location) extra.Location = f.location;
      return json(f.status, f.body ?? {}, extra);
    }
    return handle(method, url.pathname, Object.fromEntries(url.searchParams), body);
  }) as typeof fetch;

  return {
    fetch: fetchFn,
    calls,
    issues,
    failNext: (status, extra = {}) => {
      forced = { status, ...extra };
    },
    creates: () => calls.filter((c) => c.method === 'POST' && c.path === '/rest/api/3/issue'),
  };
}
