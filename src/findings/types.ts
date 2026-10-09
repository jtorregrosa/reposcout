import { ANALYZERS, type Analyzer } from '../config/analyzers.js';

export const CATEGORIES = ANALYZERS;
export type Category = Analyzer;
export const SEVERITIES = ['critical', 'high', 'medium', 'low'] as const;
export type Severity = (typeof SEVERITIES)[number];
export const CONFIDENCES = ['high', 'medium', 'low'] as const;
export type Confidence = (typeof CONFIDENCES)[number];

// What a finding asks of its reader: a bug to fix, a vulnerability for security to weigh, or a chore for the backlog.
export const KINDS = ['bug', 'vulnerability', 'chore'] as const;
export type Kind = (typeof KINDS)[number];

export const SEVERITY_RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export interface Finding {
  fingerprint: string;
  repo: string;
  commit: string;
  file: string;
  line: number;
  category: Category;
  severity: Severity;
  title: string;
  description: string;
  scenario: string;
  suggested_fix: string;
  confidence: Confidence;
  verified: boolean;
  snippet: string;
  reproduction?: string;
  specialists?: string[];
  unconfirmed?: string;
  repro?: Repro;
  kind?: Kind;
  // The defect exposes, logs or mishandles personal data, whatever its kind.
  personal_data?: boolean;
}

// The steps a tester follows to see the bug: the setup, the actions in order, and what should and does happen.
export interface Repro {
  preconditions: string[];
  steps: string[];
  expected: string | null;
  actual: string | null;
}

export type FindingStatus = 'open' | 'speculative' | 'resolved' | 'suppressed' | 'refuted' | 'duplicate';

export interface FindingEntry {
  status: FindingStatus;
  first_seen: string;
  last_seen: string;
  finding: Finding;
  reason?: string;
  resolved_at?: string;
  refuted_at?: string;
  resolution?: string;
  review_note?: string;
  // What a suppressed finding was before it was suppressed; it returns to that status when unsuppressed.
  status_before_suppression?: FindingStatus;
  // Consecutive re-audits in which its own specialist read the file and did not report it; a sighting resets it.
  missed_runs?: number;
  // When a resolved finding was last reported again.
  reopened_at?: string;
}

export type FindingsState = Record<string, FindingEntry>;

export interface KnownFindingReview {
  fingerprint: string;
  still_present?: boolean;
  reason?: string;
}

export interface SpeculativeReview {
  fingerprint: string;
  verdict?: 'refuted' | 'still_speculative' | 'duplicate' | string;
  // With a duplicate verdict: the candidate with the same root cause that is kept.
  duplicate_of?: string;
  reason?: string;
}

export interface Rejection {
  kind: 'finding' | 'speculative';
  title: string;
  file: unknown;
  reason: string;
}

export interface Discard {
  file?: string;
  title?: string;
  reason?: string;
  // The specialists that proposed the discarded candidate.
  specialists?: string[];
  [key: string]: unknown;
}

// What the audit session writes to its output file; everything in it is untrusted until validated.
export interface RawFindings {
  findings: unknown[];
  speculative?: unknown[];
  discarded?: Discard[];
  known_findings_review?: KnownFindingReview[];
  speculative_review?: SpeculativeReview[];
  // A validation pass's verdicts, checked when they are applied.
  validation_review?: unknown;
  // The orchestrator's count of the candidates each specialist type returned, before verification.
  specialist_candidates?: unknown;
  notes?: string;
}
