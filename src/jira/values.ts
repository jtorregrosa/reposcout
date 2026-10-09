import { JiraError } from './client.js';
import type { FieldSpec, FormValue } from './types.js';

const DATE = /^\d{4}-\d\d-\d\d$/;

const isEmpty = (v: FormValue | null | undefined) => v == null || v === '' || (Array.isArray(v) && v.length === 0);

const paragraphDoc = (text: string) => ({
  type: 'doc',
  version: 1,
  content: text.split(/\n{2,}/).map((p) => ({ type: 'paragraph', content: p ? [{ type: 'text', text: p }] : [] })),
});

function convert(spec: FieldSpec, v: FormValue): unknown {
  const fail = (what: string): never => {
    throw new JiraError(400, `${spec.name} ${what}`, { [spec.id]: what });
  };
  const option = (id: unknown) => {
    if (!spec.options?.some((o) => o.id === String(id))) fail(`does not allow ${String(id)}`);
    return { id: String(id) };
  };
  switch (spec.kind) {
    case 'select':
      return option(v);
    case 'multiselect':
      return (Array.isArray(v) ? v : [v]).map(option);
    case 'user':
      return typeof v === 'string' ? { accountId: v } : fail('needs a user');
    case 'users':
      return Array.isArray(v) ? v.map((accountId) => ({ accountId })) : fail('needs a list of users');
    case 'sprint':
      return Number.isInteger(Number(v)) ? Number(v) : fail('needs a sprint');
    case 'date':
      return typeof v === 'string' && DATE.test(v) ? v : fail('needs a date as YYYY-MM-DD');
    case 'number':
      return typeof v === 'number' && Number.isFinite(v) ? v : fail('needs a number');
    case 'text':
      return typeof v === 'string' ? v : fail('needs text');
    case 'textarea':
      return typeof v === 'string' ? paragraphDoc(v) : fail('needs text');
    default:
      return fail('cannot be set from RepoScout');
  }
}

// The custom fields of a create request, checked against the field specs Jira gave; every problem names its field.
export function toJiraFields(specs: FieldSpec[], values: Record<string, FormValue | null | undefined>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const errors: Record<string, string> = {};
  const byId = new Map(specs.map((s) => [s.id, s]));
  for (const id of Object.keys(values)) if (!byId.has(id)) errors[id] = 'is not a field of this issue type';
  for (const spec of specs) {
    const v = values[spec.id];
    if (isEmpty(v)) {
      if (spec.required) errors[spec.id] = spec.kind === 'unsupported' ? (spec.error ?? 'cannot be set from RepoScout') : 'is required';
      continue;
    }
    try {
      out[spec.id] = convert(spec, v as FormValue);
    } catch (e) {
      if (e instanceof JiraError) Object.assign(errors, e.fields);
      else throw e;
    }
  }
  const names = Object.keys(errors).map((id) => `${byId.get(id)?.name ?? id} ${errors[id]}`);
  if (names.length) throw new JiraError(400, names.join('; '), errors);
  return out;
}
