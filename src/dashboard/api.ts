// The dashboard's HTTP contract. The web app imports these types, so a change here fails its typecheck instead
// of breaking a screen at runtime. Type-only: nothing in this module may have a runtime value.
import type { Analyzer } from '../config/analyzers.js';
import type { Stage, StageEvent, StageSource } from '../findings/stage.js';
import type { Discard, Finding, FindingStatus, Severity } from '../findings/types.js';
import type { RunResult, YieldRow } from '../report/types.js';
import type { Decision, FindingEvent, LabelOverride, LockInfo, RateLimit, UsageRow, ValidationAttempt } from '../state/types.js';

export type { Category, Confidence, Kind, Repro } from '../findings/types.js';
export type {
  Analyzer,
  Decision,
  FindingEvent,
  FindingStatus,
  LabelOverride,
  RateLimit,
  RunResult,
  Severity,
  Stage,
  StageEvent,
  StageSource,
  UsageRow,
  ValidationAttempt,
  YieldRow,
};

// Findings that people kept or dismissed, counted per repository, analyzer, specialist model and prompt version, so
// the page can add them up along any of those. Kept: reached open (resolved later counts) and not suppressed.
// Dismissed: suppressed or refuted. Findings still speculative count in neither. Model and prompt version are null
// for findings first seen before runs recorded them.
export interface PrecisionCell {
  repo: string;
  category: string;
  model: string | null;
  prompt_version: string | null;
  kept: number;
  suppressed: number;
  refuted: number;
}

export interface FindingView extends Finding {
  status: FindingStatus;
  // The status in repos.yaml differs from state until the next run catches up.
  status_pending: boolean;
  new_last_run: boolean;
  first_seen: string;
  last_seen: string;
  resolved_at: string | null;
  resolution: string | null;
  review_note: string | null;
  suppressed_reason: string | null;
  // An auditor's decision on what was a speculative candidate.
  decision: Decision | null;
  // An auditor's correction of the type or the personal-data mark.
  labels_override: LabelOverride | null;
  stage: Stage;
  stage_since: string | null;
  stage_source: StageSource | null;
}

export interface DiscardView extends Discard {
  repo: string;
  date: string;
  run: string | null;
  commit: string;
}

export interface RepoCoverage {
  audited: number;
  eligible: number | null;
  per_run: number | null;
  pace: { files: number; runs: number } | null;
  counted_only: string | null | undefined;
  by_analyzer: Record<string, number>;
  times: Record<string, string[]>;
  oldest_times: (string | undefined)[];
}

// to_validate: the open findings a validation pass would pick, before its cap.
export type FindingCounts = Record<FindingStatus | 'new_last_run' | 'to_validate', number> & { by_severity: Record<Severity, number> };

export interface RepoView {
  name: string;
  organization: string;
  project: string;
  branch: string;
  models: { orchestrator: string; specialists: string; verifier: string };
  test_command: boolean;
  // Whether the verifier may reproduce findings with test_command here, and if not, why.
  verification: 'on' | 'no-test-command' | 'no-sandbox';
  last_commit: string | null;
  last_run_at: string | null;
  last_full_run_at: string | null;
  analyzers: Analyzer[];
  last_read_coverage: { read: number; selected: number } | null;
  coverage: RepoCoverage;
  counts: FindingCounts;
}

export interface FailureView {
  date: string;
  error: string;
  deferred?: boolean;
  at: string;
}

export interface RunSummary {
  run_id: string;
  date: string;
  bytes: number;
}

export interface Overview {
  generated_at: string;
  analyzers: readonly Analyzer[];
  config_error: string | null;
  active: LockInfo | null;
  repos: RepoView[];
  findings: FindingView[];
  discarded: DiscardView[];
  failures: Record<string, FailureView>;
  usage: UsageRow[];
  cost_per_file: { five_hour: number; seven_day: number; runs: number } | null;
  rate_limit: RateLimit | null;
  runs: RunSummary[];
  precision: PrecisionCell[];
  // Per run and analyzer, newest first.
  yields: YieldRow[];
  // What each recent run reported for the first time, newest first.
  run_results: RunResult[];
}

export interface StartRunBody {
  repos: string[];
  mode: 'incremental' | 'full' | 'speculative' | 'validate';
  max_files: number | null;
  analyzers: Analyzer[];
  until_covered: boolean;
  session_limit: number | null;
}

// One line of a run's events file, as the run loop and the stream tracker emit it. Fields vary by type.
export interface RunEvent {
  ts: string;
  type: string;
  repo?: string;
  [field: string]: unknown;
}

// Server-sent events on /api/live.
export interface LiveRunInfo {
  run_id: string | null;
  active: boolean;
  pid: number | null;
  started_at: string | null;
}
