import { type SpawnSyncOptionsWithStringEncoding, type SpawnSyncReturns, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { redact, registerSecret } from '../security/secrets.js';
import type { Logger } from '../telemetry/logger.js';

const DISABLED_PUSH_URL = 'reposcout-push-disabled://read-only';

// Config travels through GIT_CONFIG_* variables so the auth header never reaches argv, .git/config or a URL.
// The file protocol stays off except for the local provider of the tests and the evaluation, which clones from disk.
export function gitEnv({
  authHeader,
  hooksDir,
  allowFileProtocol = false,
}: {
  authHeader: string | null;
  hooksDir: string;
  allowFileProtocol?: boolean;
}): NodeJS.ProcessEnv {
  const config: [string, string][] = [
    ['core.hooksPath', hooksDir],
    ['core.fsmonitor', 'false'],
    ['credential.helper', ''],
    ['protocol.file.allow', allowFileProtocol ? 'always' : 'never'],
    ['submodule.recurse', 'false'],
    ['advice.detachedHead', 'false'],
    // A transfer slower than 1 KB/s for two minutes is stalled; git aborts it instead of holding state/.lock.
    ['http.lowSpeedLimit', '1000'],
    ['http.lowSpeedTime', '120'],
  ];
  if (authHeader) config.push(['http.extraHeader', authHeader]);
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', GIT_LFS_SKIP_SMUDGE: '1' };
  for (const k of Object.keys(env)) if (/^GIT_CONFIG_(COUNT|KEY_|VALUE_)/.test(k)) delete env[k];
  env.GIT_CONFIG_COUNT = String(config.length);
  config.forEach(([k, v], i) => {
    env[`GIT_CONFIG_KEY_${i}`] = k;
    env[`GIT_CONFIG_VALUE_${i}`] = v;
  });
  return env;
}

// Azure DevOps ignores the Basic user; GitHub needs one, and x-access-token works for every token type.
export function authHeaderFor({ pat, bearer, user = '' }: { pat?: string; bearer?: string; user?: string }): string {
  registerSecret(bearer);
  if (bearer) return `Authorization: Bearer ${bearer}`;
  const basic = Buffer.from(`${user}:${pat}`).toString('base64');
  // The encoded form does not contain the PAT, so redacting the PAT alone would leave the header readable.
  registerSecret(basic);
  return `Authorization: Basic ${basic}`;
}

export interface GitResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

export type SpawnSyncFn = (command: string, args: string[], options: SpawnSyncOptionsWithStringEncoding) => SpawnSyncReturns<string>;

// A run holds state/.lock throughout, so no git call may wait forever: network commands get long enough for a
// large shallow fetch, local ones far less.
const NETWORK_COMMANDS = new Set(['clone', 'fetch', 'pull', 'ls-remote']);
export const GIT_NETWORK_TIMEOUT_MS = 15 * 60_000;
export const GIT_LOCAL_TIMEOUT_MS = 2 * 60_000;

export class Git {
  constructor(
    readonly dir: string,
    private readonly env: NodeJS.ProcessEnv,
    private readonly spawnFn: SpawnSyncFn = spawnSync,
  ) {}

  run(args: string[], { allowFail = false, maxBuffer = 256 * 1024 * 1024 } = {}): GitResult {
    const timeout = NETWORK_COMMANDS.has(args[0] ?? '') ? GIT_NETWORK_TIMEOUT_MS : GIT_LOCAL_TIMEOUT_MS;
    // The default SIGTERM, not SIGKILL, so git still removes its .lock files and the next run can use the clone.
    const r = this.spawnFn('git', ['-C', this.dir, ...args], { env: this.env, encoding: 'utf8', maxBuffer, timeout, windowsHide: true });
    // A timeout throws even with allowFail: the caller would otherwise take a hung remote for a missing commit.
    if ((r.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT') {
      throw new Error(`git ${args[0]} timed out after ${timeout / 60_000} min and was stopped`);
    }
    if (r.error) throw r.error;
    if (r.status !== 0 && !allowFail) {
      throw new Error(`git ${args[0]} failed (${r.status}): ${redact(r.stderr).trim().slice(0, 800)}`);
    }
    return { ok: r.status === 0, stdout: r.stdout, stderr: redact(r.stderr) };
  }

  out(args: string[]): string {
    return this.run(args).stdout.trim();
  }

  hasCommit(sha: string | null | undefined): boolean {
    return !!sha && this.run(['cat-file', '-e', `${sha}^{commit}`], { allowFail: true }).ok;
  }
}

export function prepareClone({ dir, url, branch, env, log }: { dir: string; url: string; branch: string; env: NodeJS.ProcessEnv; log: Logger }) {
  mkdirSync(dir, { recursive: true });
  const git = new Git(dir, env);
  if (!existsSync(join(dir, '.git'))) {
    git.out(['init', '--quiet']);
    git.out(['remote', 'add', 'origin', url]);
    log.info('initialised clone', { dir });
  } else {
    git.out(['remote', 'set-url', 'origin', url]);
  }
  git.out(['remote', 'set-url', '--push', 'origin', DISABLED_PUSH_URL]);
  // Repo-owned Claude config must never be loaded by the auditor, so it is kept out of the working tree.
  git.out(['config', 'core.sparseCheckout', 'true']);
  git.out(['sparse-checkout', 'set', '--no-cone', '/*', '!.claude/', '!CLAUDE.local.md', '!.mcp.json']);

  git.out(['fetch', '--quiet', '--depth=1', '--no-tags', 'origin', `+refs/heads/${branch}:refs/remotes/origin/${branch}`]);
  const head = git.out(['rev-parse', `refs/remotes/origin/${branch}^{commit}`]);
  git.out(['checkout', '--quiet', '--force', '--detach', head]);
  git.out(['clean', '-ffdxq']);
  return { git, head };
}

export function ensureBaseCommit({ git, sha, log }: { git: Git; sha: string; log: Logger }): boolean {
  if (git.hasCommit(sha)) return true;
  if (git.run(['fetch', '--quiet', '--depth=1', '--no-tags', 'origin', sha], { allowFail: true }).ok && git.hasCommit(sha)) {
    return true;
  }
  log.warn('last audited commit is no longer reachable on the remote', { sha });
  return false;
}

export interface ChangedFile {
  status: string;
  path: string;
  old_path?: string;
  additions: number;
  deletions: number;
}

export function changedFiles({ git, from, to }: { git: Git; from: string; to: string }): ChangedFile[] {
  const raw = git.out(['diff', '--name-status', '-M', '-z', from, to]);
  const parts = raw.split('\0').filter(Boolean);
  const changes: ChangedFile[] = [];
  for (let i = 0; i < parts.length; ) {
    const status = parts[i++] as string;
    if (status.startsWith('R') || status.startsWith('C')) {
      const oldPath = parts[i++] as string;
      changes.push({ status: status[0] as string, path: parts[i++] as string, old_path: oldPath, additions: 0, deletions: 0 });
    } else {
      changes.push({ status: status[0] as string, path: parts[i++] as string, additions: 0, deletions: 0 });
    }
  }
  // numstat -z: "add\tdel\tpath\0", or "add\tdel\t\0old\0new\0" for a rename.
  const stats = new Map<string, { additions: number; deletions: number }>();
  const tokens = git.run(['diff', '--numstat', '-M', '-z', from, to]).stdout.split('\0');
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token) continue;
    const [add, del, path] = token.split('\t');
    let target = path;
    if (path === '') {
      i += 2;
      target = tokens[i];
    }
    if (target) stats.set(target, { additions: Number(add) || 0, deletions: Number(del) || 0 });
  }
  for (const c of changes) Object.assign(c, stats.get(c.path));
  return changes;
}

export function trackedFiles(git: Git): string[] {
  return git.out(['ls-files', '-z']).split('\0').filter(Boolean);
}

export function writeDiff({ git, from, to, files, maxBytes }: { git: Git; from: string; to: string; files: string[]; maxBytes: number }): string {
  if (files.length === 0) return '';
  const diff = git.run(['diff', '-M', '--no-color', '--no-ext-diff', from, to, '--', ...files]).stdout;
  if (Buffer.byteLength(diff) <= maxBytes) return diff;
  return `${diff.slice(0, maxBytes)}\n\n[reposcout: diff truncated at ${maxBytes} bytes; read the files directly]\n`;
}

export function addVerifyWorktree({ git, path, head }: { git: Git; path: string; head: string }): void {
  removeVerifyWorktree({ git, path });
  git.out(['worktree', 'add', '--quiet', '--force', '--detach', path, head]);
}

export function removeVerifyWorktree({ git, path }: { git: Git; path: string }): void {
  git.run(['worktree', 'remove', '--force', path], { allowFail: true });
  rmSync(path, { recursive: true, force: true });
  git.run(['worktree', 'prune'], { allowFail: true });
}
