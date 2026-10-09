import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { claudeVersion } from '../claude/session.js';
import { toPosix } from '../claude/settings.js';
import type { RepoConfig, WebhookConfig } from '../config/config.js';
import { CancelledError, ExitCode, errorMessage, UsageLimitError } from '../errors.js';
import { localDate, readJsonOrNull } from '../fs.js';
import { digestOf, notifyRun } from '../notify/webhooks.js';
import type { Layout } from '../paths.js';
import { writeSummary } from '../report/summary.js';
import { redactDeep } from '../security/secrets.js';
import { acquireLock, describeLock } from '../state/lock.js';
import { openStore } from '../store/index.js';
import { createEventSink } from '../telemetry/events.js';
import { createLogger } from '../telemetry/logger.js';
import type { AuditOptions, RepoOutcome, RunContext, SweepOptions } from './context.js';
import { auditRepo } from './repo.js';
import { sweepRepo } from './sweep.js';

export interface RunRequest {
  layout: Layout;
  repos: RepoConfig[];
  opts: Omit<AuditOptions, 'isCancelled'>;
  sweep: SweepOptions | null;
  // Told once every repository is done; see src/notify/webhooks.ts.
  webhooks?: WebhookConfig[];
}

export async function runAudits({ layout, repos, opts, sweep, webhooks = [] }: RunRequest): Promise<ExitCode> {
  const now = new Date();
  const date = localDate(now);
  const dateDir = join(layout.reportsDir, date);
  const runId = `run-${now.toISOString().replace(/[:.]/g, '-')}`;
  const log = createLogger(join(dateDir, 'logs', `${runId}.log`));
  mkdirSync(layout.stateDir, { recursive: true });

  const eventsFile = join(dateDir, 'logs', `${runId}.events.jsonl`);
  const release = acquireLock(layout.lockFile, log, { run_id: runId, events_file: toPosix(eventsFile).slice(toPosix(layout.root).length + 1) });
  if (!release) {
    log.warn('another RepoScout run is in progress; exiting without touching anything', { lock: describeLock(layout.lockFile) });
    return ExitCode.Busy;
  }
  const events = createEventSink(eventsFile);
  // The dashboard asks for a stop by writing this file with the run's id, so a stale request never stops a later run.
  const isCancelled = () => readJsonOrNull<{ run_id?: string }>(layout.cancelFile)?.run_id === runId;
  try {
    return await runLocked({
      repos,
      opts: { ...opts, isCancelled },
      sweep,
      webhooks,
      ctx: { layout, store: openStore(layout, log), date, dateDir, log, events, runId },
    });
  } finally {
    if (isCancelled()) rmSync(layout.cancelFile, { force: true });
    release();
  }
}

async function runLocked({
  repos,
  opts,
  sweep,
  webhooks,
  ctx,
}: {
  repos: RepoConfig[];
  opts: AuditOptions;
  sweep: SweepOptions | null;
  webhooks: WebhookConfig[];
  ctx: RunContext;
}): Promise<ExitCode> {
  const { log, events, runId, dateDir, date } = ctx;
  log.info('run started', { repos: repos.map((r) => r.name), mode: opts.mode ?? 'per-repo default', claude: claudeVersion() });
  events.emit('run_started', {
    run_id: runId,
    repos: repos.map((r) => r.name),
    mode: opts.mode ?? null,
    analyzers: opts.analyzers ?? null,
    prepare_only: opts.prepareOnly,
    pid: process.pid,
    until_covered: !!sweep,
    session_limit: sweep?.sessionLimit ?? null,
  });
  const { store } = ctx;
  const failures = store.failuresFor(date);
  const outcomes: Record<string, RepoOutcome & { seconds?: number }> = {};
  let limitHit: string | null = null;
  let budgetHit: string | null = null;
  let cancelled = false;
  for (const repo of repos) {
    if (!cancelled && opts.isCancelled()) cancelled = true;
    if (cancelled) {
      outcomes[repo.name] = { status: 'cancelled', reason: 'not attempted: run cancelled from the dashboard' };
      events.emit('repo_finished', { repo: repo.name, ...outcomes[repo.name] });
      continue;
    }
    if (limitHit || budgetHit) {
      const why = limitHit ? 'subscription usage limit reached earlier in this run' : `session budget reached earlier in this run (${budgetHit})`;
      const error = `not attempted: ${why}`;
      outcomes[repo.name] = { status: 'deferred', error };
      failures[repo.name] = { error, deferred: true, at: new Date().toISOString() };
      events.emit('repo_finished', { repo: repo.name, ...outcomes[repo.name] });
      continue;
    }
    const started = Date.now();
    if (!sweep) events.emit('repo_started', { repo: repo.name, project: repo.project, branch: repo.branch });
    let outcome: RepoOutcome;
    try {
      outcome = sweep ? await sweepRepo({ repo, opts, sweep, ctx }) : await auditRepo({ repo, opts, ctx });
      if (outcome.status === 'ok' && outcome.stopped === 'budget') budgetHit = outcome.reason ?? 'budget';
      delete failures[repo.name];
    } catch (e) {
      const message = errorMessage(e);
      if (e instanceof CancelledError) {
        cancelled = true;
        outcomes[repo.name] = { status: 'cancelled', reason: message };
        log.warn('run cancelled from the dashboard; state was not updated', { repo: repo.name });
        events.emit('repo_finished', { repo: repo.name, seconds: Math.round((Date.now() - started) / 1000), ...outcomes[repo.name] });
        continue;
      }
      const deferred = e instanceof UsageLimitError;
      outcome = { status: deferred ? 'deferred' : 'failed', error: message };
      failures[repo.name] = { error: message, ...(deferred ? { deferred: true } : {}), at: new Date().toISOString() };
      if (deferred) {
        limitHit = message;
        log.error('subscription usage limit reached; stopping the run, remaining repositories are deferred to the next one', {
          repo: repo.name,
          error: message,
        });
      } else {
        log.error('repo failed; continuing with the next one', { repo: repo.name, error: message });
      }
    }
    outcomes[repo.name] = outcome;
    const seconds = Math.round((Date.now() - started) / 1000);
    log.info('repo timing', { repo: repo.name, seconds });
    events.emit('repo_finished', { repo: repo.name, seconds, ...outcome });
  }
  if (!opts.prepareOnly) {
    store.replaceFailures(date, redactDeep(failures));
    writeSummary(dateDir, date, store.reportsForDate(date), store.failuresFor(date));
    // A notification never changes the run's outcome.
    if (webhooks.length) {
      try {
        await notifyRun({ webhooks, digest: runDigest(ctx, outcomes), log });
      } catch (e) {
        log.warn('webhook notifications failed; the run is unaffected', { error: errorMessage(e) });
      }
    }
  }
  log.info('run finished', { outcomes });
  const failed = Object.values(outcomes).some((o) => o.status === 'failed');
  const exit = cancelled ? ExitCode.Cancelled : limitHit ? ExitCode.UsageLimit : failed ? ExitCode.Failed : budgetHit ? ExitCode.Budget : ExitCode.Ok;
  if (cancelled) events.emit('run_cancelled', { run_id: runId });
  events.emit('run_finished', { run_id: runId, exit, outcomes });
  return exit;
}

// This run's reports (a sweep's passes are <run-id>-p<n>) and the repositories it could not audit.
function runDigest({ store, runId, date }: RunContext, outcomes: Record<string, RepoOutcome>) {
  const reports = store.reportsForDate(date).filter((r) => r.run_id === runId || r.run_id.startsWith(`${runId}-p`));
  const failures = Object.entries(outcomes).flatMap(([repo, o]) =>
    o.status === 'failed' || o.status === 'deferred' ? [{ repo, status: o.status, error: o.error }] : [],
  );
  return digestOf({ runId, date, reports, failures });
}
