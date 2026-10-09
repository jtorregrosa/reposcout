import type { PrecisionFact } from '../store/index.js';
import type { PrecisionCell } from './api.js';

// How people judged what the audits reported, counted per repository, analyzer, specialist model and prompt
// version. repos.yaml is the source of truth for suppressions, as everywhere in the dashboard: a suppression added
// since the last run counts already, and one removed no longer does.
export function precisionCells(facts: readonly PrecisionFact[], suppressedByRepo: ReadonlyMap<string, ReadonlySet<string>>): PrecisionCell[] {
  const cells = new Map<string, PrecisionCell>();
  for (const f of facts) {
    const configured = suppressedByRepo.get(f.repo);
    const suppressed = configured ? configured.has(f.fingerprint) : f.status === 'suppressed';
    const refuted = !suppressed && f.status === 'refuted';
    // A suppression that was withdrawn leaves a finding kept again, if it ever reached open.
    const kept = !suppressed && !refuted && (f.ever_open || f.status === 'open' || f.status === 'resolved');
    if (!suppressed && !refuted && !kept) continue;
    const key = JSON.stringify([f.repo, f.category, f.model, f.prompt_version]);
    const cell = cells.get(key) ?? { repo: f.repo, category: f.category, model: f.model, prompt_version: f.prompt_version, kept: 0, suppressed: 0, refuted: 0 };
    if (suppressed) cell.suppressed++;
    else if (refuted) cell.refuted++;
    else cell.kept++;
    cells.set(key, cell);
  }
  return [...cells.values()];
}
