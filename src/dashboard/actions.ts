import { type SpawnOptions, spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { userInfo } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { type Document, isMap, isSeq, parseDocument, YAMLMap, YAMLSeq } from 'yaml';
import { killTree } from '../claude/session.js';
import { type Analyzer, isMode, isValidMaxFiles, MAX_FILES_CEILING, type Mode, parseAnalyzers } from '../config/analyzers.js';
import { parseConfig } from '../config/config.js';
import { ActionError, errorMessage } from '../errors.js';
import { parseKind } from '../findings/process.js';
import { CLI_ENTRY, layout } from '../paths.js';
import { activeRun } from '../state/lock.js';
import { DecisionError, openStore } from '../store/index.js';

const FINGERPRINT = /^[0-9a-f]{32}$/;

interface Spawned {
  pid?: number | undefined;
  on?(event: 'error', listener: (e: Error) => void): unknown;
  unref?(): unknown;
}

type SpawnFn = (command: string, args: string[], options: SpawnOptions) => Spawned;

export interface ActionDeps {
  spawnFn?: SpawnFn;
  launcher?: () => EditorLauncher | null;
  // How to start the CLI again for a dashboard run: the script and any Node flags it was started with.
  cliArgs?: string[];
}

function configuredRepo(configPath: string, name: unknown) {
  const repos = parseConfig(readFileSync(configPath, 'utf8'), configPath);
  const repo = repos.find((r) => r.name === name);
  if (!repo) throw new ActionError(400, `unknown repository "${String(name)}"`);
  return { repo, repos };
}

function cleanReason(reason: unknown): string {
  if (typeof reason !== 'string') throw new ActionError(400, 'reason is required');
  const r = reason
    // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are exactly what this strips.
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (r.length < 3 || r.length > 300) throw new ActionError(400, 'reason must be 3 to 300 characters');
  return r;
}

function repoNode(doc: Document, name: string): YAMLMap {
  const repos = doc.get('repos', true);
  if (!isSeq(repos)) throw new ActionError(500, 'repos.yaml has no "repos" list');
  const node = repos.items.find((item): item is YAMLMap => isMap(item) && (item.get('name') ?? item.get('repo')) === name);
  if (!node) throw new ActionError(400, `repository "${name}" is not in repos.yaml`);
  return node;
}

// Edits through the yaml Document API so the file keeps its comments and layout, validates the result with the
// same parser the audit uses, and only then replaces the file atomically.
function editConfig<T>(configPath: string, mutate: (doc: Document) => T): T {
  const text = readFileSync(configPath, 'utf8');
  const doc = parseDocument(text);
  if (doc.errors.length) throw new ActionError(500, `repos.yaml does not parse: ${doc.errors[0]?.message}`);
  const outcome = mutate(doc);
  const next = doc.toString();
  try {
    parseConfig(next, configPath);
  } catch (e) {
    throw new ActionError(500, `edit rejected, repos.yaml would be invalid: ${errorMessage(e)}`);
  }
  const tmp = `${configPath}.reposcout-tmp`;
  writeFileSync(tmp, next);
  renameSync(tmp, configPath);
  return outcome;
}

const hasFingerprint = (list: YAMLSeq, fingerprint: string) => list.items.findIndex((i) => isMap(i) && i.get('fingerprint') === fingerprint);

export function suppressFinding({
  root,
  configPath,
  repo: name,
  fingerprint,
  reason,
}: {
  root: string;
  configPath: string;
  repo: string;
  fingerprint: string;
  reason: string;
}) {
  if (!FINGERPRINT.test(String(fingerprint))) throw new ActionError(400, 'fingerprint must be 32 hex characters');
  const why = cleanReason(reason);
  configuredRepo(configPath, name);
  if (!openStore(layout(root)).findingExists(name, fingerprint)) throw new ActionError(400, 'no such finding in this repository');

  return editConfig(configPath, (doc) => {
    const node = repoNode(doc, name);
    const existing: unknown = node.get('suppressed', true);
    const seq = isSeq(existing) ? existing : new YAMLSeq();
    if (seq !== existing) node.set('suppressed', seq);
    seq.flow = false;
    if (hasFingerprint(seq, fingerprint) >= 0) throw new ActionError(409, 'already suppressed');
    const entry = new YAMLMap();
    entry.set('fingerprint', fingerprint);
    entry.set('reason', why);
    seq.items.push(entry);
    return { suppressed: fingerprint, reason: why };
  });
}

// The dashboard has no sign-in: a decision is attributed to the account the dashboard runs under.
export function auditorName(): string {
  try {
    return userInfo().username || process.env.USERNAME || 'unknown';
  } catch {
    return process.env.USERNAME ?? process.env.USER ?? 'unknown';
  }
}

const DECISION_STATUS: Record<DecisionError['kind'], number> = {
  'not-found': 404,
  'not-decidable': 409,
  'already-decided': 409,
  'already-validated': 409,
  'no-decision': 404,
};

function asActionError<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof DecisionError) throw new ActionError(DECISION_STATUS[e.kind], e.message);
    throw e;
  }
}

// An auditor settles a speculative candidate the verifier could not, or judges an open finding it confirmed from the
// code alone: confirmed, it is validated; refuted, it leaves the queue. Recorded with the reason, the auditor and the
// time, and kept across runs.
export function decideSpeculative(
  {
    root,
    configPath,
    repo: name,
    fingerprint,
    decision,
    reason,
  }: { root: string; configPath: string; repo: string; fingerprint: string; decision: unknown; reason: unknown },
  { by = auditorName(), now = () => new Date().toISOString() }: { by?: string; now?: () => string } = {},
) {
  if (!FINGERPRINT.test(String(fingerprint))) throw new ActionError(400, 'fingerprint must be 32 hex characters');
  if (decision !== 'confirmed' && decision !== 'refuted') throw new ActionError(400, 'decision must be confirmed or refuted');
  const why = cleanReason(reason);
  configuredRepo(configPath, name);
  const entry = asActionError(() => openStore(layout(root)).decide(name, fingerprint, { verdict: decision, reason: why, decided_by: by, decided_at: now() }));
  return { fingerprint, status: entry.status, decided_by: by };
}

// An auditor corrects the type a finding was given or its personal-data mark. Kept across runs, like a decision.
export function setLabels(
  {
    root,
    configPath,
    repo: name,
    fingerprint,
    kind,
    personal_data,
  }: { root: string; configPath: string; repo: string; fingerprint: string; kind?: unknown; personal_data?: unknown },
  { by = auditorName(), now = () => new Date().toISOString() }: { by?: string; now?: () => string } = {},
) {
  if (!FINGERPRINT.test(String(fingerprint))) throw new ActionError(400, 'fingerprint must be 32 hex characters');
  const k = kind === undefined ? undefined : parseKind(kind);
  if (k === null) throw new ActionError(400, 'kind must be bug, vulnerability or chore');
  if (personal_data !== undefined && typeof personal_data !== 'boolean') throw new ActionError(400, 'personal_data must be true or false');
  const pd = personal_data as boolean | undefined;
  if (k === undefined && pd === undefined) throw new ActionError(400, 'nothing to change: give kind, personal_data or both');
  configuredRepo(configPath, name);
  const entry = asActionError(() =>
    openStore(layout(root)).setLabels(name, fingerprint, { ...(k ? { kind: k } : {}), ...(pd === undefined ? {} : { personal_data: pd }) }, by, now()),
  );
  return { fingerprint, kind: entry.finding.kind ?? null, personal_data: entry.finding.personal_data ?? null, set_by: by };
}

export function undoDecision(
  { root, configPath, repo: name, fingerprint }: { root: string; configPath: string; repo: string; fingerprint: string },
  { by = auditorName(), now = () => new Date().toISOString() }: { by?: string; now?: () => string } = {},
) {
  if (!FINGERPRINT.test(String(fingerprint))) throw new ActionError(400, 'fingerprint must be 32 hex characters');
  configuredRepo(configPath, name);
  const entry = asActionError(() => openStore(layout(root)).undecide(name, fingerprint, by, now()));
  return { fingerprint, status: entry.status };
}

export function unsuppressFinding({ configPath, repo: name, fingerprint }: { configPath: string; repo: string; fingerprint: string }) {
  if (!FINGERPRINT.test(String(fingerprint))) throw new ActionError(400, 'fingerprint must be 32 hex characters');
  configuredRepo(configPath, name);
  return editConfig(configPath, (doc) => {
    const list: unknown = repoNode(doc, name).get('suppressed', true);
    const index = isSeq(list) ? hasFingerprint(list, fingerprint) : -1;
    if (!isSeq(list) || index < 0) throw new ActionError(404, 'not suppressed');
    list.items.splice(index, 1);
    if (list.items.length === 0) list.flow = true;
    return { unsuppressed: fingerprint };
  });
}

export function resolveInClone({ root, repo, file }: { root: string; repo: string; file: unknown }): string {
  if (typeof file !== 'string' || !file || isAbsolute(file) || file.includes('\0')) throw new ActionError(400, 'invalid file');
  const clone = resolve(root, 'workspace', repo);
  const target = resolve(clone, file);
  const rel = relative(clone, target);
  if (!rel || rel.startsWith('..') || isAbsolute(rel) || !target.startsWith(clone + sep)) throw new ActionError(400, 'file is outside the clone');
  if (!existsSync(target)) throw new ActionError(404, 'file is not in the local clone; run an audit first');
  return target;
}

export interface EditorLauncher {
  command: string;
  prefix: string[];
  env: Record<string, string>;
}

// On Windows `code` is a .cmd, which Node refuses to spawn without a shell. Running Code.exe with the CLI script
// the .cmd names reproduces it exactly, with no shell between a finding's path and a process.
export function findVsCode(): EditorLauncher | null {
  if (process.platform !== 'win32') return { command: 'code', prefix: [], env: {} };
  const where = spawnSync('where', ['code.cmd'], { encoding: 'utf8' });
  const cmd =
    where.status === 0
      ? where.stdout
          .split(/\r?\n/)
          .find((l) => l.trim().toLowerCase().endsWith('code.cmd'))
          ?.trim()
      : null;
  if (!cmd) return null;
  const m = /"%~dp0\.\.\\([^"]*cli\.js)"/i.exec(readFileSync(cmd, 'utf8'));
  const exe = join(dirname(cmd), '..', 'Code.exe');
  if (!m || !existsSync(exe)) return null;
  return { command: exe, prefix: [join(dirname(cmd), '..', m[1] as string)], env: { ELECTRON_RUN_AS_NODE: '1', VSCODE_DEV: '' } };
}

const detach = (child: ReturnType<SpawnFn>) => {
  child.on?.('error', () => {});
  child.unref?.();
};

export function openInEditor(
  { root, configPath, repo: name, file, line }: { root: string; configPath: string; repo: string; file: unknown; line: unknown },
  { launcher = findVsCode, spawnFn = spawn }: ActionDeps = {},
) {
  configuredRepo(configPath, name);
  const target = resolveInClone({ root, repo: name, file });
  const ln = Number.isInteger(line) && (line as number) > 0 && (line as number) < 1e7 ? (line as number) : 1;
  const code = launcher();
  if (!code) throw new ActionError(501, 'VS Code was not found on PATH');
  detach(
    spawnFn(code.command, [...code.prefix, '--reuse-window', '-g', `${target}:${ln}`], {
      env: { ...process.env, ...code.env },
      stdio: 'ignore',
      detached: true,
      windowsHide: true,
      shell: false,
    }),
  );
  return { opened: `${String(file)}:${ln}` };
}

export interface StartRunInput {
  root: string;
  configPath: string;
  repos: unknown;
  mode: unknown;
  maxFiles?: unknown;
  analyzers?: unknown;
  untilCovered?: unknown;
  sessionLimit?: unknown;
}

export function startRun(
  { root, configPath, repos, mode, maxFiles = null, analyzers = null, untilCovered = false, sessionLimit = null }: StartRunInput,
  { spawnFn = spawn, cliArgs = [CLI_ENTRY] }: ActionDeps = {},
) {
  if (typeof untilCovered !== 'boolean') throw new ActionError(400, 'until_covered must be true or false');
  if (untilCovered && mode !== 'full') throw new ActionError(400, 'repeat until covered only applies to full mode');
  if (sessionLimit != null && (!untilCovered || !Number.isInteger(sessionLimit) || (sessionLimit as number) < 10 || (sessionLimit as number) > 99)) {
    throw new ActionError(400, 'session limit must be a whole percentage from 10 to 99, with repeat until covered');
  }
  if (!isMode(mode)) throw new ActionError(400, 'mode must be incremental, full or speculative');
  let chosen: Analyzer[] | null = null;
  if (analyzers != null && !(Array.isArray(analyzers) && analyzers.length === 0)) {
    try {
      chosen = parseAnalyzers(analyzers, 'analyzers');
    } catch (e) {
      throw new ActionError(400, errorMessage(e));
    }
  }
  const configured = parseConfig(readFileSync(configPath, 'utf8'), configPath).map((r) => r.name);
  const selected = repos == null ? [] : repos;
  if (!Array.isArray(selected) || selected.some((r) => !configured.includes(r))) throw new ActionError(400, 'unknown repository in selection');
  if (maxFiles != null && !isValidMaxFiles(maxFiles)) throw new ActionError(400, `max files must be an integer from 1 to ${MAX_FILES_CEILING}`);
  const running = activeRun(layout(root).lockFile);
  if (running) throw new ActionError(409, `a run is already in progress (${running.run_id ?? running.pid})`);

  const args = [...cliArgs, 'run', '--mode', mode];
  for (const r of selected as string[]) args.push('--repo', r);
  if (maxFiles != null) args.push('--max-files', String(maxFiles));
  if (chosen) args.push('--analyzers', chosen.join(','));
  if (untilCovered) args.push('--until-covered');
  if (sessionLimit != null) args.push('--session-limit', String(sessionLimit));
  const child = spawnFn(process.execPath, args, { cwd: root, stdio: 'ignore', detached: true, windowsHide: true, shell: false });
  detach(child);
  return {
    started: true,
    pid: child.pid ?? null,
    until_covered: untilCovered,
    session_limit: sessionLimit,
    repos: selected.length ? selected : configured,
    mode: mode as Mode,
    max_files: maxFiles ?? null,
    analyzers: chosen ?? 'per repository',
  };
}

export function requestCancel({ root }: { root: string }) {
  const paths = layout(root);
  const running = activeRun(paths.lockFile);
  if (!running) throw new ActionError(409, 'no run in progress');
  writeFileSync(paths.cancelFile, JSON.stringify({ run_id: running.run_id, at: new Date().toISOString() }));
  return { cancelling: running.run_id };
}

// Last resort when the run does not stop by itself. Safe: state/ is only written after a run succeeds.
export function forceStop({ root }: { root: string }) {
  const running = activeRun(layout(root).lockFile);
  if (!running) throw new ActionError(409, 'no run in progress');
  killTree(running.pid);
  return { killed: running.run_id };
}
