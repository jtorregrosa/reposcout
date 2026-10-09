import { redact } from '../security/secrets.js';
import type { Decision, ValidationAttempt, ValidationOutcome } from '../state/types.js';
import type { StageState } from './stage.js';
import { type Finding, type FindingsState, SEVERITY_RANK } from './types.js';

// A test that could not exercise a finding twice is unlikely to manage a third time; a change around the line gives
// the finding a new fingerprint, which starts with no attempts.
export const MAX_UNSUCCESSFUL_ATTEMPTS = 2;
// Each candidate costs a test written and a whole test_command run, and all of them share one session timeout.
export const DEFAULT_VALIDATION_LIMIT = 10;

export interface ValidationCandidate extends Finding {
  fingerprint: string;
  // The verifier's reasons from earlier unsuccessful attempts, oldest first.
  previous_attempts: string[];
}

export interface ValidationReview {
  fingerprint: string;
  verdict: ValidationOutcome;
  reason?: string;
  reproduction?: string;
}

export interface ValidationBlock {
  tried: number;
  reproduced: { fingerprint: string; title: string; file: string; line: number }[];
  not_reproduced: { fingerprint: string; reason: string }[];
  not_testable: { fingerprint: string; reason: string }[];
  unreviewed: string[];
}

const unsuccessful = (attempts: readonly ValidationAttempt[] | undefined) => (attempts ?? []).filter((a) => a.outcome !== 'reproduced');

// The open findings a validation pass tries: still at detected, with no auditor decision, not pending suppression,
// tried unsuccessfully fewer than the limit, and whose file is still there. Every finding gets a first try before
// any gets a second, most severe and then oldest first within each round.
export function pickValidationCandidates({
  findings,
  stages,
  decisions,
  suppressed,
  attempts,
  fileExists,
  limit = DEFAULT_VALIDATION_LIMIT,
}: {
  findings: FindingsState | undefined;
  stages: ReadonlyMap<string, StageState>;
  decisions: ReadonlyMap<string, Decision>;
  suppressed: ReadonlySet<string>;
  attempts: ReadonlyMap<string, ValidationAttempt[]>;
  fileExists: (file: string) => boolean;
  limit?: number;
}): ValidationCandidate[] {
  return Object.entries(findings ?? {})
    .filter(
      ([fp, e]) =>
        e.status === 'open' &&
        (stages.get(fp)?.stage ?? 'detected') === 'detected' &&
        !decisions.has(fp) &&
        !suppressed.has(fp) &&
        unsuccessful(attempts.get(fp)).length < MAX_UNSUCCESSFUL_ATTEMPTS &&
        fileExists(e.finding.file),
    )
    .map(([fp, e]) => ({ fp, e, tries: unsuccessful(attempts.get(fp)) }))
    .sort(
      (a, b) =>
        a.tries.length - b.tries.length ||
        (SEVERITY_RANK[a.e.finding.severity] ?? 9) - (SEVERITY_RANK[b.e.finding.severity] ?? 9) ||
        String(a.e.first_seen).localeCompare(String(b.e.first_seen)),
    )
    .slice(0, limit)
    .map(({ fp, e, tries }) => ({ ...e.finding, fingerprint: fp, previous_attempts: tries.map((t) => t.reason ?? t.outcome) }));
}

const OUTCOMES: readonly ValidationOutcome[] = ['reproduced', 'not_reproduced', 'not_testable'];

// What the verifier's answers do: a reproduction sets verified and the test on the stored finding and nothing else,
// any answer is one attempt, and a candidate without an answer is left as it was. Answers for fingerprints that were
// not candidates, repeated answers and unknown verdicts are ignored.
export function applyValidation({
  previous,
  candidates,
  review,
  runId,
  at,
}: {
  previous: FindingsState;
  candidates: readonly ValidationCandidate[];
  review: unknown;
  runId: string;
  at: string;
}): { nextState: FindingsState; attempts: (ValidationAttempt & { fingerprint: string })[]; block: ValidationBlock } {
  const wanted = new Set(candidates.map((c) => c.fingerprint));
  const answers = new Map<string, ValidationReview>();
  for (const r of Array.isArray(review) ? review : []) {
    const a = r as Partial<ValidationReview> | null;
    if (!a || typeof a.fingerprint !== 'string' || !wanted.has(a.fingerprint) || answers.has(a.fingerprint)) continue;
    if (!OUTCOMES.includes(a.verdict as ValidationOutcome)) continue;
    answers.set(a.fingerprint, a as ValidationReview);
  }

  const nextState: FindingsState = { ...previous };
  const attempts: (ValidationAttempt & { fingerprint: string })[] = [];
  const block: ValidationBlock = { tried: candidates.length, reproduced: [], not_reproduced: [], not_testable: [], unreviewed: [] };
  for (const c of candidates) {
    const answer = answers.get(c.fingerprint);
    if (!answer) {
      block.unreviewed.push(c.fingerprint);
      continue;
    }
    const reason = redact(String(answer.reason ?? '').trim());
    attempts.push({ fingerprint: c.fingerprint, at, run_id: runId, outcome: answer.verdict, reason: reason || null });
    const entry = previous[c.fingerprint];
    if (answer.verdict === 'reproduced') {
      if (entry) {
        const reproduction = redact(String(answer.reproduction ?? answer.reason ?? '').trim());
        nextState[c.fingerprint] = { ...entry, finding: { ...entry.finding, verified: true, ...(reproduction ? { reproduction } : {}) } };
      }
      block.reproduced.push({ fingerprint: c.fingerprint, title: c.title, file: c.file, line: c.line });
    } else {
      block[answer.verdict].push({ fingerprint: c.fingerprint, reason });
    }
  }
  return { nextState, attempts, block };
}
