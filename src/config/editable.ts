import { parse } from 'yaml';
import { z } from 'zod';
import { ActionError } from '../errors.js';
import { SEVERITIES } from '../findings/types.js';
import { ANALYZERS, isValidMaxFiles, MODES, maxFilesMessage, parseAnalyzers } from './analyzers.js';
import {
  BRANCH,
  JIRA_ISSUE,
  JIRA_PROJECT,
  type JiraSite,
  MODEL_ALIASES,
  model,
  parseConfig,
  parseJiraSite,
  parseNotifications,
  type RepoConfig,
  WEBHOOK_FORMATS,
  type WebhookConfig,
} from './config.js';

export type FieldKind = 'text' | 'enum' | 'multi' | 'int' | 'number' | 'list' | 'model' | 'boolean';
export type Scope = 'defaults' | 'repo' | 'webhook';

export interface KeySpec {
  key: string;
  label: string;
  kind: FieldKind;
  options?: readonly string[];
  // excluded_paths and facts: a repository's list adds to the defaults' list instead of replacing it.
  appends?: boolean;
  warn?: 'analyzers' | 'facts';
}

interface EditableKey extends KeySpec {
  schema: z.ZodType;
  scopes: readonly Scope[];
}

const positiveInt = z.number({ error: 'must be a whole number.' }).int('must be a whole number.').positive('must be greater than 0.');
const textList = z.array(z.string().trim().min(1, 'cannot hold an empty entry.'), { error: 'must be a list of text.' });
const maxFiles = (key: string) => z.number({ error: 'must be a whole number.' }).refine(isValidMaxFiles, maxFilesMessage(key));
const analyzers = z.unknown().transform((value, ctx) => {
  try {
    return parseAnalyzers(value);
  } catch (e) {
    ctx.addIssue({ code: 'custom', message: (e as Error).message });
    return z.NEVER;
  }
});

const REPO_SCOPES = ['repo', 'defaults'] as const;

const EDITABLE: readonly EditableKey[] = [
  { key: 'branch', label: 'Branch', kind: 'text', schema: z.string().regex(BRANCH, 'is not a valid branch name.'), scopes: REPO_SCOPES },
  { key: 'mode', label: 'Default mode', kind: 'enum', options: MODES, schema: z.enum(MODES), scopes: REPO_SCOPES },
  { key: 'analyzers', label: 'Analyzers', kind: 'multi', options: ANALYZERS, schema: analyzers, scopes: REPO_SCOPES, warn: 'analyzers' },
  { key: 'max_files_per_run', label: 'Files per run', kind: 'int', schema: maxFiles('max_files_per_run'), scopes: REPO_SCOPES },
  { key: 'max_files_full_run', label: 'Files per full run', kind: 'int', schema: maxFiles('max_files_full_run'), scopes: REPO_SCOPES },
  { key: 'max_file_bytes', label: 'Largest file audited (bytes)', kind: 'int', schema: positiveInt, scopes: REPO_SCOPES },
  { key: 'focus_paths', label: 'Focus paths', kind: 'list', schema: textList, scopes: REPO_SCOPES },
  { key: 'focus_areas', label: 'Focus areas', kind: 'list', schema: textList, scopes: REPO_SCOPES },
  { key: 'excluded_paths', label: 'Excluded paths', kind: 'list', appends: true, schema: textList, scopes: REPO_SCOPES },
  { key: 'facts', label: 'Owner facts', kind: 'list', appends: true, schema: textList, scopes: REPO_SCOPES, warn: 'facts' },
  { key: 'claude.models.orchestrator', label: 'Orchestrator model', kind: 'model', options: MODEL_ALIASES, schema: model, scopes: REPO_SCOPES },
  { key: 'claude.models.specialists', label: 'Specialists model', kind: 'model', options: MODEL_ALIASES, schema: model, scopes: REPO_SCOPES },
  { key: 'claude.models.verifier', label: 'Verifier model', kind: 'model', options: MODEL_ALIASES, schema: model, scopes: REPO_SCOPES },
  { key: 'claude.fallback_model', label: 'Fallback model', kind: 'model', options: MODEL_ALIASES, schema: model, scopes: REPO_SCOPES },
  { key: 'claude.max_turns', label: 'Orchestrator turns', kind: 'int', schema: positiveInt, scopes: REPO_SCOPES },
  { key: 'claude.subagent_max_turns.specialists', label: 'Specialist turns', kind: 'int', schema: positiveInt, scopes: REPO_SCOPES },
  { key: 'claude.subagent_max_turns.verifier', label: 'Verifier turns', kind: 'int', schema: positiveInt, scopes: REPO_SCOPES },
  {
    key: 'claude.timeout_minutes',
    label: 'Timeout (minutes)',
    kind: 'number',
    schema: z.number({ error: 'must be a number.' }).positive('must be greater than 0.'),
    scopes: REPO_SCOPES,
  },
  { key: 'jira.project', label: 'Jira project', kind: 'text', schema: z.string().regex(JIRA_PROJECT, 'is not a Jira project key.'), scopes: REPO_SCOPES },
  { key: 'jira.issue_type', label: 'Jira issue type', kind: 'text', schema: z.string().trim().min(1, 'cannot be empty.'), scopes: REPO_SCOPES },
  {
    key: 'jira.parent',
    label: 'Jira parent',
    kind: 'text',
    schema: z.string().regex(JIRA_ISSUE, 'is not an issue key such as PROJ-123.'),
    scopes: REPO_SCOPES,
  },
  {
    key: 'jira.labels',
    label: 'Jira labels',
    kind: 'list',
    schema: z.array(z.string().regex(/^\S+$/, 'cannot hold a space; Jira labels cannot.')),
    scopes: REPO_SCOPES,
  },
  { key: 'format', label: 'Format', kind: 'enum', options: WEBHOOK_FORMATS, schema: z.enum(WEBHOOK_FORMATS), scopes: ['webhook'] },
  { key: 'min_severity', label: 'Minimum severity', kind: 'enum', options: SEVERITIES, schema: z.enum(SEVERITIES), scopes: ['webhook'] },
  { key: 'on_failure', label: 'Announce failed runs', kind: 'boolean', schema: z.boolean({ error: 'must be true or false.' }), scopes: ['webhook'] },
];

const IDENTITY = 'Identifies the repository and its history; change it in repos.yaml.';
const RUNS = 'Decides what runs on this machine; change it in repos.yaml.';
const CREDENTIAL = 'Names where a credential is read from; change it in repos.yaml.';

// Shown but never written by the dashboard, with the reason the page gives.
export const READ_ONLY: Readonly<Record<string, { label: string; reason: string }>> = {
  name: { label: 'Name', reason: IDENTITY },
  provider: { label: 'Provider', reason: IDENTITY },
  organization: { label: 'Organization', reason: IDENTITY },
  project: { label: 'Project', reason: IDENTITY },
  repo: { label: 'Repository', reason: IDENTITY },
  path: { label: 'Local path', reason: IDENTITY },
  pat_env: { label: 'Token variable', reason: CREDENTIAL },
  test_command: { label: 'Test command', reason: RUNS },
  test_command_unsandboxed: { label: 'Tests without a sandbox', reason: RUNS },
  'claude.auth': { label: 'Claude authentication', reason: RUNS },
  'jira.fields': { label: 'Jira field defaults', reason: 'Free-form Jira field values; change them in repos.yaml.' },
};

const DEFAULTS_HIDDEN = new Set(['name', 'repo', 'path']);

export function editableKey(scope: Scope, key: string): EditableKey | null {
  return EDITABLE.find((k) => k.key === key && k.scopes.includes(scope)) ?? null;
}

// Checks a value against its key's own rule, so the error names the field; rules across keys are left to parseConfig.
export function checkValue(scope: Scope, key: string, value: unknown): unknown {
  const spec = editableKey(scope, key);
  if (!spec) throw new ActionError(400, `${key} cannot be changed from the dashboard`);
  const parsed = spec.schema.safeParse(value);
  if (!parsed.success) throw new ActionError(400, `${spec.label} ${parsed.error.issues[0]?.message ?? 'is invalid.'}`);
  return parsed.data;
}

export type Origin = 'repo' | 'defaults' | 'derived' | 'built-in' | 'unset';

export interface FieldView {
  key: string;
  value: unknown;
  origin: Origin;
  // Whether this scope sets the key itself, which is when Reset to default applies.
  set_here: boolean;
  editable: boolean;
  reason?: string;
  // For the lists that add up: the defaults' entries, then the scope's own.
  inherited?: string[];
  own?: string[];
  // Defaults only: how many repositories take the value and how many set their own.
  inherited_by?: number;
  overridden_by?: number;
}

export interface RepoConfigView {
  name: string;
  provider: RepoConfig['provider'];
  fields: FieldView[];
}

export interface WebhookView extends WebhookConfig {
  fields: FieldView[];
}

export interface ConfigView {
  keys: KeySpec[];
  read_only: Record<string, { label: string; reason: string }>;
  defaults: FieldView[];
  repos: RepoConfigView[];
  jira: JiraSite | null;
  webhooks: WebhookView[];
}

type Plain = Record<string, unknown>;
const isPlain = (v: unknown): v is Plain => typeof v === 'object' && v !== null && !Array.isArray(v);
const asStrings = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);

export function getPath(obj: unknown, key: string): unknown {
  let at: unknown = obj;
  for (const part of key.split('.')) {
    if (!isPlain(at)) return undefined;
    at = at[part];
  }
  return at;
}

// No provider, so the schema's own default applies; the identity keys it needs are excluded below.
const BUILT_IN_SOURCE = 'repos:\n  - { organization: a, project: a, repo: a }\n';
let builtIns: RepoConfig | undefined;
// What a repository gets when neither it nor the defaults set a key: a minimal entry run through the schema.
function builtIn(key: string): unknown {
  if (['name', 'organization', 'project', 'repo', 'pat_env'].includes(key)) return undefined;
  builtIns ??= parseConfig(BUILT_IN_SOURCE)[0];
  return getPath(builtIns, key);
}

const REPO_KEYS = [...Object.keys(READ_ONLY), ...EDITABLE.filter((k) => k.scopes.includes('repo')).map((k) => k.key)];

function derivedFrom(key: string, merged: Plain): boolean {
  if (key === 'name' || key === 'pat_env') return true;
  if (key === 'project') return merged.provider === 'github' || merged.provider === 'local';
  if (key === 'organization' || key === 'repo') return merged.provider === 'local';
  return false;
}

function editability(scope: Scope, key: string): Pick<FieldView, 'editable' | 'reason'> {
  if (editableKey(scope, key)) return { editable: true };
  return { editable: false, reason: READ_ONLY[key]?.reason ?? 'Change it in repos.yaml.' };
}

function repoFields(entry: Plain, defaults: Plain, repo: RepoConfig): FieldView[] {
  const merged = { ...defaults, ...entry };
  return REPO_KEYS.map((key) => {
    const own = getPath(entry, key);
    const fromDefaults = getPath(defaults, key);
    const value = getPath(repo, key);
    const base = { key, value, set_here: own !== undefined, ...editability('repo', key) };
    if (editableKey('repo', key)?.appends) {
      const ownList = asStrings(own);
      const inherited = asStrings(fromDefaults);
      return { ...base, own: ownList, inherited, origin: ownList.length ? 'repo' : inherited.length ? 'defaults' : 'built-in' };
    }
    let origin: Origin;
    if (own !== undefined) origin = 'repo';
    else if (fromDefaults !== undefined) origin = 'defaults';
    else if (derivedFrom(key, merged)) origin = 'derived';
    else origin = value === undefined ? 'unset' : 'built-in';
    return { ...base, origin };
  });
}

function defaultsFields(defaults: Plain, entries: Plain[]): FieldView[] {
  return REPO_KEYS.filter((key) => !DEFAULTS_HIDDEN.has(key)).map((key) => {
    const set = getPath(defaults, key);
    const value = set ?? builtIn(key);
    const overridden = entries.filter((e) => getPath(e, key) !== undefined).length;
    const field: FieldView = {
      key,
      value,
      origin: set !== undefined ? 'defaults' : value === undefined ? 'unset' : 'built-in',
      set_here: set !== undefined,
      ...editability('defaults', key),
      inherited_by: editableKey('repo', key)?.appends ? entries.length : entries.length - overridden,
      overridden_by: overridden,
    };
    if (editableKey('repo', key)?.appends) field.own = asStrings(set);
    return field;
  });
}

function webhookFields(raw: Plain, hook: WebhookConfig): FieldView[] {
  const keys = ['name', 'url_env', 'format', 'min_severity', 'on_failure'] as const;
  return keys.map((key) => {
    const set = raw[key] !== undefined;
    const editable = !!editableKey('webhook', key);
    return {
      key,
      value: hook[key],
      origin: set ? 'repo' : 'built-in',
      set_here: set,
      editable,
      ...(editable ? {} : { reason: key === 'url_env' ? CREDENTIAL : 'Names the webhook; change it in repos.yaml.' }),
    };
  });
}

export function resolveConfig(text: string, path = 'repos.yaml'): ConfigView {
  const repos = parseConfig(text, path);
  const webhooks = parseNotifications(text, path);
  const jira = parseJiraSite(text, path);
  const doc: unknown = parse(text) ?? {};
  const root = isPlain(doc) ? doc : {};
  const defaults = isPlain(root.defaults) ? root.defaults : {};
  const entries = (Array.isArray(root.repos) ? root.repos : []).map((e) => (isPlain(e) ? e : {}));
  const rawHooks = isPlain(root.notifications) && Array.isArray(root.notifications.webhooks) ? root.notifications.webhooks : [];
  return {
    keys: EDITABLE.map(({ key, label, kind, options, appends, warn }) => ({
      key,
      label,
      kind,
      ...(options ? { options } : {}),
      ...(appends ? { appends } : {}),
      ...(warn ? { warn } : {}),
    })),
    read_only: { ...READ_ONLY },
    defaults: defaultsFields(defaults, entries),
    repos: repos.map((repo, i) => ({ name: repo.name, provider: repo.provider, fields: repoFields(entries[i] ?? {}, defaults, repo) })),
    jira,
    webhooks: webhooks.map((hook, i) => ({ ...hook, fields: webhookFields(isPlain(rawHooks[i]) ? rawHooks[i] : {}, hook) })),
  };
}
