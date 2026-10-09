import type { Discard, RawFindings, SpeculativeReview } from './types.js';

interface Candidate {
  fingerprint: string;
  file: string;
  title: string;
}

const same = (a: unknown, b: unknown) =>
  String(a ?? '')
    .trim()
    .toLowerCase() ===
  String(b ?? '')
    .trim()
    .toLowerCase();

// The verdict of every candidate a speculative review was given. The verifier answers in speculative_review, but
// it has also put candidates in `discarded` (as duplicates, or with no evidence); those are settled too, rather
// than left speculative to be reviewed again on every run. A candidate confirmed as a finding needs no verdict.
export function speculativeVerdicts(
  candidates: Candidate[],
  raw: Pick<RawFindings, 'speculative_review' | 'discarded'>,
  confirmed: Set<string>,
): { reviews: SpeculativeReview[]; unreviewed: string[] } {
  const known = new Set(candidates.map((c) => c.fingerprint));
  const reviews = (Array.isArray(raw.speculative_review) ? raw.speculative_review : []).filter(
    (r): r is SpeculativeReview => !!r && typeof r.fingerprint === 'string' && known.has(r.fingerprint),
  );
  const reviewed = new Set(reviews.map((r) => r.fingerprint));
  const discarded: Discard[] = Array.isArray(raw.discarded) ? raw.discarded : [];
  const unreviewed: string[] = [];
  for (const c of candidates) {
    if (reviewed.has(c.fingerprint) || confirmed.has(c.fingerprint)) continue;
    const d = discarded.find((x) => same(x.file, c.file) && same(x.title, c.title));
    if (!d) {
      unreviewed.push(c.fingerprint);
      continue;
    }
    reviews.push(
      same(d.reason, 'duplicate')
        ? {
            fingerprint: c.fingerprint,
            verdict: 'duplicate',
            reason: 'The verifier discarded it as a duplicate of another candidate with the same root cause.',
          }
        : { fingerprint: c.fingerprint, verdict: 'refuted', reason: `Discarded by the verifier: ${d.reason ?? 'no reason given'}.` },
    );
  }
  return { reviews, unreviewed };
}
