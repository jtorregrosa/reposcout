import { randomBytes, timingSafeEqual } from 'node:crypto';
import { appendFileSync, closeSync, mkdirSync, openSync, readFileSync, readSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { ActionError, errorMessage } from '../errors.js';
import { localDate, parseJsonLines } from '../fs.js';
import { layout } from '../paths.js';
import { redactDeep } from '../security/secrets.js';
import { activeRun } from '../state/lock.js';
import { openStore, type Store } from '../store/index.js';
import {
  type ActionDeps,
  decideSpeculative,
  forceStop,
  openInEditor,
  requestCancel,
  setLabels,
  startRun,
  suppressFinding,
  undoDecision,
  unsuppressFinding,
} from './actions.js';
import { listRuns, overviewSignature, readOverview, runEventsFile } from './overview.js';
import { resolveAsset } from './static.js';

const SECURITY_HEADERS = {
  'Content-Security-Policy':
    // Scripts stay 'self' only. Styles allow inline because the component library positions popovers and locks
    // scrolling through injected style elements; a style cannot run code.
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
};

const MAX_BODY = 16 * 1024;

function readFrom(path: string, offset: number): { text: string; size: number } {
  let size: number;
  try {
    size = statSync(path).size;
  } catch {
    return { text: '', size: offset };
  }
  if (size <= offset) return { text: '', size };
  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.alloc(size - offset);
    readSync(fd, buf, 0, buf.length, offset);
    return { text: buf.toString('utf8'), size };
  } finally {
    closeSync(fd);
  }
}

// Streams the active run (or the latest one when idle) as SSE, switching when a new run starts.
function liveStream({
  root,
  configPath,
  store,
  req,
  res,
  pollMs,
}: {
  root: string;
  configPath: string;
  store: Store;
  req: IncomingMessage;
  res: ServerResponse;
  pollMs: number;
}) {
  res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'text/event-stream', Connection: 'keep-alive' });
  const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const lockFile = layout(root).lockFile;
  let file: string | null = null;
  let offset = 0;
  let partial = '';
  let signature: string | null = null;
  let wasActive: boolean | null = null;
  let lastBeat = Date.now();

  const tick = () => {
    const active = activeRun(lockFile);
    const target = active?.events_file ? join(root, active.events_file) : (listRuns(root, 1)[0]?.file ?? null);
    const runId = active?.run_id ?? (target ? /(run-[0-9TZ-]+)\.events\.jsonl$/.exec(target)?.[1] : null);
    if (target !== file) {
      file = target;
      offset = 0;
      partial = '';
      send('run', { run_id: runId, active: !!active, pid: active?.pid ?? null, started_at: active?.started_at ?? null });
    } else if (wasActive !== null && wasActive !== !!active) {
      // Same file, but its process ended: finished normally or was killed before writing run_finished.
      send('run_state', { active: !!active });
    }
    wasActive = !!active;
    if (file) {
      const { text, size } = readFrom(file, offset);
      offset = size;
      if (text) {
        const lines = (partial + text).split('\n');
        partial = lines.pop() ?? '';
        const batch = parseJsonLines(lines.join('\n'));
        if (batch.length) send('events', batch);
      }
    }
    const sig = overviewSignature(root, configPath, store);
    if (sig !== signature) {
      signature = sig;
      send('overview_changed', {});
    }
    if (Date.now() - lastBeat > 15000) {
      res.write(': keep-alive\n\n');
      lastBeat = Date.now();
    }
  };

  tick();
  const timer = setInterval(tick, pollMs);
  req.on('close', () => clearInterval(timer));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    let size = 0;
    let tooLarge = false;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (tooLarge) return;
      if (size > MAX_BODY) {
        // Keep draining so the 413 can still be written, but stop buffering.
        tooLarge = true;
        chunks.length = 0;
        reject(new ActionError(413, 'request body too large'));
      } else chunks.push(c);
    });
    req.on('end', () => resolvePromise(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sameToken(a: unknown, b: string): boolean {
  const x = Buffer.from(String(a ?? ''));
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function logAction(root: string, entry: Record<string, unknown>): void {
  const d = new Date();
  const file = join(root, 'reports', localDate(d), 'logs', 'dashboard-actions.jsonl');
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(redactDeep({ ts: d.toISOString(), ...entry }))}\n`);
}

// Values are checked by the actions themselves; the schema pins down which fields each one accepts. A field
// the server does not know is refused rather than dropped: a page reloaded against an older server otherwise
// starts a different run from the one its form describes.
const BODIES = {
  run: z.strictObject({
    repos: z.unknown().optional(),
    mode: z.unknown().optional(),
    max_files: z.unknown().optional(),
    analyzers: z.unknown().optional(),
    until_covered: z.unknown().optional(),
    session_limit: z.unknown().optional(),
  }),
  cancel: z.strictObject({}),
  'force-stop': z.strictObject({}),
  suppress: z.strictObject({ repo: z.string(), fingerprint: z.string(), reason: z.unknown() }),
  unsuppress: z.strictObject({ repo: z.string(), fingerprint: z.string() }),
  decide: z.strictObject({ repo: z.string(), fingerprint: z.string(), decision: z.unknown(), reason: z.unknown() }),
  undecide: z.strictObject({ repo: z.string(), fingerprint: z.string() }),
  label: z.strictObject({ repo: z.string(), fingerprint: z.string(), kind: z.unknown().optional(), personal_data: z.unknown().optional() }),
  open: z.strictObject({ repo: z.string(), file: z.unknown(), line: z.unknown().optional() }),
};

type ActionName = keyof typeof BODIES;
type Body<K extends ActionName> = z.output<(typeof BODIES)[K]>;

export interface ServerOptions {
  root: string;
  uiDir: string;
  configPath: string;
  port: number;
  host?: string;
  pollMs?: number;
  deps?: ActionDeps;
}

function parseBody(name: ActionName, text: string): unknown {
  let json: unknown;
  try {
    json = JSON.parse(text || '{}');
  } catch {
    throw new ActionError(400, 'invalid JSON');
  }
  if (!json || typeof json !== 'object' || Array.isArray(json)) throw new ActionError(400, 'body must be a JSON object');
  const parsed = BODIES[name].safeParse(json);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  if (issue?.code === 'unrecognized_keys') throw new ActionError(400, `unknown field ${issue.keys.join(', ')}: restart the dashboard if it predates this page`);
  throw new ActionError(400, `${issue?.path.join('.') || 'body'}: ${issue?.message ?? 'invalid'}`);
}

export function startServer({ root, uiDir, configPath, port, host = '127.0.0.1', pollMs = 700, deps = {} }: ServerOptions): Promise<Server> {
  // Proves a request comes from the page this server served: other origins can send a POST to localhost,
  // but cannot read /api/session to learn the token, and a custom header forces a CORS preflight we never grant.
  const token = randomBytes(32).toString('hex');
  const store = openStore(layout(root));
  const actions: { [K in ActionName]: (b: Body<K>) => unknown } = {
    run: (b) =>
      startRun(
        {
          root,
          configPath,
          repos: b.repos,
          mode: b.mode,
          maxFiles: b.max_files ?? null,
          analyzers: b.analyzers ?? null,
          untilCovered: b.until_covered ?? false,
          sessionLimit: b.session_limit ?? null,
        },
        deps,
      ),
    cancel: () => requestCancel({ root }),
    'force-stop': () => forceStop({ root }),
    suppress: (b) => suppressFinding({ root, configPath, repo: b.repo, fingerprint: b.fingerprint, reason: b.reason as string }),
    unsuppress: (b) => unsuppressFinding({ configPath, repo: b.repo, fingerprint: b.fingerprint }),
    decide: (b) => decideSpeculative({ root, configPath, repo: b.repo, fingerprint: b.fingerprint, decision: b.decision, reason: b.reason }),
    undecide: (b) => undoDecision({ root, configPath, repo: b.repo, fingerprint: b.fingerprint }),
    label: (b) => setLabels({ root, configPath, repo: b.repo, fingerprint: b.fingerprint, kind: b.kind, personal_data: b.personal_data }),
    open: (b) => openInEditor({ root, configPath, repo: b.repo, file: b.file, line: b.line }, deps),
  };
  const isAction = (name: string): name is ActionName => Object.hasOwn(actions, name);

  const server = createServer(async (req, res) => {
    const reply = (status: number, body: unknown, type = 'application/json; charset=utf-8') => {
      res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': type });
      res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
    };
    const actualPort = (server.address() as AddressInfo).port;
    // Rejects DNS-rebinding: a page on another origin can resolve its name to 127.0.0.1, but cannot fake Host.
    const allowedHosts = [`127.0.0.1:${actualPort}`, `localhost:${actualPort}`];
    if (!allowedHosts.includes(req.headers.host ?? '')) return reply(403, { error: 'forbidden host' });
    const site = req.headers['sec-fetch-site'];
    if (site && site !== 'same-origin' && site !== 'none') return reply(403, { error: 'cross-site request' });

    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

    if (req.method === 'POST') {
      const name = url.pathname.startsWith('/api/actions/') ? url.pathname.slice('/api/actions/'.length) : '';
      if (!isAction(name)) return reply(404, { error: 'not found' });
      const origin = req.headers.origin;
      if (!origin || !allowedHosts.some((h) => origin === `http://${h}`)) return reply(403, { error: 'forbidden origin' });
      if (!sameToken(req.headers['x-reposcout-token'], token)) return reply(403, { error: 'missing or invalid session token' });
      if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) return reply(415, { error: 'JSON only' });
      let body: unknown;
      try {
        body = parseBody(name, await readBody(req));
      } catch (e) {
        return reply(e instanceof ActionError ? e.status : 400, { error: e instanceof ActionError ? e.message : 'invalid JSON' });
      }
      try {
        const result = (actions[name] as (b: unknown) => unknown)(body);
        logAction(root, { action: name, request: body, ok: true, result });
        return reply(200, result);
      } catch (e) {
        logAction(root, { action: name, request: body, ok: false, error: errorMessage(e) });
        return reply(e instanceof ActionError ? e.status : 500, { error: errorMessage(e) });
      }
    }
    if (req.method !== 'GET') return reply(405, { error: 'method not allowed' });

    try {
      if (url.pathname === '/api/session') return reply(200, { token });
      if (url.pathname === '/api/overview') return reply(200, readOverview(root, configPath, store));
      if (url.pathname === '/api/live') return liveStream({ root, configPath, store, req, res, pollMs });
      const history = /^\/api\/findings\/([^/]+)\/([0-9a-f]{32})\/history$/.exec(url.pathname);
      if (history) return reply(200, store.findingHistory(decodeURIComponent(history[1] as string), history[2] as string));
      const stages = /^\/api\/findings\/([^/]+)\/([0-9a-f]{32})\/stages$/.exec(url.pathname);
      if (stages) return reply(200, store.stageHistory(decodeURIComponent(stages[1] as string), stages[2] as string));
      const validations = /^\/api\/findings\/([^/]+)\/([0-9a-f]{32})\/validations$/.exec(url.pathname);
      if (validations) return reply(200, store.validationAttempts(decodeURIComponent(validations[1] as string), validations[2] as string));
      const m = /^\/api\/runs\/([^/]+)\/events$/.exec(url.pathname);
      if (m) {
        const file = runEventsFile(root, decodeURIComponent(m[1] as string));
        if (!file) return reply(404, { error: 'unknown run' });
        return reply(200, parseJsonLines(readFileSync(file, 'utf8')));
      }
      if (url.pathname.startsWith('/api/')) return reply(404, { error: 'not found' });
      const asset = resolveAsset(uiDir, url.pathname);
      if (!asset) return reply(404, 'Not found. Is the dashboard built? Run `pnpm build`.', 'text/plain; charset=utf-8');
      res.writeHead(200, {
        ...SECURITY_HEADERS,
        'Content-Type': asset.type,
        'Cache-Control': asset.immutable ? 'public, max-age=31536000, immutable' : 'no-store',
      });
      return res.end(readFileSync(asset.file));
    } catch (e) {
      return reply(500, { error: errorMessage(e) });
    }
  });

  return new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolvePromise(server));
  });
}
