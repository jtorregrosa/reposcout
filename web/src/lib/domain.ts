import type { Analyzer, Category, FindingStatus, Kind, Severity, Stage, StageSource } from './types';

export const SEVERITIES = ['critical', 'high', 'medium', 'low'] as const satisfies readonly Severity[];
export const CATEGORIES = ['security', 'concurrency', 'error-handling', 'logic', 'performance'] as const satisfies readonly Category[];
export const ANALYZERS = CATEGORIES satisfies readonly Analyzer[];

export const isCategory = (value: unknown): value is Category => (CATEGORIES as readonly unknown[]).includes(value);

export const KINDS = ['vulnerability', 'bug', 'chore'] as const satisfies readonly Kind[];

export const KIND_LABEL: Record<Kind, string> = { vulnerability: 'Vulnerability', bug: 'Bug', chore: 'Chore' };

export const KIND_HELP: Record<Kind, string> = {
  vulnerability: 'An attacker, or a user acting beyond their rights, can exploit it. Security weighs it.',
  bug: 'In ordinary use, a user or a system gets a wrong result or an observable failure. Fix it.',
  chore: 'Nothing fails today: debt, hardening or a cost that only matters later. Backlog it.',
};

// How far a finding has progressed, apart from what was decided about it.
export const STAGES = ['detected', 'validated', 'reported', 'fixed'] as const satisfies readonly Stage[];

export const STAGE_LABEL: Record<Stage, string> = { detected: 'Detected', validated: 'Validated', reported: 'Reported', fixed: 'Fixed' };

export const STAGE_HELP: Record<Stage, string> = {
  detected: 'Found by the audit, with nothing yet beyond its evidence in the code.',
  validated: 'Shown to be real: a test reproduced it, or an auditor confirmed it.',
  reported: 'Put in front of the people who own the code. Nothing reports findings yet.',
  fixed: 'No longer observed: the verifier found it gone, its file was deleted, or two re-audits missed it.',
};

export const STAGE_SOURCE_LABEL: Record<StageSource, string> = {
  initial: 'when first recorded',
  reproduced: 'reproduced by a test',
  auditor: 'confirmed by an auditor',
  resolved: 'resolved',
  reopened: 'reopened',
  withdrawn: 'confirmation withdrawn',
  upgrade: 'set from the state at upgrade',
};

export const PERSONAL_DATA_HELP = 'Exposes, logs, sends or mishandles data about an identifiable person.';

export const severityRank = (s: Severity): number => SEVERITIES.indexOf(s);

export const CATEGORY_LABEL: Record<Category, string> = {
  security: 'Security',
  concurrency: 'Concurrency',
  'error-handling': 'Error handling',
  logic: 'Logic',
  performance: 'Performance',
};

export const CATEGORY_ABOUT: Record<Category, string> = {
  security: 'Flaws an attacker or a malformed input can trigger: injection, broken authentication or authorization, secrets, crypto misuse, data exposure.',
  concurrency: 'Races, deadlocks and async misuse that a real interleaving or load pattern triggers.',
  'error-handling': 'Failures turned into wrong results, leaks, hangs or silent loss: swallowed exceptions, unchecked results, missing rollback.',
  logic: 'Code that computes or decides something other than what it evidently intends: wrong conditions, edge cases, broken invariants.',
  performance: 'Costs that grow with data or traffic until a path slows down or fails: N+1 queries, unbounded reads, blocking async calls, quadratic loops.',
};

export const STATUS_LABEL: Record<FindingStatus, string> = {
  open: 'Open',
  speculative: 'Speculative',
  suppressed: 'Suppressed',
  resolved: 'Resolved',
  refuted: 'Refuted',
  duplicate: 'Duplicate',
};

export const STATUS_HELP: Record<FindingStatus, string> = {
  open: 'Confirmed by the verifier in the code and not fixed yet.',
  speculative: 'Plausible but unconfirmed: the verifier could not settle it from the repository alone.',
  suppressed: 'Dismissed as a false positive in repos.yaml, with a reason.',
  resolved: 'Gone: the verifier found it fixed, or its file was re-audited without it, or deleted.',
  refuted: 'A speculative candidate that a speculative review disproved.',
  duplicate: 'A speculative candidate with the same root cause as another one, which is tracked instead.',
};

export const MODE_LABEL = {
  incremental: 'Incremental',
  full: 'Full',
  speculative: 'Speculative review',
} as const;

export const MODE_HELP = {
  incremental: 'Changes since the last audited commit.',
  full: 'The whole repository, capped per run; the least recently audited files go first.',
  speculative: 'Re-examines only the unconfirmed candidates, with the verifier.',
} as const;
