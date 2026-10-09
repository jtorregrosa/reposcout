// Shared with the dashboard through src/dashboard/api.ts, so these hold types only.

export type FieldKind = 'select' | 'multiselect' | 'user' | 'users' | 'sprint' | 'date' | 'number' | 'text' | 'textarea' | 'unsupported';

export interface FieldOption {
  id: string;
  label: string;
}

// A value as the report form holds it: option ids, account ids, a sprint id, a date, a number or text.
export type FormValue = string | number | string[];

export interface FieldSpec {
  id: string;
  name: string;
  kind: FieldKind;
  required: boolean;
  options?: FieldOption[];
  default?: FormValue;
  // Why the default could not be used, or why the field cannot be filled in from RepoScout.
  error?: string;
}

export interface IssueTypeRef {
  id: string;
  name: string;
}

export interface ParentRef {
  key: string;
  summary: string;
  type: string;
}

// Everything the report form starts from, resolved against Jira for one project and issue type.
export interface ReportForm {
  project: string;
  issue_type: string;
  issue_types: IssueTypeRef[];
  fields: FieldSpec[];
  labels: string[];
  parent: ParentRef | null;
  // Why the configured default parent was not used.
  parent_error: string | null;
  // Whether issues of this type can have a parent in this project.
  parent_allowed: boolean;
  // Defaults in the target that match no field this issue type offers.
  unknown_defaults: { key: string; error: string }[];
}

export interface UserRef {
  account_id: string;
  name: string;
}

export interface SprintRef {
  id: number;
  name: string;
  state: string;
}

export interface ReportBody {
  repo: string;
  fingerprints: string[];
  project: string;
  issue_type: string;
  parent: string | null;
  labels: string[];
  fields: Record<string, FormValue | null>;
  // A summary per fingerprint when the auditor edited it; the finding's title otherwise.
  summaries: Record<string, string>;
}

export type ReportOutcome =
  | { fingerprint: string; ok: true; key: string; url: string; adopted: boolean }
  | { fingerprint: string; ok: false; error: string; fields: Record<string, string> };
