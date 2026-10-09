import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { budgetDecision, latestRateLimit, passCost } from '../audit/budget.js';
import { claudeEnv, forgetSession, isUsageLimit, runClaude } from '../claude/session.js';
import { buildSettings, toPosix } from '../claude/settings.js';
import { createStreamTracker } from '../claude/stream.js';
import type { RepoConfig } from '../config/config.js';
import { ExitCode, errorMessage } from '../errors.js';
import type { Finding, FindingStatus } from '../findings/types.js';
import { localDate, readJsonOrNull, writeJson } from '../fs.js';
import { type Layout, PACKAGE_DIR } from '../paths.js';
import { acquireLock, describeLock } from '../state/lock.js';
import type { RateLimit, WindowCost } from '../state/types.js';
import { openStore, type Store } from '../store/index.js';
import { createEventSink } from '../telemetry/events.js';
import { createLogger } from '../telemetry/logger.js';

export interface BackfillOptions {
  layout: Layout;
  repos: RepoConfig[];
  statuses: FindingStatus[];
  batchSize: number;
  limit: number | null;
  sessionLimit: number;
  weeklyLimit: number;
  dryRun: boolean;
}

export interface Pending {
  repo: string;
  fingerprint: string;
  finding: Finding;
  status: FindingStatus;
}

type Warn = { warn: (m: string, f?: Record<string, unknown>) => void };

// One field a backfill fills in: which findings lack it, what a session is asked, and how its answer is stored.
export interface BackfillTask<T> {
  mode: string;
  field: 'repro' | 'kind';
  // For the log: "<what> to write", "<what> written".
  what: string;
  // For the run page: "3 of 12 findings <outcome>".
  outcome: string;
  outputName: string;
  outputKey: string;
  prompt: (batchFile: string, outputFile: string, clone: string) => string;
  item: (p: Pending) => Record<string, unknown>;
  parse: (fingerprint: string, raw: Record<string, unknown>) => T | null;
  save: (store: Store, repo: string, items: T[]) => number;
}

const TIMEOUT_MS = 25 * 60_000;
const MAX_TURNS = 90;

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function runBackfill<T>(task: BackfillTask<T>, opts: BackfillOptions): Promise<ExitCode> {
  const { layout } = opts;
  const now = new Date();
  const date = localDate(now);
  const dateDir = join(layout.reportsDir, date);
  const runId = `run-${now.toISOString().replace(/[:.]/g, '-')}`;
  const log = createLogger(join(dateDir, 'logs', `${runId}.log`));
  const store = openStore(layout, log);

  const byRepo = new Map(opts.repos.map((r) => [r.name, r]));
  let pending: Pending[] = store.findingsWithout(task.field, [...byRepo.keys()], opts.statuses);
  if (opts.limit != null) pending = pending.slice(0, opts.limit);
  const missingClone = [...new Set(pending.map((p) => p.repo))].filter((r) => !existsSync(join(layout.workspaceDir, r, '.git')));
  if (missingClone.length) {
    log.warn('no local clone for these repositories; audit them once, then run this again', { repos: missingClone });
    pending = pending.filter((p) => !missingClone.includes(p.repo));
  }
  // Batches stay inside one repository, since a session reads one clone; most severe first across the whole run.
  const batches = [...byRepo.keys()]
    .flatMap((repo) =>
      chunks(
        pending.filter((p) => p.repo === repo),
        opts.batchSize,
      ),
    )
    .sort((a, b) => pending.indexOf(a[0] as Pending) - pending.indexOf(b[0] as Pending));
  log.info(`${task.what} to write`, { findings: pending.length, batches: batches.length, statuses: opts.statuses });
  if (opts.dryRun || !batches.length) return ExitCode.Ok;

  const eventsFile = join(dateDir, 'logs', `${runId}.events.jsonl`);
  const release = acquireLock(layout.lockFile, log, { run_id: runId, events_file: toPosix(eventsFile).slice(toPosix(layout.root).length + 1) });
  if (!release) {
    log.warn('another RepoScout run is in progress; try again when it finishes', { lock: describeLock(layout.lockFile) });
    return ExitCode.Busy;
  }
  const events = createEventSink(eventsFile);
  const isCancelled = () => readJsonOrNull<{ run_id?: string }>(layout.cancelFile)?.run_id === runId;
  const repos = [...new Set(batches.map((b) => b[0]?.repo as string))];
  events.emit('run_started', { run_id: runId, repos, mode: task.mode, pid: process.pid, prepare_only: false });

  let written = 0;
  let exit: ExitCode = ExitCode.Ok;
  let lastCost: WindowCost | null = null;
  const done = new Map<string, number>();
  try {
    for (const [i, batch] of batches.entries()) {
      if (isCancelled()) {
        exit = ExitCode.Cancelled;
        log.warn('cancelled from the dashboard; what was written so far is kept');
        break;
      }
      const before = latestRateLimit(store.usage(50));
      const decision = budgetDecision({ rateLimit: before, lastCost, sessionLimit: opts.sessionLimit, weeklyLimit: opts.weeklyLimit });
      if (!decision.proceed) {
        exit = ExitCode.Budget;
        log.warn('stopping before the next batch to stay within the subscription budget; run this again to continue', { reason: decision.reason });
        events.emit('sweep_pass', { repo: batch[0]?.repo, pass: i + 1, proceed: false, reason: decision.reason });
        break;
      }
      const repo = byRepo.get(batch[0]?.repo as string) as RepoConfig;
      const out = await runBatch({ task, opts, repo, batch, index: i, runId, dateDir, events, log, cancelled: isCancelled });
      if (out.error) {
        exit = out.usageLimit ? ExitCode.UsageLimit : ExitCode.Failed;
        log.error('batch failed', { repo: repo.name, batch: i + 1, error: out.error });
        if (out.usageLimit || out.cancelled) break;
        continue;
      }
      const count = task.save(store, repo.name, out.items);
      written += count;
      done.set(repo.name, (done.get(repo.name) ?? 0) + count);
      lastCost = passCost(before, out.rateLimit) ?? lastCost;
      store.appendUsage({
        date,
        at: new Date().toISOString(),
        repo: repo.name,
        mode: task.mode,
        analyzers: [],
        files: batch.length,
        ok: true,
        terminal_reason: null,
        rate_limit: out.rateLimit ?? null,
        wall_ms: out.wallMs,
        window_cost: passCost(out.firstRateLimit, out.rateLimit),
      });
      log.info('batch done', { repo: repo.name, batch: `${i + 1}/${batches.length}`, written: count, of: batch.length, total: written });
      events.emit('repo_finished', {
        repo: repo.name,
        status: 'ok',
        reason: `batch ${i + 1} of ${batches.length}: ${count} of ${batch.length} findings ${task.outcome}`,
      });
    }
  } finally {
    log.info(`${task.what} written`, { total: written, by_repo: Object.fromEntries(done) });
    events.emit('run_finished', { run_id: runId, exit, outcomes: Object.fromEntries([...done].map(([r, n]) => [r, { status: 'ok', written: n }])) });
    if (isCancelled()) rmSync(layout.cancelFile, { force: true });
    release();
  }
  return exit;
}

interface BatchInput<T> {
  task: BackfillTask<T>;
  opts: BackfillOptions;
  repo: RepoConfig;
  batch: Pending[];
  index: number;
  runId: string;
  dateDir: string;
  events: ReturnType<typeof createEventSink>;
  log: ReturnType<typeof createLogger>;
  cancelled: () => boolean;
}

interface BatchOutcome<T> {
  items: T[];
  rateLimit: RateLimit | null;
  firstRateLimit: RateLimit | null;
  wallMs: number;
  error?: string;
  usageLimit?: boolean;
  cancelled?: boolean;
}

async function runBatch<T>({ task, opts, repo, batch, index, runId, dateDir, events, log, cancelled }: BatchInput<T>): Promise<BatchOutcome<T>> {
  const { layout } = opts;
  const clone = join(layout.workspaceDir, repo.name);
  const workDir = join(dateDir, '.work', runId, `${repo.name}-${index + 1}`);
  rmSync(workDir, { recursive: true, force: true });
  mkdirSync(workDir, { recursive: true });
  const batchFile = join(workDir, 'findings.json');
  const outputFile = join(workDir, task.outputName);
  writeJson(
    batchFile,
    batch.map((p) => ({ fingerprint: p.fingerprint, status: p.status, ...task.item(p) })),
  );

  // Specialist model: the finding is already verified, and what is missing follows from it and its code.
  const claudeCfg = { ...repo.claude, max_turns: MAX_TURNS, models: { ...repo.claude.models, orchestrator: repo.claude.models.specialists } };
  const env = claudeEnv({ rootDir: layout.root, auth: claudeCfg.auth });
  const tracker = createStreamTracker({ emit: events.emit, repo: repo.name });
  const sessionId = randomUUID();
  events.emit('repo_started', { repo: repo.name, pass: index + 1 });
  try {
    const run = await runClaude({
      rootDir: PACKAGE_DIR,
      workDir,
      prompt: task.prompt(batchFile, outputFile, clone),
      claudeCfg,
      agents: {},
      settings: buildSettings({ rootDir: PACKAGE_DIR, dataDir: layout.root, cloneDir: clone, workDir, outputFile, verifyDir: null, testCommand: null }),
      env,
      timeoutMs: TIMEOUT_MS,
      onMessage: tracker.handle,
      shouldCancel: cancelled,
      sessionId,
      tools: ['Read', 'Grep', 'Glob', 'Write'],
    });
    run.rateLimit = tracker.rateLimit;
    const base = { rateLimit: tracker.rateLimit, firstRateLimit: tracker.firstRateLimit, wallMs: run.wallMs };
    if (run.cancelled) return { ...base, error: 'cancelled', cancelled: true, items: [] };
    if (isUsageLimit(run)) return { ...base, error: 'subscription usage limit reached', usageLimit: true, items: [] };
    if (run.timedOut || run.spawnError || run.result?.subtype !== 'success') {
      return { ...base, error: run.spawnError ?? (run.timedOut ? 'timed out' : `claude ended with ${run.result?.subtype ?? 'no result'}`), items: [] };
    }
    return { ...base, items: readOutput(task, outputFile, new Set(batch.map((b) => b.fingerprint)), log) };
  } catch (e) {
    return { rateLimit: tracker.rateLimit, firstRateLimit: tracker.firstRateLimit, wallMs: 0, error: errorMessage(e), items: [] };
  } finally {
    forgetSession({ env, sessionId });
  }
}

// Only well-formed entries for findings that were in the batch are kept; anything else in the file is ignored.
export function readOutput<T>(task: Pick<BackfillTask<T>, 'outputKey' | 'parse'>, file: string, expected: Set<string>, log: Warn): T[] {
  if (!existsSync(file)) {
    log.warn('the session wrote no output file');
    return [];
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    log.warn('the output file is not valid JSON', { error: errorMessage(e) });
    return [];
  }
  const list = raw && typeof raw === 'object' ? (raw as Record<string, unknown>)[task.outputKey] : null;
  const out: T[] = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(list) ? list : []) {
    if (!item || typeof item !== 'object') continue;
    const { fingerprint } = item as { fingerprint?: unknown };
    if (typeof fingerprint !== 'string' || !expected.has(fingerprint) || seen.has(fingerprint)) continue;
    const parsed = task.parse(fingerprint, item as Record<string, unknown>);
    if (parsed) {
      out.push(parsed);
      seen.add(fingerprint);
    }
  }
  return out;
}
