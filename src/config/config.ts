import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse } from 'yaml';
import { z } from 'zod';
import { SEVERITIES } from '../findings/types.js';
import { ANALYZERS, AUTH_MODES, isValidMaxFiles, MODES, maxFilesMessage, parseAnalyzers } from './analyzers.js';

const MODEL_ALIASES = ['haiku', 'sonnet', 'opus', 'fable'];
const NAME = /^[A-Za-z0-9._-]+$/;
const SHELL_OPERATORS = /[;&|><`$\r\n]/;
const SUPPRESSION_ERROR = 'has a suppressed entry without a 32-hex fingerprint and a reason.';

const identifier = (key: string) =>
  z.string({ error: `has an invalid or missing "${key}".` }).refine((v) => NAME.test(v.replace(/ /g, '')), `has an invalid or missing "${key}".`);

const model = z
  .string()
  .refine((m) => MODEL_ALIASES.includes(m) || /^claude-[a-z0-9-]+$/.test(m), { error: (iss) => `uses unknown model "${String(iss.input)}".` });

const positiveInt = z.number().int().positive();
const maxFiles = (key: string) => z.number().refine(isValidMaxFiles, maxFilesMessage(key));

const claudeSchema = z.object({
  models: z.object({ orchestrator: model.default('sonnet'), specialists: model.default('sonnet'), verifier: model.default('opus') }).prefault({}),
  fallback_model: model.optional(),
  // max_turns bounds the orchestrator; subagent_max_turns bounds each specialist and the verifier.
  max_turns: positiveInt.default(60),
  subagent_max_turns: z
    .strictObject(
      { specialists: positiveInt.optional(), verifier: positiveInt.optional() },
      { error: 'claude.subagent_max_turns takes positive integers for specialists or verifier.' },
    )
    .prefault({}),
  timeout_minutes: z.number().positive().default(45),
  auth: z.enum(AUTH_MODES).default('isolated'),
});

// `local` clones a git repository on this disk; it exists for the end-to-end tests and the evaluation harness.
export const PROVIDERS = ['azure-devops', 'github', 'local'] as const;
export const ALLOW_LOCAL_ENV = 'REPOSCOUT_ALLOW_LOCAL_PROVIDER';
const LOCAL_ERROR = `uses provider "local", which is only for tests and evaluation; set ${ALLOW_LOCAL_ENV}=1 to allow it.`;

const repoSchema = z.looseObject({
  provider: z.enum(PROVIDERS, { error: 'has an unknown "provider"; use azure-devops or github.' }).default('azure-devops'),
  // With provider local: the directory of the git repository to clone from.
  path: z.string().min(1).optional(),
  // On GitHub, organization is the owner (user or organisation) and project defaults to it.
  organization: identifier('organization'),
  project: identifier('project'),
  repo: identifier('repo'),
  name: identifier('name'),
  branch: z
    .string()
    .regex(/^[A-Za-z0-9._/-]+$/, 'has an invalid branch.')
    .default('main'),
  pat_env: z.string().min(1),
  mode: z.enum(MODES).optional(),
  analyzers: z.unknown().transform((value, ctx) => {
    try {
      return parseAnalyzers(value, 'analyzers');
    } catch (e) {
      ctx.addIssue({ code: 'custom', message: (e as Error).message });
      return z.NEVER;
    }
  }),
  max_files_per_run: maxFiles('max_files_per_run').default(40),
  max_files_full_run: maxFiles('max_files_full_run').optional(),
  // Files larger than this are never audited (generated code, bundles, fixtures).
  max_file_bytes: positiveInt.default(200_000),
  excluded_paths: z.array(z.string()).default([]),
  focus_paths: z.array(z.string()).default([]),
  focus_areas: z.array(z.string()).default([]),
  // What the owner vouches for and the code cannot show: scale, deployment, intent. Unlike anything in the clone,
  // the auditors treat these as trusted, so they can settle a candidate that hinges on one.
  facts: z
    .array(z.string().trim().min(1, 'facts cannot hold an empty entry.').max(500, 'each entry in facts must be at most 500 characters.'), {
      error: 'facts must be a list of sentences.',
    })
    .max(30, 'facts can hold at most 30 entries.')
    .default([]),
  suppressed: z
    .array(
      z.object(
        { fingerprint: z.string().regex(/^[0-9a-f]{32}$/, SUPPRESSION_ERROR), reason: z.string().trim().min(1, SUPPRESSION_ERROR) },
        { error: SUPPRESSION_ERROR },
      ),
      { error: 'suppressed must be a list.' },
    )
    .default([]),
  test_command: z
    .string()
    .refine((c) => !SHELL_OPERATORS.test(c), 'test_command must be one plain command with no shell operators.')
    .nullish(),
  // Where Claude Code has no sandbox (native Windows), test_command runs only with this explicit opt-in.
  test_command_unsandboxed: z.boolean({ error: 'test_command_unsandboxed must be true or false.' }).default(false),
  claude: claudeSchema.prefault({}),
});

// A local path opens git's file protocol, which a shared repos.yaml must never be able to switch on by itself.
const checkedRepoSchema = repoSchema.superRefine((repo, ctx) => {
  if (repo.provider !== 'local') return;
  if (process.env[ALLOW_LOCAL_ENV] !== '1') ctx.addIssue({ code: 'custom', message: LOCAL_ERROR, path: ['provider'] });
  else if (!repo.path) ctx.addIssue({ code: 'custom', message: 'uses provider "local" without a "path" to the git repository.', path: ['path'] });
});

export type RepoConfig = z.output<typeof repoSchema>;
export type ClaudeConfig = RepoConfig['claude'];

type Plain = Record<string, unknown>;
const isPlain = (v: unknown): v is Plain => typeof v === 'object' && v !== null && !Array.isArray(v);

function merge(base: unknown, override: unknown): unknown {
  if (override === undefined) return base;
  if (!isPlain(base) || !isPlain(override)) return override;
  const out: Plain = { ...base };
  for (const [k, v] of Object.entries(override)) out[k] = merge(base[k], v);
  return out;
}

export function loadConfig(path: string): RepoConfig[] {
  // repos.yaml is each user's own and is not versioned; the repository ships repos.example.yaml as its template.
  if (!existsSync(path)) throw new Error(`${path} not found. Copy repos.example.yaml to repos.yaml and list your repositories in it.`);
  return parseConfig(readFileSync(path, 'utf8'), path);
}

// Separate from loadConfig so an edit can be validated before it is written to disk.
export function parseConfig(text: string, path = 'repos.yaml'): RepoConfig[] {
  const doc: unknown = parse(text) ?? {};
  const root = isPlain(doc) ? doc : {};
  const defaults = isPlain(root.defaults) ? root.defaults : {};
  if (!Array.isArray(root.repos) || root.repos.length === 0) throw new Error(`${path}: "repos" must be a non-empty list.`);

  return root.repos.map((raw: unknown) => {
    const entry = isPlain(raw) ? raw : {};
    const merged = merge(defaults, entry) as Plain;
    // Exclusions add up instead of replacing the defaults.
    merged.excluded_paths = [...asArray(defaults.excluded_paths), ...asArray(entry.excluded_paths)];
    // So do facts: what holds for every repository stays true for each one. Anything but a list is left for the
    // schema to reject.
    const factLists = [defaults.facts, entry.facts].filter((f) => f !== undefined);
    if (factLists.every(Array.isArray)) merged.facts = factLists.flat();
    if (merged.provider === 'local') {
      // Only the path matters; the names default so a test or evaluation config stays short.
      if (typeof merged.path === 'string') merged.path = resolve(dirname(path), merged.path);
      merged.repo ??= merged.name ?? (typeof merged.path === 'string' ? basename(merged.path) : undefined);
      merged.organization ??= 'local';
      merged.project ??= 'local';
    }
    merged.name ??= merged.repo;
    merged.analyzers ??= [...ANALYZERS];
    const github = merged.provider === 'github';
    if (github) merged.project ??= merged.organization;
    merged.pat_env ??= github ? 'REPOSCOUT_GITHUB_TOKEN' : 'REPOSCOUT_ADO_PAT';
    const parsed = checkedRepoSchema.safeParse(merged);
    if (parsed.success) return parsed.data;
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? ` (${issue.path.join('.')})` : '';
    throw new Error(`${path}: repo "${String(entry.name ?? entry.repo)}" ${issue?.message ?? 'is invalid.'}${where}`);
  });
}

const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

// Top-level `notifications`: where the end of a run is announced. The URL is a secret, so the file only names the
// environment variable that holds it.
export const WEBHOOK_FORMATS = ['teams', 'slack', 'generic'] as const;

const webhookSchema = z.strictObject({
  name: z.string().regex(NAME, 'needs a "name" of letters, digits, ".", "_" or "-".'),
  // REPOSCOUT_* variables are removed from Claude's environment, so the audit session never sees the URL.
  url_env: z.string().regex(/^REPOSCOUT_[A-Z0-9_]+$/, 'needs "url_env", the environment variable holding the URL, named REPOSCOUT_<something>.'),
  format: z.enum(WEBHOOK_FORMATS, { error: `needs a "format": ${WEBHOOK_FORMATS.join(', ')}.` }),
  min_severity: z.enum(SEVERITIES, { error: `has an unknown "min_severity"; use ${SEVERITIES.join(', ')}.` }).default('high'),
  on_failure: z.boolean().default(true),
});

const notificationsSchema = z.strictObject({ webhooks: z.array(webhookSchema).default([]) }).prefault({});

export type WebhookConfig = z.output<typeof webhookSchema>;

export function loadNotifications(path: string): WebhookConfig[] {
  return parseNotifications(readFileSync(path, 'utf8'), path);
}

export function parseNotifications(text: string, path = 'repos.yaml'): WebhookConfig[] {
  const doc: unknown = parse(text) ?? {};
  const parsed = notificationsSchema.safeParse(isPlain(doc) ? (doc.notifications ?? undefined) : undefined);
  if (parsed.success) return parsed.data.webhooks;
  const issue = parsed.error.issues[0];
  const where = issue?.path.length ? ` (notifications.${issue.path.join('.')})` : '';
  throw new Error(`${path}: a notifications webhook ${issue?.message ?? 'is invalid.'}${where}`);
}

export function remoteUrl(repo: Pick<RepoConfig, 'provider' | 'organization' | 'project' | 'repo' | 'path'>): string {
  const enc = encodeURIComponent;
  if (repo.provider === 'local') return pathToFileURL(repo.path as string).href;
  if (repo.provider === 'github') return `https://github.com/${enc(repo.organization)}/${enc(repo.repo)}.git`;
  return `https://dev.azure.com/${enc(repo.organization)}/${enc(repo.project)}/_git/${enc(repo.repo)}`;
}
