import { resolve } from 'node:path';
import { loadConfig, type RepoConfig } from '../config/config.js';
import { ExitCode } from '../errors.js';
import type { FindingStatus } from '../findings/types.js';
import { writeJson } from '../fs.js';
import { layout, ROOT } from '../paths.js';
import { buildSarif, type SarifLog, type SarifRepo } from '../report/sarif.js';
import { reposcoutVersion, sarifRepo } from '../report/sarif-file.js';
import { openStore, type Store } from '../store/index.js';

export const SARIF_STATUSES = ['open', 'speculative', 'all'] as const;
export type SarifStatus = (typeof SARIF_STATUSES)[number];

// `all` is every finding a reader may still act on. Suppressed ones carry a SARIF suppression, so viewers hide them;
// resolved and refuted ones are history, not results.
const STATUSES: Record<SarifStatus, FindingStatus[]> = {
  open: ['open'],
  speculative: ['speculative'],
  all: ['open', 'speculative', 'suppressed'],
};

export interface ExportSarifFlags {
  config: string;
  repo?: string[];
  status: SarifStatus;
  out?: string;
}

// The current state of each repository in the database, one SARIF run per repository.
export function sarifFromStore(store: Store, { repos, status, configs }: { repos: string[]; status: SarifStatus; configs: RepoConfig[] }): SarifLog {
  const wanted = new Set(STATUSES[status]);
  const runs: SarifRepo[] = [];
  for (const name of repos) {
    const state = store.readRepoState(name);
    if (!state) continue;
    const findings = Object.values(state.findings)
      .filter((e) => wanted.has(e.status))
      .map((e) => ({ ...e.finding, status: e.status, suppressed_reason: e.status === 'suppressed' ? (e.reason ?? null) : null }));
    const config = configs.find((c) => c.name === name) ?? null;
    runs.push(sarifRepo(config, { name, branch: state.branch, commit: state.last_commit, findings }));
  }
  return buildSarif(runs, { version: reposcoutVersion() });
}

export function exportSarifCommand(flags: ExportSarifFlags): ExitCode {
  const store = openStore(layout());
  const known = store.repoNames();
  const unknown = flags.repo?.filter((r) => !known.includes(r)) ?? [];
  if (unknown.length) {
    console.error(`reposcout: no state in the database for ${unknown.join(', ')}`);
    return ExitCode.Failed;
  }
  // The configuration only adds each repository's remote URL; an export from a copied database works without it.
  let configs: RepoConfig[] = [];
  try {
    configs = loadConfig(resolve(ROOT, flags.config));
  } catch {
    configs = [];
  }
  const log = sarifFromStore(store, { repos: flags.repo?.length ? flags.repo : known, status: flags.status, configs });
  const out = resolve(ROOT, flags.out ?? `exports/reposcout-${new Date().toISOString().replace(/[:.]/g, '-')}.sarif`);
  writeJson(out, log);
  const results = log.runs.reduce((n, r) => n + r.results.length, 0);
  console.log(`Exported ${results} ${flags.status === 'all' ? '' : `${flags.status} `}findings from ${log.runs.length} repositories to ${out}`);
  return ExitCode.Ok;
}
