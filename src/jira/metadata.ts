import { type JiraClient, JiraError, segment } from './client.js';
import type { FieldKind, FieldOption, FieldSpec, FormValue, IssueTypeRef } from './types.js';

// The parts of Jira's create metadata RepoScout reads.
interface RawField {
  fieldId: string;
  key?: string;
  name: string;
  required: boolean;
  hasDefaultValue?: boolean;
  schema?: { type?: string; items?: string; custom?: string; system?: string };
  allowedValues?: { id?: string | number; value?: string; name?: string }[];
}

interface Page<T> {
  startAt?: number;
  maxResults?: number;
  total?: number;
  isLast?: boolean;
  issueTypes?: T[];
  fields?: T[];
  values?: T[];
}

// Set by RepoScout itself or by Jira; never shown as a form field.
const OWN_FIELDS = new Set(['summary', 'description', 'project', 'issuetype', 'parent', 'labels', 'reporter', 'attachment', 'issuelinks']);

const SPRINT = 'com.pyxis.greenhopper.jira:gh-sprint';
const TEXTAREA = 'com.atlassian.jira.plugin.system.customfieldtypes:textarea';

export function kindOf(f: RawField): FieldKind {
  const s = f.schema ?? {};
  if (s.custom === SPRINT) return 'sprint';
  if (f.allowedValues?.length) return s.type === 'array' ? 'multiselect' : 'select';
  if (s.type === 'user') return 'user';
  if (s.type === 'array' && s.items === 'user') return 'users';
  if (s.type === 'date') return 'date';
  if (s.type === 'number') return 'number';
  if (s.type === 'string') return s.custom === TEXTAREA ? 'textarea' : 'text';
  return 'unsupported';
}

const optionsOf = (f: RawField): FieldOption[] =>
  (f.allowedValues ?? []).filter((o) => o.id != null).map((o) => ({ id: String(o.id), label: o.value ?? o.name ?? String(o.id) }));

async function allPages<T>(client: JiraClient, path: string, key: 'issueTypes' | 'fields'): Promise<T[]> {
  const out: T[] = [];
  for (let startAt = 0; ; ) {
    const page = await client.get<Page<T>>(path, { startAt, maxResults: 50 });
    const items = page[key] ?? page.values ?? [];
    out.push(...items);
    if (!items.length || page.isLast || (page.total != null && out.length >= page.total)) return out;
    startAt += items.length;
  }
}

const CACHE_MS = 5 * 60_000;
const cache = new Map<string, { at: number; value: unknown }>();

async function cached<T>(key: string, load: () => Promise<T>, fresh: boolean): Promise<T> {
  const hit = cache.get(key);
  if (!fresh && hit && Date.now() - hit.at < CACHE_MS) return hit.value as T;
  const value = await load();
  cache.set(key, { at: Date.now(), value });
  return value;
}

export const clearMetadataCache = () => cache.clear();

export async function issueTypes(client: JiraClient, project: string, fresh = false): Promise<IssueTypeRef[]> {
  const raw = await cached(
    `${client.site}|types|${project}`,
    () => allPages<{ id: string; name: string; subtask?: boolean }>(client, `/rest/api/3/issue/createmeta/${segment(project)}/issuetypes`, 'issueTypes'),
    fresh,
  );
  return raw.filter((t) => !t.subtask).map((t) => ({ id: String(t.id), name: t.name }));
}

export async function issueTypeId(client: JiraClient, project: string, name: string, fresh = false): Promise<string> {
  const types = await issueTypes(client, project, fresh);
  const match = types.find((t) => t.name.toLowerCase() === name.toLowerCase());
  if (!match) throw new JiraError(400, `${project} has no issue type "${name}" you can create; it offers ${types.map((t) => t.name).join(', ')}`);
  return match.id;
}

export async function rawFields(client: JiraClient, project: string, typeId: string, fresh = false): Promise<RawField[]> {
  return cached(
    `${client.site}|fields|${project}|${typeId}`,
    () => allPages<RawField>(client, `/rest/api/3/issue/createmeta/${segment(project)}/issuetypes/${segment(typeId)}`, 'fields'),
    fresh,
  );
}

const matchOption = (options: FieldOption[], v: unknown) => options.find((o) => o.id === String(v) || o.label === String(v));

// A default from repos.yaml, as the form holds it, or why it does not fit the field.
export function resolveDefault(spec: Pick<FieldSpec, 'kind' | 'options' | 'name'>, raw: unknown): { value?: FormValue; error?: string } {
  const bad = (what: string) => ({ error: `the default for ${spec.name} ${what}` });
  switch (spec.kind) {
    case 'select': {
      const o = matchOption(spec.options ?? [], raw);
      return o ? { value: o.id } : bad(`is not one of its options: ${String(raw)}`);
    }
    case 'multiselect': {
      const ids: string[] = [];
      for (const item of Array.isArray(raw) ? raw : [raw]) {
        const o = matchOption(spec.options ?? [], item);
        if (!o) return bad(`is not one of its options: ${String(item)}`);
        ids.push(o.id);
      }
      return { value: ids };
    }
    case 'user':
      return typeof raw === 'string' && raw ? { value: raw } : bad('must be an account id');
    case 'users':
      return Array.isArray(raw) && raw.every((u) => typeof u === 'string') ? { value: raw as string[] } : bad('must be a list of account ids');
    case 'sprint':
      return Number.isInteger(Number(raw)) ? { value: Number(raw) } : bad('must be a sprint id');
    case 'date':
      return typeof raw === 'string' && /^\d{4}-\d\d-\d\d$/.test(raw) ? { value: raw } : bad('must be a date as YYYY-MM-DD');
    case 'number':
      return typeof raw === 'number' ? { value: raw } : bad('must be a number');
    case 'text':
    case 'textarea':
      return typeof raw === 'string' || typeof raw === 'number' ? { value: String(raw) } : bad('must be text');
    default:
      return bad('cannot be set from RepoScout: Jira gives this field a type it does not support');
  }
}

// The form's fields: every one Jira requires and has no default of its own, and every one the target sets a default
// for. A default that names no field of this issue type is returned apart, never sent.
export function buildFields(raw: RawField[], defaults: Record<string, unknown> = {}): { fields: FieldSpec[]; unknown: { key: string; error: string }[] } {
  const byId = new Map(raw.map((f) => [f.fieldId, f]));
  const byName = new Map(raw.map((f) => [f.name, f]));
  const wanted = new Map<string, unknown>();
  const unknown: { key: string; error: string }[] = [];
  for (const [key, value] of Object.entries(defaults)) {
    const f = byId.get(key) ?? byName.get(key);
    if (!f || OWN_FIELDS.has(f.fieldId)) unknown.push({ key, error: `${key} is not a field this issue type offers` });
    else wanted.set(f.fieldId, value);
  }
  const fields: FieldSpec[] = [];
  for (const f of raw) {
    if (OWN_FIELDS.has(f.fieldId)) continue;
    const required = f.required && !f.hasDefaultValue;
    if (!required && !wanted.has(f.fieldId)) continue;
    const kind = kindOf(f);
    const spec: FieldSpec = { id: f.fieldId, name: f.name, kind, required, ...(kind === 'select' || kind === 'multiselect' ? { options: optionsOf(f) } : {}) };
    if (kind === 'unsupported') spec.error = `${f.name} has a type RepoScout cannot fill in (${f.schema?.custom ?? f.schema?.type ?? 'unknown'})`;
    else if (wanted.has(f.fieldId)) {
      const { value, error } = resolveDefault(spec, wanted.get(f.fieldId));
      if (value !== undefined) spec.default = value;
      if (error) spec.error = error;
    }
    fields.push(spec);
  }
  return { fields, unknown };
}

// Every field a create request may carry, so a value the auditor chose is checked against Jira's own definition.
export function allSpecs(raw: RawField[]): FieldSpec[] {
  return raw
    .filter((f) => !OWN_FIELDS.has(f.fieldId))
    .map((f) => {
      const kind = kindOf(f);
      return {
        id: f.fieldId,
        name: f.name,
        kind,
        required: f.required && !f.hasDefaultValue,
        ...(kind === 'select' || kind === 'multiselect' ? { options: optionsOf(f) } : {}),
      };
    });
}
