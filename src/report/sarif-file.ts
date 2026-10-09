import { readFileSync } from 'node:fs';
import { type RepoConfig, remoteUrl } from '../config/config.js';
import { writeJson } from '../fs.js';
import { buildSarif, type SarifRepo } from './sarif.js';
import type { RepoReport } from './types.js';

let cached: string | null = null;

// From the package's own package.json, which sits two levels above this module in both src/ and dist/.
export function reposcoutVersion(): string {
  cached ??= (JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string }).version;
  return cached;
}

export const sarifRepo = (
  repo: Pick<RepoConfig, 'provider' | 'organization' | 'project' | 'repo'> | null,
  base: Omit<SarifRepo, 'repositoryUri'>,
): SarifRepo => ({
  ...base,
  repositoryUri: repo ? remoteUrl(repo) : null,
});

// A run's open findings (new and existing) as a SARIF log beside its JSON report.
export function writeReportSarif(path: string, report: RepoReport, repo: RepoConfig): void {
  const log = buildSarif([sarifRepo(repo, { name: report.repo, branch: report.branch, commit: report.commit, findings: report.findings })], {
    version: reposcoutVersion(),
  });
  writeJson(path, log);
}
