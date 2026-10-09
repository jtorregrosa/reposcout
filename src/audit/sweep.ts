import type { RepoConfig } from '../config/config.js';
import { CancelledError } from '../errors.js';
import type { WindowCost } from '../state/types.js';
import { budgetDecision, latestRateLimit, passCost } from './budget.js';
import type { AuditOptions, RepoOutcome, RunContext, SweepOptions } from './context.js';
import { auditRepo } from './repo.js';

// Chains full passes over one repository until every eligible file has been audited since the sweep began,
// stopping BEFORE a pass whose estimated cost would cross the session or weekly limit. Each pass writes its own
// state, so a sweep that stops early keeps all it covered.
export async function sweepRepo({
  repo,
  opts,
  sweep,
  ctx,
}: {
  repo: RepoConfig;
  opts: AuditOptions;
  sweep: SweepOptions;
  ctx: RunContext;
}): Promise<RepoOutcome> {
  const { log, events } = ctx;
  const sweepStart = sweep.since ?? new Date().toISOString();
  if (sweep.since) log.info('resuming a sweep', { repo: repo.name, since: sweep.since });
  const total = { passes: 0, new: 0, resolved: 0, speculative: 0 };
  let lastCost: WindowCost | null = null;
  let stopped = 'max passes';
  let reason = `reached --max-passes ${sweep.maxPasses}`;
  for (let pass = 1; pass <= sweep.maxPasses; pass++) {
    if (opts.isCancelled()) throw new CancelledError('cancelled from the dashboard between sweep passes');
    const before = latestRateLimit(ctx.store.usage(50));
    const decision = budgetDecision({ rateLimit: before, lastCost, sessionLimit: sweep.sessionLimit, weeklyLimit: sweep.weeklyLimit });
    events.emit('sweep_pass', {
      repo: repo.name,
      pass,
      proceed: decision.proceed,
      reason: decision.reason,
      five_hour: before?.five_hour ?? null,
      seven_day: before?.seven_day ?? null,
    });
    if (!decision.proceed) {
      log.warn('sweep stopped before the next pass to stay within the session budget', {
        repo: repo.name,
        pass,
        reason: decision.reason,
        resume: `--until-covered --sweep-since ${sweepStart}`,
      });
      [stopped, reason] = ['budget', decision.reason];
      break;
    }
    log.info('sweep pass starting', { repo: repo.name, pass, budget: decision.reason });
    events.emit('repo_started', { repo: repo.name, project: repo.project, branch: repo.branch, pass });
    const out = await auditRepo({ repo, opts: { ...opts, mode: 'full', sweepStart }, ctx: { ...ctx, runId: `${ctx.runId}-p${pass}` } });
    if (out.status === 'skipped' && out.complete) {
      [stopped, reason] = ['complete', 'every eligible file was audited since the sweep started'];
      break;
    }
    if (out.status !== 'ok') {
      [stopped, reason] = [out.status, 'reason' in out ? out.reason : out.status];
      break;
    }
    total.passes++;
    total.new += out.new;
    total.resolved += out.resolved;
    total.speculative += out.speculative;
    lastCost = passCost(before, out.rate_limit) ?? lastCost;
    events.emit('sweep_progress', { repo: repo.name, pass, pending: out.pending, cost: lastCost });
    log.info('sweep pass done', { repo: repo.name, pass, pending: out.pending, cost: lastCost });
  }
  log.info('sweep finished', { repo: repo.name, stopped, reason, ...total });
  return { status: 'ok', sweep: true, stopped, reason, ...total };
}
