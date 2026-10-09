import type { RateLimit, WindowCost } from '../state/types.js';

// What one more full pass is assumed to cost before any pass of this sweep has been measured: above the
// 4-7% of the 5-hour window and ~1.5% of the weekly one measured for 120-file passes, so a guess errs safe.
export const DEFAULT_PASS_COST: WindowCost = { five_hour: 0.08, seven_day: 0.02 };

// The most recent subscription usage Claude reported whose window has not reset yet; older readings say
// nothing about the window now open. Rows are oldest first.
export function latestRateLimit(rows: readonly { rate_limit?: RateLimit | null }[], now = Date.now()): RateLimit | null {
  for (let i = rows.length - 1; i >= 0; i--) {
    const rl = rows[i]?.rate_limit;
    if (!rl || rl.five_hour == null) continue;
    if (rl.resets_at && rl.resets_at * 1000 <= now) return null;
    return rl;
  }
  return null;
}

// The cost of the pass that just ran, as the change in each window. A window that reset in between gives no
// usable difference, so that reading is skipped and the previous estimate stands.
export function passCost(before: RateLimit | null | undefined, after: RateLimit | null | undefined): WindowCost | null {
  if (!before || !after || before.resets_at !== after.resets_at) return null;
  return {
    five_hour: Math.max(0, (after.five_hour ?? 0) - (before.five_hour ?? 0)),
    seven_day: Math.max(0, (after.seven_day ?? 0) - (before.seven_day ?? 0)),
  };
}

export interface BudgetDecision {
  proceed: boolean;
  reason: string;
}

// Stops BEFORE a pass that would cross a limit, never in the middle of one: a pass is all-or-nothing, and one
// cut short by the subscription limit throws its whole work away.
export function budgetDecision({
  rateLimit,
  lastCost,
  sessionLimit = 0.9,
  weeklyLimit = 0.95,
}: {
  rateLimit: RateLimit | null;
  lastCost: WindowCost | null;
  sessionLimit?: number;
  weeklyLimit?: number;
}): BudgetDecision {
  if (!rateLimit) return { proceed: true, reason: 'usage not known yet; the first pass measures it' };
  if (rateLimit.status && !String(rateLimit.status).startsWith('allowed')) return { proceed: false, reason: `subscription status is ${rateLimit.status}` };
  const cost = {
    five_hour: Math.max(lastCost?.five_hour ?? 0, lastCost ? 0 : DEFAULT_PASS_COST.five_hour),
    seven_day: Math.max(lastCost?.seven_day ?? 0, lastCost ? 0 : DEFAULT_PASS_COST.seven_day),
  };
  const next5 = (rateLimit.five_hour ?? 0) + cost.five_hour;
  const next7 = (rateLimit.seven_day ?? 0) + cost.seven_day;
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  if (next5 > sessionLimit) {
    return {
      proceed: false,
      reason: `5-hour window at ${pct(rateLimit.five_hour ?? 0)}; another pass (~${pct(cost.five_hour)}) would pass the ${pct(sessionLimit)} limit`,
    };
  }
  if (next7 > weeklyLimit) {
    return {
      proceed: false,
      reason: `weekly window at ${pct(rateLimit.seven_day ?? 0)}; another pass (~${pct(cost.seven_day)}) would pass the ${pct(weeklyLimit)} limit`,
    };
  }
  return { proceed: true, reason: `5-hour window ${pct(rateLimit.five_hour ?? 0)} → ~${pct(next5)} after the next pass` };
}
