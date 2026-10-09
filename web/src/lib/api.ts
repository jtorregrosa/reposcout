import type {
  FindingEvent,
  Kind,
  Overview,
  ParentRef,
  ReportBody,
  ReportForm,
  ReportOutcome,
  RunEvent,
  SprintRef,
  StageEvent,
  StartRunBody,
  UserRef,
  ValidationAttempt,
} from './types';

export class ApiError extends Error {
  override name = 'ApiError';
  constructor(
    readonly status: number,
    message: string,
    // Jira's message per field id, when the error came from a report.
    readonly fields: Record<string, string> = {},
  ) {
    super(message);
  }
}

// 502 to 504 come from a proxy in front of the server, or the browser could not connect at all: the server is down.
const UNREACHABLE = 'The RepoScout server is not reachable. Start it with `pnpm ui`, then reload this page.';

async function getJson<T>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { headers: { Accept: 'application/json' } });
  } catch {
    throw new ApiError(0, UNREACHABLE);
  }
  if (res.status >= 502 && res.status <= 504) throw new ApiError(res.status, UNREACHABLE);
  if (!res.ok) throw new ApiError(res.status, `${path} answered ${res.status}`);
  return (await res.json()) as T;
}

// The server hands its session token only to a page it served; every action must carry it.
let session: Promise<string> | null = null;
const sessionToken = () => {
  session ??= getJson<{ token: string }>('/api/session').then((s) => s.token);
  return session;
};

// Reads that spend a credential on the server, such as the Jira lookups, carry the session token like actions.
async function getAuthed<T>(path: string, query: Record<string, string | undefined>): Promise<T> {
  const qs = new URLSearchParams(Object.entries(query).filter((e): e is [string, string] => e[1] !== undefined && e[1] !== ''));
  const res = await fetch(`${path}?${qs.toString()}`, { headers: { Accept: 'application/json', 'X-RepoScout-Token': await sessionToken() } });
  const data = (await res.json().catch(() => ({}))) as { error?: string; fields?: Record<string, string> };
  if (!res.ok) {
    if (res.status === 403) session = null;
    throw new ApiError(res.status, data.error ?? `HTTP ${res.status}`, data.fields);
  }
  return data as T;
}

async function post<T>(action: string, body: object = {}): Promise<T> {
  const res = await fetch(`/api/actions/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-RepoScout-Token': await sessionToken() },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string; fields?: Record<string, string> };
  if (!res.ok) {
    if (res.status === 403) session = null;
    throw new ApiError(res.status, data.error ?? `HTTP ${res.status}`, data.fields);
  }
  return data as T;
}

export interface FindingRef {
  repo: string;
  fingerprint: string;
}

export const api = {
  overview: () => getJson<Overview>('/api/overview'),
  runEvents: (runId: string) => getJson<RunEvent[]>(`/api/runs/${encodeURIComponent(runId)}/events`),
  findingHistory: (repo: string, fingerprint: string) =>
    getJson<FindingEvent[]>(`/api/findings/${encodeURIComponent(repo)}/${encodeURIComponent(fingerprint)}/history`),
  stageHistory: (repo: string, fingerprint: string) =>
    getJson<StageEvent[]>(`/api/findings/${encodeURIComponent(repo)}/${encodeURIComponent(fingerprint)}/stages`),
  validationAttempts: (repo: string, fingerprint: string) =>
    getJson<ValidationAttempt[]>(`/api/findings/${encodeURIComponent(repo)}/${encodeURIComponent(fingerprint)}/validations`),
  startRun: (body: StartRunBody) => post<{ started: boolean; pid: number | null }>('run', body),
  cancel: () => post<{ cancelling: string }>('cancel'),
  forceStop: () => post<{ killed: string }>('force-stop'),
  suppress: (ref: FindingRef & { reason: string }) => post<{ suppressed: string }>('suppress', ref),
  unsuppress: (ref: FindingRef) => post<{ unsuppressed: string }>('unsuppress', ref),
  decide: (ref: FindingRef & { decision: 'confirmed' | 'refuted'; reason: string }) => post<{ status: string; decided_by: string }>('decide', ref),
  undecide: (ref: FindingRef) => post<{ status: string }>('undecide', ref),
  label: (ref: FindingRef & { kind?: Kind; personal_data?: boolean }) =>
    post<{ kind: Kind | null; personal_data: boolean | null; set_by: string }>('label', ref),
  openInEditor: (target: { repo: string; file: string; line: number }) => post<{ opened: string }>('open', target),
  report: (body: ReportBody) => post<ReportOutcome[]>('report', body),
  unlink: (ref: FindingRef) => post<{ unlinked: string }>('unlink', ref),
};

export const jira = {
  form: (repo: string, project?: string, issueType?: string) => getAuthed<ReportForm>('/api/jira/meta', { repo, project, issue_type: issueType }),
  parents: (project: string, issueType: string, q: string) => getAuthed<ParentRef[]>('/api/jira/parents', { project, issue_type: issueType, q }),
  users: (project: string, q: string) => getAuthed<UserRef[]>('/api/jira/users', { project, q }),
  sprints: (project: string) => getAuthed<SprintRef[]>('/api/jira/sprints', { project }),
};
