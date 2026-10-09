import type { Analyzer } from '../config/analyzers.js';
import type { FindingsState, Kind } from '../findings/types.js';

// path -> ISO time of the last audit that opened it.
export type FileAudits = Record<string, string>;
export type AuditsByAnalyzer = Record<Analyzer, FileAudits>;

export interface RepoState {
  repo: string;
  branch: string;
  fingerprint_version?: number;
  last_commit: string | null;
  last_run_at?: string;
  last_commit_by_analyzer?: Partial<Record<Analyzer, string | null>>;
  last_full_run_at?: string | null;
  last_speculative_review_at?: string;
  // Size of the auditable tree as of the last full run; the UI derives coverage from it and the audit times.
  eligible_files?: number | null;
  file_audits_by_analyzer?: Partial<AuditsByAnalyzer>;
  // Written by versions that kept one audit map for every analyzer.
  file_audits?: FileAudits;
  // Written by versions that kept one unread list for every analyzer.
  unread_once?: string[];
  // Per analyzer, files it was given and did not open; the next run retries them once.
  unread_once_by_analyzer?: Partial<Record<Analyzer, string[]>>;
  findings: FindingsState;
}

export interface RateLimit {
  status?: string;
  window?: string;
  resets_at?: number | null;
  five_hour?: number | null;
  seven_day?: number | null;
}

export interface WindowCost {
  five_hour: number;
  seven_day: number;
}

export interface UsageRow {
  date: string;
  at: string;
  repo: string;
  mode: string;
  analyzers: Analyzer[];
  files: number;
  ok: boolean;
  terminal_reason: string | null;
  rate_limit: RateLimit | null;
  duration_ms?: number;
  wall_ms?: number;
  num_turns?: number | null;
  cost_usd_equivalent?: number | null;
  window_cost?: WindowCost | null;
  // Rows written before these existed lack them.
  run_id?: string;
  prompt_version?: string;
  specialist_model?: string;
  [key: string]: unknown;
}

// One change of a finding's status, as the history of the finding records it.
export interface FindingEvent {
  at: string;
  run_id: string | null;
  from_status: string | null;
  to_status: string;
  note: string | null;
  // Who made the change by hand; null when a run made it.
  actor: string | null;
}

export type TriageVerdict = 'confirmed' | 'refuted';

// An auditor's decision on a speculative candidate.
export interface Decision {
  verdict: TriageVerdict;
  reason: string;
  decided_by: string;
  decided_at: string;
}

// What an auditor set by hand on a finding's labels. A field left null keeps what the audit said.
export interface LabelOverride {
  kind: Kind | null;
  personal_data: boolean | null;
  set_by: string;
  set_at: string;
}

export interface LockInfo {
  pid: number;
  started_at: string;
  run_id?: string;
  events_file?: string;
}

export type Census = Record<string, { eligible: number; head: string; at: string }>;
