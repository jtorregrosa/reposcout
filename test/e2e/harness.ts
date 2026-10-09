import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stringify } from 'yaml';
import { parseJsonLines } from '../../src/fs.js';
import { layout } from '../../src/paths.js';
import { Store } from '../../src/store/store.js';

// The end-to-end harness: a temporary REPOSCOUT_HOME, a git repository on disk served by the local provider, and the
// real CLI run from src/ through tsx with the fake claude in place of the real one. Nothing here touches the
// network, the package's own state/ or reports/, or a Claude subscription.

export const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const FAKE_CLAUDE = join(PACKAGE_DIR, 'test', 'e2e', 'fake-claude.mjs');
const CLI = join(PACKAGE_DIR, 'src', 'cli.ts');

const GIT_IDENTITY = {
  GIT_AUTHOR_NAME: 'RepoScout Test',
  GIT_AUTHOR_EMAIL: 'test@reposcout.invalid',
  GIT_COMMITTER_NAME: 'RepoScout Test',
  GIT_COMMITTER_EMAIL: 'test@reposcout.invalid',
};

export function git(dir: string, args: string[]): string {
  const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', env: { ...process.env, ...GIT_IDENTITY }, windowsHide: true });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout.trim();
}

export interface Behaviour {
  behaviour?: 'findings' | 'no-output' | 'usage-limit' | 'hang' | 'slow' | 'fail';
  findings?: { file: string; line: number; snippet: string; category: string; severity?: string; title?: string; verified?: boolean }[];
  speculative?: { file: string; line: number; snippet: string; category: string; unconfirmed: string }[];
  validation?: Record<string, 'reproduced' | 'not_reproduced' | 'not_testable'>;
  five_hour?: number;
  seven_day?: number;
  delay_ms?: number;
}

export interface Home {
  dir: string;
  scenarioFile: string;
  callLog: string;
  // A git repository under the home, outside workspace/, committed with the given files.
  createRepo(name: string, files: Record<string, string>): string;
  commit(repoDir: string, files: Record<string, string>, message?: string): string;
  writeConfig(repos: Record<string, unknown>[], defaults?: Record<string, unknown>): void;
  scenario(s: { default?: Behaviour; repos?: Record<string, Behaviour> }): void;
  run(args: string[], options?: { onCall?: (call: FakeCall) => void; env?: NodeJS.ProcessEnv }): Promise<CliResult>;
  calls(): FakeCall[];
  store<T>(fn: (store: Store) => T): T;
  reportsDir(): string;
  remove(): void;
}

export interface CliResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export interface FakeCall {
  kind: 'version' | 'audit' | 'resume';
  repo?: string;
  mode?: string;
  files?: string[];
  false_positives?: string[];
}

// The environment of a CLI run against the fake claude; home is REPOSCOUT_HOME, when there is one.
export function fakeEnv({ home, scenarioFile, callLog }: { home?: string; scenarioFile: string; callLog: string }): NodeJS.ProcessEnv {
  const e: NodeJS.ProcessEnv = {
    ...process.env,
    REPOSCOUT_CLAUDE_BIN: FAKE_CLAUDE,
    REPOSCOUT_ALLOW_LOCAL_PROVIDER: '1',
    // claude.auth: isolated needs a token; the fake never looks at it.
    CLAUDE_CODE_OAUTH_TOKEN: 'fake-oauth-token',
    FAKE_CLAUDE_SCENARIO: scenarioFile,
    FAKE_CLAUDE_LOG: callLog,
  };
  if (home) e.REPOSCOUT_HOME = home;
  else delete e.REPOSCOUT_HOME;
  delete e.ANTHROPIC_API_KEY;
  delete e.ANTHROPIC_AUTH_TOKEN;
  return e;
}

export function createHome(): Home {
  const dir = mkdtempSync(join(tmpdir(), 'reposcout-e2e-'));
  const scenarioFile = join(dir, 'fake-scenario.json');
  const callLog = join(dir, 'fake-calls.jsonl');
  writeFileSync(scenarioFile, '{}');

  const commit = (repoDir: string, files: Record<string, string>, message = 'change') => {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(repoDir, path)), { recursive: true });
      writeFileSync(join(repoDir, path), text);
    }
    git(repoDir, ['add', '-A']);
    git(repoDir, ['commit', '--quiet', '-m', message]);
    return git(repoDir, ['rev-parse', 'HEAD']);
  };

  const env = () => fakeEnv({ home: dir, scenarioFile, callLog });

  return {
    dir,
    scenarioFile,
    callLog,
    createRepo(name, files) {
      const repoDir = join(dir, 'origin', name);
      mkdirSync(repoDir, { recursive: true });
      git(repoDir, ['init', '--quiet', '--initial-branch=main']);
      git(repoDir, ['config', 'core.autocrlf', 'false']);
      commit(repoDir, files, 'initial');
      return repoDir;
    },
    commit,
    writeConfig(repos, defaults = {}) {
      const doc = {
        defaults: { provider: 'local', analyzers: ['security', 'logic'], claude: { auth: 'isolated' }, ...defaults },
        repos,
      };
      writeFileSync(join(dir, 'repos.yaml'), stringify(doc));
    },
    scenario(s) {
      writeFileSync(scenarioFile, JSON.stringify(s));
    },
    run(args, hooks = {}) {
      return new Promise((resolvePromise, reject) => {
        const child = spawn(process.execPath, ['--import', 'tsx', CLI, ...args], { cwd: PACKAGE_DIR, env: { ...env(), ...hooks.env }, windowsHide: true });
        let stdout = '';
        let stderr = '';
        child.stdout.setEncoding('utf8').on('data', (d: string) => {
          stdout += d;
        });
        child.stderr.setEncoding('utf8').on('data', (d: string) => {
          stderr += d;
        });
        // Polls the fake's call log so a test can act while the CLI is mid-run (cancel, for one).
        const seen = new Set<number>();
        const poll = hooks.onCall
          ? setInterval(() => {
              this.calls().forEach((c, i) => {
                if (seen.has(i)) return;
                seen.add(i);
                hooks.onCall?.(c);
              });
            }, 100)
          : null;
        child.on('error', reject);
        child.on('close', (code) => {
          if (poll) clearInterval(poll);
          resolvePromise({ code, stdout, stderr });
        });
      });
    },
    calls() {
      return existsSync(callLog) ? parseJsonLines<FakeCall>(readFileSync(callLog, 'utf8')) : [];
    },
    store(fn) {
      const store = new Store(layout(dir).dbFile);
      try {
        return fn(store);
      } finally {
        store.close();
      }
    },
    reportsDir() {
      // One run, one local date; a test that crosses midnight would see two.
      const reports = join(dir, 'reports');
      const dates = readdirSync(reports).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
      return join(reports, dates.sort().at(-1) as string);
    },
    remove() {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    },
  };
}

export const readJsonFile = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;

// Events the run wrote for the dashboard, from every run in the home.
export function runEvents(home: Home): { type: string; [key: string]: unknown }[] {
  const logs = join(home.reportsDir(), 'logs');
  return readdirSync(logs)
    .filter((f) => f.endsWith('.events.jsonl'))
    .sort()
    .flatMap((f) => parseJsonLines<{ type: string }>(readFileSync(join(logs, f), 'utf8')));
}
