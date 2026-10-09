import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RepoState } from '../state/types.js';
import { anchorLine, FINGERPRINT_VERSION, fingerprint } from './fingerprint.js';
import type { FindingEntry, FindingStatus, FindingsState } from './types.js';

const STATUS_RANK: Record<FindingStatus, number> = { open: 5, speculative: 4, suppressed: 3, resolved: 2, duplicate: 1, refuted: 0 };

// Recomputes fingerprints written by an older version and merges entries that now collide, which is how the
// duplicates recorded under version 1 disappear. Entries whose file is gone keep their old fingerprint.
export function migrateFingerprints<S extends Pick<RepoState, 'findings' | 'fingerprint_version'>>({
  state,
  repoName,
  cloneDir,
}: {
  state: S | null;
  repoName: string;
  cloneDir: string;
}): { state: S | null; merged: number; remapped: Map<string, string> } {
  if (!state?.findings || state.fingerprint_version === FINGERPRINT_VERSION) return { state, merged: 0, remapped: new Map() };
  const findings: FindingsState = {};
  const remapped = new Map<string, string>();
  let merged = 0;
  for (const [oldFp, entry] of Object.entries(state.findings)) {
    const f = entry.finding;
    const path = join(cloneDir, f.file);
    let fp = oldFp;
    if (existsSync(path)) {
      const text = readFileSync(path, 'utf8');
      if (f.line <= text.split(/\r?\n/).length) fp = fingerprint({ repo: repoName, file: f.file, category: f.category, snippet: anchorLine(text, f.line) });
    }
    if (fp !== oldFp) remapped.set(oldFp, fp);
    const next: FindingEntry = { ...entry, finding: { ...f, fingerprint: fp } };
    const have = findings[fp];
    if (!have) {
      findings[fp] = next;
      continue;
    }
    merged++;
    const keep = (STATUS_RANK[next.status] ?? 0) > (STATUS_RANK[have.status] ?? 0) ? next : have;
    findings[fp] = {
      ...keep,
      first_seen: [have.first_seen, next.first_seen].filter(Boolean).sort()[0] as string,
      last_seen: [have.last_seen, next.last_seen].filter(Boolean).sort().at(-1) as string,
      finding: { ...keep.finding, specialists: [...new Set([...(have.finding.specialists ?? []), ...(next.finding.specialists ?? [])])] },
    };
  }
  return { state: { ...state, findings, fingerprint_version: FINGERPRINT_VERSION }, merged, remapped };
}
