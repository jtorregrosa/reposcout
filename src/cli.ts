#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Command, InvalidArgumentError, Option } from 'commander';
import { type BackfillFlags, backfillCommand } from './commands/backfill.js';
import { dbExportCommand, dbImportCommand, dbInfoCommand } from './commands/db.js';
import { doctorCommand } from './commands/doctor.js';
import { type ExportSarifFlags, exportSarifCommand, SARIF_STATUSES } from './commands/export.js';
import {
  collect,
  parseAnalyzerList,
  parseAuth,
  parseMaxFiles,
  parseMaxPasses,
  parseMode,
  parsePercent,
  parsePort,
  parseSweepSince,
} from './commands/options.js';
import { type RunFlags, runCommand } from './commands/run.js';
import { uiCommand } from './commands/ui.js';
import { ExitCode, errorMessage } from './errors.js';
import { PACKAGE_DIR } from './paths.js';

const { version } = JSON.parse(readFileSync(join(PACKAGE_DIR, 'package.json'), 'utf8')) as { version: string };

const EXIT_CODES = `
Exit codes:
  0  every repository ok or skipped
  1  a repository failed
  2  another run holds the lock
  3  stopped at the subscription usage limit
  4  cancelled from the dashboard
  5  a sweep stopped at the session or weekly budget`;

const configOption = () =>
  new Option('--config <path>', 'config file, relative to the data directory (REPOSCOUT_HOME, or the RepoScout directory)').default('repos.yaml');

const program = new Command()
  .name('reposcout')
  .description('Automated bug auditing of Azure DevOps repositories with Claude Code subagents.')
  .version(version)
  .showHelpAfterError('(run with --help for usage)')
  .configureOutput({ outputError: (str, write) => write(`reposcout: ${str}`) });

program
  .command('run')
  .description('Audit the configured repositories')
  .addOption(
    new Option(
      '--mode <mode>',
      'incremental audits changes since the last audited commit; speculative re-examines only unconfirmed candidates (--max-files caps them, default 30); validate tries to reproduce open findings still at the detected stage with a test (--max-files caps them, default 10)',
    ).argParser(parseMode),
  )
  .option('--repo <name>', 'only this repository (repeatable)', collect)
  .option('--max-files <n>', 'override max_files_per_run', parseMaxFiles)
  .option('--analyzers <list>', 'comma-separated subset of security,concurrency,error-handling,logic,performance', parseAnalyzerList)
  .option('--prepare-only', 'clone, diff and write the manifest, but do not call Claude', false)
  .addOption(new Option('--auth <mode>', 'override claude.auth for this run').argParser(parseAuth))
  .option(
    '--until-covered',
    'full mode: repeat passes until every file is audited since the sweep began, stopping before a pass would cross the session or weekly limit',
    false,
  )
  .option('--session-limit <percent>', 'with --until-covered or --mode validate: 5-hour window ceiling (default 90)', parsePercent)
  .option('--weekly-limit <percent>', 'with --until-covered or --mode validate: weekly window ceiling (default 95)', parsePercent)
  .option('--max-passes <n>', 'with --until-covered: at most this many passes per repository (default 30)', parseMaxPasses)
  .option('--sweep-since <iso>', 'with --until-covered: resume a sweep, counting the audits made since it began (its log gives the value)', (v: string) =>
    parseSweepSince(v),
  )
  .addOption(configOption())
  .addHelpText('after', EXIT_CODES)
  .action(async (flags: RunFlags) => {
    process.exitCode = await runCommand(flags);
  });

program
  .command('doctor')
  .description('Check prerequisites without touching any repository')
  .addOption(configOption())
  .action(async (flags: { config: string }) => {
    process.exitCode = await doctorCommand(flags);
  });

program
  .command('ui')
  .description('Local dashboard on 127.0.0.1: live run, findings, repositories, usage')
  .option('--port <n>', 'port to listen on', parsePort, 4477)
  .option('--no-open', 'do not open the browser')
  .addOption(configOption())
  .action(async (flags: { port: number; open: boolean; config: string }) => {
    await uiCommand(flags);
  });

const STATUSES = ['open', 'speculative', 'suppressed', 'resolved', 'refuted', 'duplicate'];
const parseStatuses = (value: string) => {
  const list = value.split(',').map((s) => s.trim());
  const unknown = list.find((s) => !STATUSES.includes(s));
  if (unknown || !list.length) throw new InvalidArgumentError(`must be a comma-separated list of ${STATUSES.join(', ')}`);
  return list;
};
const parseLimit = (value: string) => {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new InvalidArgumentError('must be a positive integer');
  return n;
};
const parseBatch = (value: string) => {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 30) throw new InvalidArgumentError('must be an integer from 1 to 30');
  return n;
};

const backfill = (name: string, description: string, batchSize: number, skipped: string) =>
  program
    .command(name)
    .description(description)
    .option('--repo <name>', 'only this repository (repeatable)', collect)
    .option('--status <list>', 'statuses to fill', parseStatuses, ['open', 'speculative'])
    .option('--batch-size <n>', 'findings per Claude session', parseBatch, batchSize)
    .option('--limit <n>', 'at most this many findings in this run', parseLimit)
    .option('--session-limit <percent>', '5-hour window ceiling', parsePercent, 90)
    .option('--weekly-limit <percent>', 'weekly window ceiling', parsePercent, 95)
    .option('--dry-run', 'count what would be filled, without calling Claude', false)
    .addOption(configOption())
    .addHelpText('after', `\nResumable: findings that already have ${skipped} are skipped, so running it again continues where it stopped.`);

backfill(
  'backfill-repro',
  'Write reproduction steps for findings that have none, most severe first, stopping before the session budget runs out',
  12,
  'steps',
).action(async (flags: BackfillFlags) => {
  process.exitCode = await backfillCommand('repro', flags);
});

backfill('backfill-kind', 'Label findings that have no type yet as bug, vulnerability or chore, and mark those involving personal data', 30, 'a type').action(
  async (flags: BackfillFlags) => {
    process.exitCode = await backfillCommand('kind', flags);
  },
);

const db = program.command('db').description('The SQLite database under state/: inspect, import the older JSON state, export and restore it as JSON');

db.command('info')
  .description('Where the database is and what it holds')
  .action(() => {
    process.exitCode = dbInfoCommand();
  });

db.command('import')
  .description('Import the JSON state of older versions, or restore a db export, into an empty database')
  .option('--from <dir>', 'restore the export in this directory, relative to the data directory')
  .action((flags: { from?: string }) => {
    process.exitCode = dbImportCommand(flags);
  });

db.command('export')
  .description('Write the whole database as JSON files that db import --from restores')
  .option('--out <dir>', 'output directory, relative to the data directory (default: exports/<timestamp>)')
  .action((flags: { out?: string }) => {
    process.exitCode = dbExportCommand(flags);
  });

const exporter = program.command('export').description('Export findings from the database in a format other tools read');

exporter
  .command('sarif')
  .description('Current findings as one SARIF 2.1.0 log, one run per repository, for code scanning and SARIF viewers')
  .option('--repo <name>', 'only this repository (repeatable)', collect)
  .addOption(new Option('--status <status>', 'open, speculative, or all (open, speculative and suppressed)').choices(SARIF_STATUSES).default('open'))
  .option('--out <file>', 'output file, relative to the RepoScout directory (default: exports/reposcout-<timestamp>.sarif)')
  .addOption(configOption())
  .action((flags: ExportSarifFlags) => {
    process.exitCode = exportSarifCommand(flags);
  });

try {
  await program.parseAsync();
} catch (e) {
  console.error(`reposcout: ${errorMessage(e)}`);
  process.exitCode = ExitCode.Failed;
}
