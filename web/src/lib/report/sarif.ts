// The dashboard's SARIF export, built by the CLI's own builder so both produce the same log. It is the one runtime
// module the web app takes from src/: it has no Node dependency, only the types and the redaction patterns.
import { buildSarif, type SarifRepo } from '../../../../src/report/sarif';
import type { FindingView, RepoView } from '../types';

// Set by vite.config.ts from package.json; absent under Vitest.
declare const __REPOSCOUT_VERSION__: string | undefined;
const VERSION = typeof __REPOSCOUT_VERSION__ === 'string' ? __REPOSCOUT_VERSION__ : '0.0.0';

// One run per repository among the findings, with its branch and last audited commit when the dashboard knows them.
export function buildSarifReport(findings: FindingView[], repos: Pick<RepoView, 'name' | 'branch' | 'last_commit'>[] = []): string {
  const names = [...new Set(findings.map((f) => f.repo))].sort();
  const runs: SarifRepo[] = names.map((name) => {
    const repo = repos.find((r) => r.name === name);
    return {
      name,
      branch: repo?.branch ?? null,
      commit: repo?.last_commit ?? null,
      findings: findings.filter((f) => f.repo === name),
    };
  });
  return `${JSON.stringify(buildSarif(runs, { version: VERSION }), null, 2)}\n`;
}
