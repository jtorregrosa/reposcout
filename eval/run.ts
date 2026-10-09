// Evaluates the audit prompts and models against the seeded corpus under eval/corpus: each case becomes a git
// repository in a temporary REPOSCOUT_HOME, the real CLI audits it in full mode through the local provider, and
// score.ts matches what it reported against the case's truth.yaml. It spends real subscription usage, so it only
// prints an estimate unless --yes is given.
//
//   pnpm eval                                  # estimate only
//   pnpm eval --yes                            # every case, every analyzer
//   pnpm eval --yes --case orders-api --analyzers security,logic
//   pnpm eval --yes --models specialists=haiku,verifier=sonnet
//   pnpm eval --yes --keep --out /tmp/eval    # keep the temporary homes; write the results elsewhere
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { stringify } from 'yaml';
import { DEFAULT_PASS_COST } from '../src/audit/budget.js';
import { ANALYZERS, type Analyzer, AUTH_MODES, parseAnalyzers } from '../src/config/analyzers.js';
import { ALLOW_LOCAL_ENV, parseConfig } from '../src/config/config.js';
import { ExitCode, errorMessage } from '../src/errors.js';
import type { RepoReport } from '../src/report/types.js';
import { loadEnv } from '../src/security/env.js';
import {
  type CaseResult,
  caseUsage,
  type EvalResult,
  parseTruth,
  promptVersion,
  RESULT_SCHEMA,
  reportFindings,
  scoreCase,
  toMarkdown,
  totals,
} from './score.js';

const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CORPUS_DIR = join(PACKAGE_DIR, 'eval', 'corpus');
const RESULTS_DIR = join(PACKAGE_DIR, 'eval', 'results');
const CLI = join(PACKAGE_DIR, 'src', 'cli.ts');
const ROLES = ['orchestrator', 'specialists', 'verifier'];

const GIT_IDENTITY = {
  GIT_AUTHOR_NAME: 'RepoScout Eval',
  GIT_AUTHOR_EMAIL: 'eval@reposcout.invalid',
  GIT_COMMITTER_NAME: 'RepoScout Eval',
  GIT_COMMITTER_EMAIL: 'eval@reposcout.invalid',
};

function git(dir: string, args: string[]): void {
  const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', env: { ...process.env, ...GIT_IDENTITY }, windowsHide: true });
  if (r.status !== 0) throw new Error(`git ${args[0]} failed: ${r.stderr}`);
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .map((f) => join(dir, f))
    .filter((f) => statSync(f).isFile());
}

const countLines = (files: string[]) =>
  files.reduce(
    (n, f) =>
      n +
      readFileSync(f, 'utf8')
        .split('\n')
        .filter((l) => l.trim()).length,
    0,
  );

function parseModels(value: string | undefined): Record<string, string> {
  const models: Record<string, string> = {};
  for (const pair of (value ?? '').split(',').filter(Boolean)) {
    const [role, alias] = pair.split('=').map((s) => s.trim());
    if (!role || !alias || !ROLES.includes(role)) throw new Error(`--models takes role=alias pairs for ${ROLES.join(', ')}, e.g. verifier=opus`);
    models[role] = alias;
  }
  return models;
}

function latestResult(dir: string): EvalResult | null {
  if (!existsSync(dir)) return null;
  const last = readdirSync(dir)
    .filter((f) => /^\d{4}-\d{2}-\d{2}T[\d-]+Z\.json$/.test(f))
    .sort()
    .at(-1);
  const result = last ? (JSON.parse(readFileSync(join(dir, last), 'utf8')) as EvalResult) : null;
  return result?.schema === RESULT_SCHEMA ? result : null;
}

function currentPromptVersion(): string {
  const files = [
    join('.claude', 'skills', 'audit', 'SKILL.md'),
    ...readdirSync(join(PACKAGE_DIR, '.claude', 'agents')).map((f) => join('.claude', 'agents', f)),
  ]
    .filter((p) => p.endsWith('.md'))
    .map((p) => ({ path: p.replace(/\\/g, '/'), text: readFileSync(join(PACKAGE_DIR, p), 'utf8') }));
  return promptVersion(files);
}

// The newest report the CLI wrote for this case, from any date directory.
function findReport(home: string, name: string): RepoReport | null {
  const reports = join(home, 'reports');
  if (!existsSync(reports)) return null;
  const candidates = readdirSync(reports)
    .map((d) => join(reports, d, `${name}.json`))
    .filter((f) => existsSync(f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return candidates[0] ? (JSON.parse(readFileSync(candidates[0], 'utf8')) as RepoReport) : null;
}

function runCli(home: string, args: string[]): Promise<number | null> {
  return new Promise((resolveExit, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', CLI, ...args], {
      cwd: PACKAGE_DIR,
      env: { ...process.env, REPOSCOUT_HOME: home, [ALLOW_LOCAL_ENV]: '1' },
      stdio: 'inherit',
      windowsHide: true,
    });
    child.on('error', reject);
    child.on('close', resolveExit);
  });
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const { values } = parseArgs({
    // `pnpm eval -- --yes` passes the separator through; past it every flag would be a positional.
    args: argv[0] === '--' ? argv.slice(1) : argv,
    options: {
      yes: { type: 'boolean', default: false },
      case: { type: 'string', multiple: true },
      analyzers: { type: 'string' },
      models: { type: 'string' },
      auth: { type: 'string' },
      keep: { type: 'boolean', default: false },
      out: { type: 'string', default: RESULTS_DIR },
    },
  });
  const resultsDir = resolve(values.out);
  const analyzers: Analyzer[] = values.analyzers ? parseAnalyzers(values.analyzers, '--analyzers') : [...ANALYZERS];
  const models = parseModels(values.models);
  if (values.auth && !(AUTH_MODES as readonly string[]).includes(values.auth)) throw new Error(`--auth must be ${AUTH_MODES.join(' or ')}`);
  const available = readdirSync(CORPUS_DIR).filter((d) => existsSync(join(CORPUS_DIR, d, 'truth.yaml')));
  const unknown = (values.case ?? []).filter((c) => !available.includes(c));
  if (unknown.length) throw new Error(`unknown case ${unknown.join(', ')}; available: ${available.join(', ')}`);
  const cases = values.case?.length ? available.filter((c) => values.case?.includes(c)) : available;

  // The estimate: one full audit per case, measured by the last result when there is one.
  const previous = latestResult(resultsDir);
  console.log(`RepoScout evaluation: ${cases.length} case(s), analyzers ${analyzers.join(', ')}, prompt version ${currentPromptVersion()}`);
  for (const c of cases) {
    const files = sourceFiles(join(CORPUS_DIR, c, 'src'));
    console.log(`  ${c}: ${files.length} files, ${countLines(files)} lines, one full audit`);
  }
  const measured = previous?.totals.five_hour != null && previous.cases.length ? previous.totals.five_hour / previous.cases.length : null;
  const perCase = measured ?? DEFAULT_PASS_COST.five_hour;
  console.log(
    `Estimated cost: about ${Math.round(perCase * cases.length * 100)}% of the 5-hour window` +
      (measured != null ? ` (measured by the run of ${previous?.at})` : ' (the sweep budget’s conservative per-pass guess; nothing measured yet)') +
      ', plus a few minutes per case.',
  );
  if (!values.yes) {
    console.log('This spends real subscription usage. Run again with --yes to start.');
    return ExitCode.Failed;
  }

  // The CLI reads .env from its data root, which is a temporary directory here, so the token comes from ours.
  loadEnv(PACKAGE_DIR);
  process.env[ALLOW_LOCAL_ENV] = '1';
  const results: CaseResult[] = [];
  let configModels: Record<string, string> = {};
  for (const name of cases) {
    const home = mkdtempSync(join(tmpdir(), `reposcout-eval-${name}-`));
    try {
      const truth = parseTruth(readFileSync(join(CORPUS_DIR, name, 'truth.yaml'), 'utf8'), `${name}/truth.yaml`);
      const origin = join(home, 'origin', name);
      mkdirSync(origin, { recursive: true });
      cpSync(join(CORPUS_DIR, name, 'src'), join(origin, 'src'), { recursive: true });
      git(origin, ['init', '--quiet', '--initial-branch=main']);
      git(origin, ['add', '-A']);
      git(origin, ['commit', '--quiet', '-m', `eval corpus ${name}`]);
      const config = stringify({
        repos: [
          { name, provider: 'local', path: origin, mode: 'full', analyzers, max_files_full_run: 150, claude: Object.keys(models).length ? { models } : {} },
        ],
      });
      writeFileSync(join(home, 'repos.yaml'), config);
      configModels = { ...parseConfig(config)[0]?.claude.models };

      console.log(`\n=== ${name} (${home}) ===`);
      const args = ['run', '--mode', 'full', ...(values.auth ? ['--auth', values.auth] : [])];
      const exit = await runCli(home, args);
      const report = findReport(home, name);
      if (exit !== ExitCode.Ok || !report) {
        results.push({ case: name, score: null, usage: null, error: `run exited ${exit}` });
        // At the subscription limit every later case would fail the same way.
        if (exit === ExitCode.UsageLimit) break;
        continue;
      }
      const files = sourceFiles(join(origin, 'src'));
      const scored = scoreCase({ truth, ...reportFindings(report), analyzers, lines: countLines(files) });
      results.push({ case: name, score: scored, usage: caseUsage(report.usage) });
      console.log(`${name}: recall ${scored.found.length}/${scored.bugs}, ${scored.false_positives.length} false positive(s)`);
    } catch (e) {
      results.push({ case: name, score: null, usage: null, error: errorMessage(e) });
    } finally {
      if (values.keep) console.log(`kept ${home}`);
      else rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  }

  const at = new Date().toISOString();
  const result: EvalResult = {
    schema: RESULT_SCHEMA,
    at,
    prompt_version: currentPromptVersion(),
    models: configModels,
    analyzers,
    cases: results,
    totals: totals(results),
  };
  mkdirSync(resultsDir, { recursive: true });
  const stem = join(resultsDir, at.replace(/[:.]/g, '-'));
  const markdown = toMarkdown(result, previous);
  writeFileSync(`${stem}.json`, `${JSON.stringify(result, null, 2)}\n`);
  writeFileSync(`${stem}.md`, markdown);
  console.log(`\n${markdown}\nWritten to ${relative(PACKAGE_DIR, stem)}.json and .md`);
  return results.every((r) => r.score) ? ExitCode.Ok : ExitCode.Failed;
}

try {
  process.exitCode = await main();
} catch (e) {
  console.error(`eval: ${errorMessage(e)}`);
  process.exitCode = ExitCode.Failed;
}
