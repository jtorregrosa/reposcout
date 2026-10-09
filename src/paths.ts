import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The package directory holds the code: dist/, web/dist/ and the .claude/ directory the audit session is started
// in, with the skill and the agent prompts. Resolved from this module so dist/ and src/ agree.
export const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// The data root holds what a run reads and writes: repos.yaml, .env, state/, reports/, workspace/, .claude-home/
// and exports/. It is the package directory unless REPOSCOUT_HOME points elsewhere, which keeps a test, an
// evaluation or a second installation's data apart from the code.
export const ROOT = process.env.REPOSCOUT_HOME ? resolve(process.env.REPOSCOUT_HOME) : PACKAGE_DIR;

export const CLI_ENTRY = join(PACKAGE_DIR, 'dist', 'cli.js');
export const UI_DIR = join(PACKAGE_DIR, 'web', 'dist');

export interface Layout {
  root: string;
  stateDir: string;
  reportsDir: string;
  workspaceDir: string;
  lockFile: string;
  cancelFile: string;
  dbFile: string;
  // Where state lived before SQLite; read once, by the import.
  legacyUsageFile: string;
  legacyCensusFile: string;
}

export function layout(root: string = ROOT): Layout {
  const stateDir = join(root, 'state');
  return {
    root,
    stateDir,
    reportsDir: join(root, 'reports'),
    workspaceDir: join(root, 'workspace'),
    lockFile: join(stateDir, '.lock'),
    cancelFile: join(stateDir, '.cancel'),
    dbFile: join(stateDir, 'reposcout.db'),
    legacyUsageFile: join(stateDir, 'usage.jsonl'),
    legacyCensusFile: join(stateDir, 'census.json'),
  };
}
