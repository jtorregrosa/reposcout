import { redact } from '../security/secrets.js';
import {
  CATEGORIES,
  type Finding,
  type FindingEntry,
  type FindingStatus,
  type FindingsState,
  type KnownFindingReview,
  type SpeculativeReview,
} from './types.js';

// Re-audits in a row in which a finding's own specialist reads its file and does not report it, before the finding
// is resolved. One miss is not enough: the models are not deterministic, and a finding that is still there drops
// out of a run now and then. A sighting resets the count; a verifier review saying it is gone resolves it at once.
export const MISSES_TO_RESOLVE = 2;

export interface ReportedFinding extends Finding {
  // A reopened finding is reported as new, since it is new to whoever closed it, but keeps its first sighting.
  status: 'new' | 'existing';
  first_seen: string;
  promoted?: true;
  // It was resolved, and is reported again.
  reopened?: true;
}

export interface ClosedFinding extends Finding {
  status: 'resolved' | 'refuted' | 'duplicate';
  resolution: string;
}

// A run's report replaces the finding, but the steps and labels it already had (from a backfill or an earlier run) are
// kept when the new report carries none.
function carryOver(prev: FindingEntry | undefined, f: Finding): Finding {
  const p = prev?.finding;
  if (!p) return f;
  return {
    ...f,
    ...(f.repro || !p.repro ? {} : { repro: p.repro }),
    ...(f.kind || !p.kind ? {} : { kind: p.kind }),
    ...(f.personal_data != null || p.personal_data == null ? {} : { personal_data: p.personal_data }),
  };
}

export interface ClassifyInput {
  findings: Finding[];
  speculative?: Finding[];
  speculativeReviews?: SpeculativeReview[];
  previous: { findings?: FindingsState } | null | undefined;
  auditedFiles: string[];
  deletedFiles: string[];
  reviews: KnownFindingReview[];
  runAt: string;
  suppressed?: Map<string, string>;
  // Fingerprints an auditor refuted as open findings: they stay refuted however often a run confirms them again.
  refutedByAuditor?: ReadonlySet<string>;
  auditedCategories?: readonly string[];
  readByCategory?: Map<string, Set<string>> | null;
}

export interface Classification {
  reported: ReportedFinding[];
  resolved: ClosedFinding[];
  carried: string[];
  // Open findings missed this run but not yet MISSES_TO_RESOLVE times; also in carried.
  missed: string[];
  confirmed: string[];
  suppressedHits: string[];
  speculativeNew: Finding[];
  refuted: ClosedFinding[];
  nextState: FindingsState;
}

// The status a finding would have now if it were not suppressed: what it is restored to when unsuppressed.
function statusBeforeSuppression(prev: FindingEntry | undefined, reportedAs: 'open' | 'speculative'): FindingStatus {
  if (reportedAs === 'open') return 'open';
  const before = prev?.status === 'suppressed' ? prev.status_before_suppression : prev?.status;
  return before === 'open' || before === 'refuted' || before === 'duplicate' ? before : 'speculative';
}

// Statuses kept in state: open, speculative (plausible, unconfirmed), resolved, suppressed, refuted (a
// speculative candidate the speculative review disproved).
//
// "new" / "existing" for confirmed findings; a resolved finding reported again is "new", flagged reopened, and
// keeps its first_seen. A previously open finding is resolved at once when its file is deleted or the verifier
// reviews it as no longer present. Otherwise a run whose specialist of its category read the file and did not
// report it is a miss, and it is resolved after MISSES_TO_RESOLVE misses in a row; a confirmation refreshes
// last_seen and resets the count. A suppressed fingerprint is never reported, and leaving the suppression list
// restores the status it had before. auditedCategories: a run with only some analyzers says nothing about the
// others. readByCategory (category -> files its specialists opened): without a verifier review, a run only counts
// as a miss when the finding's own specialist type actually read the file.
// Speculative candidates are never auto-resolved: they leave that status only when confirmed, refuted by a
// speculative review, suppressed, or when their file is deleted. A refuted fingerprint is not raised again.
export function classify({
  findings,
  speculative = [],
  speculativeReviews = [],
  previous,
  auditedFiles,
  deletedFiles,
  reviews,
  runAt,
  suppressed = new Map(),
  refutedByAuditor = new Set(),
  auditedCategories = CATEGORIES,
  readByCategory = null,
}: ClassifyInput): Classification {
  const audited = new Set(auditedFiles);
  const categories = new Set(auditedCategories);
  const deleted = new Set(deletedFiles);
  const reviewByFp = new Map((reviews ?? []).map((r) => [r.fingerprint, r]));
  const specReviewByFp = new Map((speculativeReviews ?? []).map((r) => [r.fingerprint, r]));
  // An open finding the auditors still report, only as speculative, is still there: an auditor may have confirmed it.
  const seenSpeculative = new Set(speculative.map((s) => s.fingerprint));
  const prevFindings = previous?.findings ?? {};
  const nextState: FindingsState = {};
  const resolved: ClosedFinding[] = [];
  const carried: string[] = [];
  const missed: string[] = [];
  const confirmed: string[] = [];
  const suppressedHits: string[] = [];
  const speculativeNew: Finding[] = [];
  const refuted: ClosedFinding[] = [];

  const suppressedNow = [...findings.map((f) => [f, 'open'] as const), ...speculative.map((f) => [f, 'speculative'] as const)].filter(([x]) =>
    suppressed.has(x.fingerprint),
  );
  for (const [f, reportedAs] of suppressedNow) {
    const prev = prevFindings[f.fingerprint];
    nextState[f.fingerprint] = {
      status: 'suppressed',
      first_seen: prev?.first_seen ?? runAt,
      last_seen: runAt,
      reason: suppressed.get(f.fingerprint),
      status_before_suppression: statusBeforeSuppression(prev, reportedAs),
      finding: carryOver(prev, f),
    };
    suppressedHits.push(f.fingerprint);
  }

  const stillRefuted = (fp: string) => refutedByAuditor.has(fp) && prevFindings[fp]?.status === 'refuted';
  for (const f of findings.filter((x) => !suppressed.has(x.fingerprint) && stillRefuted(x.fingerprint))) {
    const prev = prevFindings[f.fingerprint];
    if (prev) nextState[f.fingerprint] = { ...prev, last_seen: runAt };
  }

  const reported = findings
    .filter((f) => !suppressed.has(f.fingerprint) && !stillRefuted(f.fingerprint))
    .map((reportedFinding): ReportedFinding => {
      const prev = prevFindings[reportedFinding.fingerprint];
      const f = carryOver(prev, reportedFinding);
      const wasOpen = prev?.status === 'open';
      const reopened = prev?.status === 'resolved';
      const firstSeen = wasOpen || reopened ? prev.first_seen : runAt;
      const reopenedAt = reopened ? runAt : wasOpen ? prev.reopened_at : undefined;
      nextState[f.fingerprint] = { status: 'open', first_seen: firstSeen, last_seen: runAt, finding: f, ...(reopenedAt ? { reopened_at: reopenedAt } : {}) };
      return {
        ...f,
        status: wasOpen ? 'existing' : 'new',
        first_seen: firstSeen,
        ...(prev?.status === 'speculative' ? { promoted: true as const } : {}),
        ...(reopened ? { reopened: true as const } : {}),
      };
    });

  for (const s of speculative.filter((x) => !suppressed.has(x.fingerprint) && !nextState[x.fingerprint])) {
    const prev = prevFindings[s.fingerprint];
    // A refuted or duplicate candidate is not raised again until its line changes, which changes its fingerprint.
    if (prev?.status === 'refuted' || prev?.status === 'duplicate' || prev?.status === 'open') continue;
    nextState[s.fingerprint] = {
      status: 'speculative',
      first_seen: prev?.status === 'speculative' ? prev.first_seen : runAt,
      last_seen: runAt,
      finding: carryOver(prev, s),
    };
    if (prev?.status !== 'speculative') speculativeNew.push(s);
  }

  for (const [fp, entry] of Object.entries(prevFindings)) {
    if (nextState[fp]) continue;
    if (suppressed.has(fp)) {
      const before = entry.status === 'suppressed' ? entry.status_before_suppression : entry.status;
      nextState[fp] = { ...entry, status: 'suppressed', reason: suppressed.get(fp), ...(before ? { status_before_suppression: before } : {}) };
      continue;
    }
    if (entry.status === 'suppressed') {
      // Removed from the suppression list: back to what it was before, until an audit says otherwise. Entries
      // suppressed before that was recorded count as open.
      const { reason: _reason, status_before_suppression: before = 'open', ...rest } = entry;
      nextState[fp] = { ...rest, status: before };
      if (before === 'open') carried.push(fp);
      continue;
    }
    if (entry.status === 'speculative') {
      if (deleted.has(entry.finding.file)) continue;
      const review = specReviewByFp.get(fp);
      if (review?.verdict === 'refuted') {
        const resolution = redact(String(review.reason ?? ''));
        nextState[fp] = { ...entry, status: 'refuted', refuted_at: runAt, resolution };
        refuted.push({ ...entry.finding, status: 'refuted', resolution });
      } else if (review?.verdict === 'duplicate' && review.duplicate_of !== fp) {
        const kept = review.duplicate_of ? `Duplicate of ${review.duplicate_of}. ` : 'Duplicate of another candidate. ';
        const resolution = redact(`${kept}${review.reason ?? ''}`.trim());
        nextState[fp] = { ...entry, status: 'duplicate', refuted_at: runAt, resolution };
        refuted.push({ ...entry.finding, status: 'duplicate', resolution });
      } else {
        nextState[fp] = review ? { ...entry, last_seen: runAt, review_note: redact(String(review.reason ?? '')) } : entry;
      }
      continue;
    }
    if (entry.status !== 'open') {
      nextState[fp] = entry;
      continue;
    }
    const review =
      reviewByFp.get(fp) ?? (seenSpeculative.has(fp) ? { fingerprint: fp, still_present: true, reason: 'reported again as speculative' } : undefined);
    nextState[fp] = settleOpen({ entry, fp, review, audited, categories, deleted, readByCategory, runAt, resolved, confirmed, carried, missed });
  }
  return { reported, resolved, carried, missed, confirmed, suppressedHits, speculativeNew, refuted, nextState };
}

interface SettleInput {
  entry: FindingEntry;
  fp: string;
  review: KnownFindingReview | undefined;
  audited: Set<string>;
  categories: Set<string>;
  deleted: Set<string>;
  readByCategory: Map<string, Set<string>> | null;
  runAt: string;
  resolved: ClosedFinding[];
  confirmed: string[];
  carried: string[];
  missed: string[];
}

function settleOpen({
  entry,
  fp,
  review,
  audited,
  categories,
  deleted,
  readByCategory,
  runAt,
  resolved,
  confirmed,
  carried,
  missed,
}: SettleInput): FindingEntry {
  const { file, category } = entry.finding;
  const { missed_runs: misses = 0, ...counted } = entry;
  const close = (reason: unknown): FindingEntry => {
    const resolution = redact(String(reason ?? ''));
    resolved.push({ ...entry.finding, status: 'resolved', resolution });
    return { ...counted, status: 'resolved', resolved_at: runAt, resolution };
  };
  if (deleted.has(file)) return close('file deleted');
  if (review?.still_present === true) {
    confirmed.push(fp);
    return { ...counted, last_seen: runAt };
  }
  const inScope = audited.has(file) && categories.has(category);
  if (!inScope) {
    carried.push(fp);
    return entry;
  }
  if (review?.still_present === false) return close(review.reason ?? 'the verifier found it no longer present');
  // A review that says neither still counts as a look at the file.
  const looked = review != null || !readByCategory || readByCategory.get(category)?.has(file) === true;
  if (!looked) {
    carried.push(fp);
    return entry;
  }
  if (misses + 1 >= MISSES_TO_RESOLVE) return close(`not reported again in ${misses + 1} consecutive re-audits of the file`);
  missed.push(fp);
  carried.push(fp);
  return { ...entry, missed_runs: misses + 1 };
}
