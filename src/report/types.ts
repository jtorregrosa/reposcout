import type { Analyzer, Mode } from '../config/analyzers.js';
import type { ClosedFinding, ReportedFinding } from '../findings/classify.js';
import type { Discard, Finding, Rejection } from '../findings/types.js';
import type { ValidationBlock } from '../findings/validation.js';
import type { WindowCost } from '../state/types.js';

export const REPORT_SCHEMA = 'reposcout/report@1';

export interface RunUsage {
  duration_ms: number;
  wall_ms: number;
  num_turns: number | null;
  cost_usd_equivalent: number | null;
  models: Record<string, { input: number; output: number }> | null;
  subagents: Record<string, unknown> | null;
  subagent_runs: number | null;
  // Tokens per subagent type, summed over its instances, from the usage each one reported when it finished.
  subagent_tokens?: Record<string, number> | null;
  permission_denials: number | null;
  window_cost: WindowCost | null;
}

// A selected file is read once a specialist opened it; unread lists the ones none did. by_analyzer counts the
// selected files each analyzer's specialists opened, which is what its audit times record.
export interface ReadCoverage {
  selected: number;
  read: number;
  unread: string[];
  by_analyzer?: Partial<Record<Analyzer, number>>;
}

// What one analyzer's specialists yielded in a run. Candidates is what they proposed before the verifier, null
// when a reply could not be parsed; kept, speculative and discarded count what the verifier made of them, by the
// specialists it credits (or the category, when it credits none). Cost is the run's cost in proportion to tokens.
export interface AnalyzerYield {
  analyzer: Analyzer;
  instances: number;
  candidates: number | null;
  kept: number;
  speculative: number;
  discarded: number;
  tokens: number | null;
  cost_usd: number | null;
}

// One analyzer's yield in one run, as the database keeps it.
export interface YieldRow extends AnalyzerYield {
  run_id: string;
  repo: string;
  at: string;
  mode: string;
  prompt_version: string | null;
  model: string | null;
}

// What one run reported for the first time.
export interface RunResult {
  run_id: string;
  repo: string;
  generated_at: string;
  new_findings: number;
  new_speculative: number;
}

// Reproduction needs a test_command; without one the verifier confirms from the code alone.
export interface VerificationInfo {
  enabled: boolean;
  reason: string | null;
}

export interface RepoReport {
  schema: typeof REPORT_SCHEMA;
  run_id: string;
  repo: string;
  organization: string;
  project: string;
  branch: string;
  commit: string;
  previous_commit: string | null;
  mode: Mode;
  analyzers: Analyzer[];
  generated_at: string;
  audited_files: string[];
  omitted_files_count: number;
  findings: ReportedFinding[];
  resolved: ClosedFinding[];
  open_total: number;
  carried_open: number;
  confirmed_known: number;
  speculative_new: Finding[];
  speculative_total: number;
  // Refuted and duplicate candidates.
  refuted: ClosedFinding[];
  // Speculative candidates the review returned no verdict for; they stay speculative.
  speculative_unreviewed?: string[];
  suppressed_count: number;
  read_coverage: ReadCoverage;
  discarded_count: number;
  discarded: Discard[];
  rejected: Rejection[];
  notes: string;
  usage: RunUsage;
  // Short hash of the skill and agent prompts the run used, so precision can be compared across prompt changes.
  prompt_version?: string;
  // The model alias the specialists ran on.
  specialist_model?: string;
  verification?: VerificationInfo;
  yield?: AnalyzerYield[];
  // What a validation pass tried and how each try ended.
  validation?: ValidationBlock;
}

export interface FailureEntry {
  error: string;
  deferred?: boolean;
  at: string;
}

export type Failures = Record<string, FailureEntry>;
