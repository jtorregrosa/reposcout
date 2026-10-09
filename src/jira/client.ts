import { JIRA_ISSUE, JIRA_PROJECT, type JiraSite } from '../config/config.js';
import { ActionError } from '../errors.js';
import { readSecretEnv } from '../security/env.js';
import { redact } from '../security/secrets.js';

// Jira answered, or could not be reached; `fields` holds Jira's message per field id when it gave one.
export class JiraError extends Error {
  override name = 'JiraError';
  constructor(
    readonly status: number,
    message: string,
    readonly fields: Record<string, string> = {},
  ) {
    super(redact(message));
  }
}

export interface JiraCredentials {
  site: string;
  email: string;
  token: string;
}

// Reads the credential the configuration names, or says which variable is missing.
export function jiraCredentials(site: JiraSite): JiraCredentials {
  const email = readSecretEnv(site.email_env);
  const token = readSecretEnv(site.token_env);
  const missing = [email ? null : site.email_env, token ? null : site.token_env].filter(Boolean);
  if (missing.length) throw new ActionError(400, `reporting to Jira needs ${missing.join(' and ')} set in .env`);
  return { site: site.site, email: email as string, token: token as string };
}

export const jiraReady = (site: JiraSite | null) => !!site && !!process.env[site.email_env] && !!process.env[site.token_env];

export function projectKey(value: unknown): string {
  if (typeof value !== 'string' || !JIRA_PROJECT.test(value)) throw new ActionError(400, 'project must be a Jira project key');
  return value;
}

export function issueKey(value: unknown): string {
  if (typeof value !== 'string' || !JIRA_ISSUE.test(value)) throw new ActionError(400, 'parent must be an issue key such as PROJ-123');
  return value;
}

// Values from the dashboard reach a path only through this, never by string concatenation.
export const segment = (value: string | number) => encodeURIComponent(String(value));

const RETRY_CAP_MS = 10_000;

type Query = Record<string, string | number | undefined>;

export interface JiraClient {
  get<T>(path: string, query?: Query): Promise<T>;
  post<T>(path: string, body: unknown): Promise<T>;
  readonly site: string;
}

interface ClientDeps {
  fetchFn?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

function errorFrom(status: number, body: unknown): JiraError {
  const b = (body && typeof body === 'object' ? body : {}) as { errorMessages?: unknown; errors?: unknown; message?: unknown };
  const fields: Record<string, string> = {};
  if (b.errors && typeof b.errors === 'object') for (const [k, v] of Object.entries(b.errors)) fields[k] = redact(String(v));
  const messages = [...(Array.isArray(b.errorMessages) ? b.errorMessages.map(String) : []), ...Object.entries(fields).map(([k, v]) => `${k}: ${v}`)];
  if (typeof b.message === 'string') messages.push(b.message);
  const fallback =
    status === 401 || status === 403 ? 'Jira refused the credential; check the email, the API token and the account permissions' : `Jira answered ${status}`;
  return new JiraError(status, messages.join('; ') || fallback, fields);
}

// Every request goes to the configured site only, with paths RepoScout builds, and never follows a redirect.
export function createJiraClient(
  creds: JiraCredentials,
  { fetchFn = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }: ClientDeps = {},
): JiraClient {
  const auth = `Basic ${Buffer.from(`${creds.email}:${creds.token}`).toString('base64')}`;
  const origin = new URL(creds.site).origin;

  async function send<T>(method: 'GET' | 'POST', path: string, query: Query = {}, body?: unknown, retried = false): Promise<T> {
    const url = new URL(path, origin);
    if (url.origin !== origin) throw new JiraError(400, 'refused a Jira path outside the configured site');
    for (const [k, v] of Object.entries(query)) if (v !== undefined) url.searchParams.set(k, String(v));
    let res: Response;
    try {
      res = await fetchFn(url, {
        method,
        redirect: 'manual',
        headers: { Authorization: auth, Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) {
      throw new JiraError(502, `Jira could not be reached: ${(e as Error).message}`);
    }
    if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) {
      throw new JiraError(502, 'Jira answered with a redirect, which RepoScout does not follow');
    }
    if (res.status === 429 && !retried) {
      const wait = Number(res.headers.get('retry-after'));
      await sleep(Math.min(RETRY_CAP_MS, Number.isFinite(wait) && wait > 0 ? wait * 1000 : 1000));
      return send<T>(method, path, query, body, true);
    }
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (res.status === 429) throw new JiraError(429, 'Jira is rate limiting RepoScout; try again in a minute');
    if (!res.ok) throw errorFrom(res.status, json);
    return json as T;
  }

  return {
    site: origin,
    get: (path, query) => send('GET', path, query),
    post: (path, body) => send('POST', path, {}, body),
  };
}
