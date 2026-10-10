import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Document, isAlias, isMap, isScalar, isSeq, parseDocument, YAMLMap } from 'yaml';
import { z } from 'zod';
import { scmAuthHeader } from '../audit/repo.js';
import { parseConfig, remoteUrl } from '../config/config.js';
import { checkValue, editableKey, resolveConfig, type Scope } from '../config/editable.js';
import { ActionError, errorMessage } from '../errors.js';
import { gitEnv } from '../git/git.js';
import { layout } from '../paths.js';
import { redact } from '../security/secrets.js';
import { editConfig, repoNode } from './actions.js';

export interface LsRemoteResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export type LsRemoteFn = (args: string[], env: NodeJS.ProcessEnv, timeoutMs: number) => Promise<LsRemoteResult>;

export interface ConfigDeps {
  lsRemote?: LsRemoteFn;
}

export const TEST_TIMEOUT_MS = 20_000;

const SCOPES = ['defaults', 'repo', 'webhook'] as const;

function scopeOf(scope: unknown, name: unknown): { scope: Scope; name: string } {
  if (!(SCOPES as readonly unknown[]).includes(scope)) throw new ActionError(400, 'scope must be defaults, repo or webhook');
  if (scope !== 'defaults' && (typeof name !== 'string' || !name)) throw new ActionError(400, `scope ${String(scope)} needs a name`);
  return { scope: scope as Scope, name: typeof name === 'string' ? name : '' };
}

function webhookNode(doc: Document, name: string): YAMLMap {
  const hooks = doc.getIn(['notifications', 'webhooks'], true);
  const node = isSeq(hooks) ? hooks.items.find((item): item is YAMLMap => isMap(item) && item.get('name') === name) : undefined;
  if (!node) throw new ActionError(400, `webhook "${name}" is not in repos.yaml`);
  return node;
}

function scopeNode(doc: Document, scope: Scope, name: string, create: boolean): YAMLMap | null {
  if (scope === 'repo') return repoNode(doc, name);
  if (scope === 'webhook') return webhookNode(doc, name);
  const node = doc.get('defaults', true);
  if (isAlias(node)) throw new ActionError(409, 'defaults is a YAML alias; change it in repos.yaml');
  if (isMap(node)) return node;
  if (!create) return null;
  const map = new YAMLMap();
  doc.set('defaults', map);
  return map;
}

// The maps from the scope down to the key's parent, so emptied ones can be removed afterwards. A shared YAML node
// would carry the edit into every place that refers to it, so aliases are refused.
function walk(scopeMap: YAMLMap, parts: string[], create: boolean): YAMLMap[] | null {
  const chain = [scopeMap];
  for (const part of parts.slice(0, -1)) {
    const parent = chain[chain.length - 1] as YAMLMap;
    let child: unknown = parent.get(part, true);
    if (isAlias(child)) throw new ActionError(409, `${part} is a YAML alias shared with other entries; change it in repos.yaml`);
    if (child === undefined || child === null) {
      if (!create) return null;
      child = new YAMLMap();
      parent.set(part, child);
    }
    if (!isMap(child)) throw new ActionError(409, `${part} is not a mapping in repos.yaml`);
    chain.push(child);
  }
  const last = (chain[chain.length - 1] as YAMLMap).get(parts[parts.length - 1], true);
  if (isAlias(last)) throw new ActionError(409, `${parts.join('.')} is a YAML alias shared with other entries; change it in repos.yaml`);
  return chain;
}

function prune(chain: YAMLMap[], parts: string[]): void {
  for (let i = chain.length - 1; i > 0; i--) {
    if ((chain[i] as YAMLMap).items.length) return;
    (chain[i - 1] as YAMLMap).delete(parts[i - 1]);
  }
}

export function setConfigValue({ configPath, scope, name, key, value }: { configPath: string; scope: unknown; name?: unknown; key: unknown; value: unknown }) {
  const target = scopeOf(scope, name);
  if (typeof key !== 'string') throw new ActionError(400, 'key must be a string');
  const checked = checkValue(target.scope, key, value);
  const parts = key.split('.');
  return editConfig(
    configPath,
    (doc) => {
      const scopeMap = scopeNode(doc, target.scope, target.name, true) as YAMLMap;
      const chain = walk(scopeMap, parts, true) as YAMLMap[];
      const parent = chain[chain.length - 1] as YAMLMap;
      const leaf = parts[parts.length - 1] as string;
      // A list that adds to the defaults is the same as no list when empty.
      if (editableKey(target.scope, key)?.appends && Array.isArray(checked) && checked.length === 0) {
        parent.delete(leaf);
        prune(chain, parts);
        return { ...target, key, value: checked };
      }
      const existing = parent.get(leaf, true);
      if (isScalar(existing) && !Array.isArray(checked)) existing.value = checked;
      else {
        const node = doc.createNode(checked);
        if (isSeq(node)) node.flow = node.items.length === 0;
        parent.set(leaf, node);
      }
      return { ...target, key, value: checked };
    },
    { invalidStatus: 400 },
  );
}

export function unsetConfigValue({ configPath, scope, name, key }: { configPath: string; scope: unknown; name?: unknown; key: unknown }) {
  const target = scopeOf(scope, name);
  if (typeof key !== 'string' || !editableKey(target.scope, key)) throw new ActionError(400, `${String(key)} cannot be changed from the dashboard`);
  const parts = key.split('.');
  return editConfig(
    configPath,
    (doc) => {
      const scopeMap = scopeNode(doc, target.scope, target.name, false);
      const chain = scopeMap && walk(scopeMap, parts, false);
      const parent = chain?.[chain.length - 1];
      if (!chain || !parent?.has(parts[parts.length - 1])) throw new ActionError(404, `${key} is not set there`);
      parent.delete(parts[parts.length - 1]);
      prune(chain, parts);
      return { ...target, key };
    },
    { invalidStatus: 400 },
  );
}

const NEW_REPO = z.strictObject({
  provider: z.enum(['azure-devops', 'github'], { error: 'provider must be azure-devops or github' }),
  name: z.string().trim().min(1).optional(),
  organization: z.string({ error: 'organization is required' }).trim().min(1, 'organization is required'),
  project: z.string().trim().min(1).optional(),
  repo: z.string({ error: 'repo is required' }).trim().min(1, 'repo is required'),
  branch: z.string().trim().min(1).optional(),
});

type NewRepo = z.output<typeof NEW_REPO>;

function newRepo(entry: unknown): NewRepo {
  const parsed = NEW_REPO.safeParse(entry);
  if (parsed.success) {
    if (parsed.data.provider === 'github' && parsed.data.project) throw new ActionError(400, 'project is only for Azure DevOps; GitHub uses the organization');
    return parsed.data;
  }
  const issue = parsed.error.issues[0];
  if (issue?.code === 'unrecognized_keys') throw new ActionError(400, `${issue.keys.join(', ')} cannot be set from the dashboard; add it in repos.yaml`);
  throw new ActionError(400, issue?.message ?? 'invalid repository');
}

function appendEntry(doc: Document, entry: NewRepo): void {
  const repos = doc.get('repos', true);
  if (!isSeq(repos)) throw new ActionError(500, 'repos.yaml has no "repos" list');
  const node = new YAMLMap();
  for (const key of ['name', 'provider', 'organization', 'project', 'repo', 'branch'] as const) if (entry[key] !== undefined) node.set(key, entry[key]);
  // A pat_env in defaults names the defaults' provider's token; inherited by the other provider, it would send that
  // token to the wrong host. The fixed default for the entry's own provider is the only variable written here.
  const defaultsProvider = doc.getIn(['defaults', 'provider']) ?? 'azure-devops';
  if (doc.hasIn(['defaults', 'pat_env']) && entry.provider !== defaultsProvider) {
    node.set('pat_env', entry.provider === 'github' ? 'REPOSCOUT_GITHUB_TOKEN' : 'REPOSCOUT_ADO_PAT');
  }
  repos.flow = false;
  repos.items.push(node);
}

export function addRepository({ configPath, entry }: { configPath: string; entry: unknown }) {
  const repo = newRepo(entry);
  const name = repo.name ?? repo.repo;
  if (parseConfig(readFileSync(configPath, 'utf8'), configPath).some((r) => r.name === name)) {
    throw new ActionError(409, `a repository named "${name}" is already configured`);
  }
  return editConfig(
    configPath,
    (doc) => {
      appendEntry(doc, repo);
      return { added: name };
    },
    { invalidStatus: 400 },
  );
}

export function removeRepository({ configPath, repo: name }: { configPath: string; repo: string }) {
  return editConfig(configPath, (doc) => {
    const node = repoNode(doc, name);
    const repos = doc.get('repos', true);
    if (!isSeq(repos)) throw new ActionError(500, 'repos.yaml has no "repos" list');
    if (repos.items.length <= 1) throw new ActionError(409, 'the only configured repository cannot be removed');
    repos.items.splice(repos.items.indexOf(node), 1);
    return { removed: name };
  });
}

const runLsRemote: LsRemoteFn = (args, env, timeoutMs) =>
  new Promise((resolvePromise) => {
    execFile('git', args, { env, timeout: timeoutMs, windowsHide: true, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      const e = error as (NodeJS.ErrnoException & { killed?: boolean; code?: number | string }) | null;
      resolvePromise({ code: e ? (typeof e.code === 'number' ? e.code : null) : 0, stdout: String(stdout), stderr: String(stderr), timedOut: !!e?.killed });
    });
  });

const NO_ACCESS = /not found|does not exist|TF401019|authentication failed|could not read username|terminal prompts disabled|\b40[134]\b/i;

export type TestOutcome = 'reachable' | 'branch-missing' | 'no-access' | 'token-missing' | 'failed';

// Lists the branch on the remote with the credentials a run would use. Nothing is written to disk.
export async function testRepository(
  { root, configPath, entry }: { root: string; configPath: string; entry: unknown },
  { lsRemote = runLsRemote }: ConfigDeps = {},
) {
  const proposed = newRepo(entry);
  const doc = parseDocument(readFileSync(configPath, 'utf8'));
  appendEntry(doc, proposed);
  let repo: ReturnType<typeof parseConfig>[number];
  try {
    repo = parseConfig(doc.toString(), configPath).at(-1) as ReturnType<typeof parseConfig>[number];
  } catch (e) {
    throw new ActionError(400, errorMessage(e));
  }
  const reply = (result: TestOutcome, detail: string) => ({ result, detail });
  if (repo.provider === 'azure-devops' && !process.env.REPOSCOUT_ADO_BEARER && !process.env[repo.pat_env]) {
    return reply('token-missing', `${repo.pat_env} is not set`);
  }
  const env = gitEnv({ authHeader: scmAuthHeader(repo), hooksDir: join(layout(root).workspaceDir, '.no-hooks') });
  const r = await lsRemote(['ls-remote', '--heads', remoteUrl(repo), `refs/heads/${repo.branch}`], env, TEST_TIMEOUT_MS);
  if (r.timedOut) return reply('failed', `no answer within ${TEST_TIMEOUT_MS / 1000} s`);
  if (r.code === 0) return r.stdout.trim() ? reply('reachable', `branch ${repo.branch} found`) : reply('branch-missing', `no branch ${repo.branch}`);
  const stderr = redact(r.stderr).trim().slice(0, 500);
  if (NO_ACCESS.test(stderr)) return reply('no-access', stderr || 'the repository was not found or the token has no access');
  return reply('failed', stderr || `git exited with ${r.code ?? 'an error'}`);
}

export function readConfigView(configPath: string) {
  return resolveConfig(readFileSync(configPath, 'utf8'), configPath);
}
