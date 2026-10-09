import type { FindingEvent, Kind, Overview, RunEvent, StageEvent, StartRunBody } from './types';

export class ApiError extends Error {
  override name = 'ApiError';
  constructor(
    readonly status: number,
    message: string,
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

async function post<T>(action: string, body: object = {}): Promise<T> {
  const res = await fetch(`/api/actions/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-RepoScout-Token': await sessionToken() },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) {
    if (res.status === 403) session = null;
    throw new ApiError(res.status, data.error ?? `HTTP ${res.status}`);
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
};
