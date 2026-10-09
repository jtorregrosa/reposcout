import type { FindingEntry, FindingStatus } from './types.js';

export const STAGES = ['detected', 'validated', 'reported', 'fixed'] as const;
export type Stage = (typeof STAGES)[number];

export type StageSource = 'initial' | 'reproduced' | 'auditor' | 'resolved' | 'reopened' | 'withdrawn' | 'upgrade';

export interface StageState {
  stage: Stage;
  source: StageSource;
  since: string;
}

// One stage change of a finding, as its stage history records it.
export interface StageEvent {
  at: string;
  run_id: string | null;
  from_stage: Stage | null;
  to_stage: Stage;
  source: StageSource;
  note: string | null;
  // Who made the change by hand; null when a run made it.
  actor: string | null;
}

export interface StageChange {
  stage: Stage;
  source: StageSource;
  note: string | null;
}

// Stages before the last move to fixed and before the last auditor confirmation, read from the stage history.
export interface StageLookback {
  beforeFixed?: Stage | null;
  beforeAuditor?: Stage | null;
}

export const stageRank = (s: Stage): number => STAGES.indexOf(s);

export function initialStage(entry: Pick<FindingEntry, 'status' | 'finding'>, confirmedByAuditor: boolean): Stage {
  if (entry.status === 'resolved') return 'fixed';
  if (entry.status === 'open' && (entry.finding.verified || confirmedByAuditor)) return 'validated';
  return 'detected';
}

// The stage change, if any, that writing `entry` over a finding last stored with `previousStatus` makes.
export function nextStage({
  current,
  previousStatus,
  entry,
  confirmedByAuditor,
  lookback = {},
}: {
  current: StageState | undefined;
  previousStatus: FindingStatus | undefined;
  entry: Pick<FindingEntry, 'status' | 'finding' | 'resolution'>;
  confirmedByAuditor: boolean;
  lookback?: StageLookback;
}): StageChange | null {
  if (!current) return { stage: initialStage(entry, confirmedByAuditor), source: 'initial', note: null };

  if (entry.status === 'resolved') {
    if (previousStatus === 'resolved' || current.stage === 'fixed') return null;
    return { stage: 'fixed', source: 'resolved', note: entry.resolution ?? null };
  }

  if (previousStatus === 'resolved' && current.stage === 'fixed' && (entry.status === 'open' || entry.status === 'speculative')) {
    const earlier = lookback.beforeFixed ?? 'detected';
    const reproduced = entry.status === 'open' && entry.finding.verified && stageRank(earlier) < stageRank('validated');
    return { stage: reproduced ? 'validated' : earlier, source: 'reopened', note: null };
  }

  if (entry.status === 'open' && current.stage === 'detected') {
    if (entry.finding.verified) return { stage: 'validated', source: 'reproduced', note: null };
    if (confirmedByAuditor) return { stage: 'validated', source: 'auditor', note: null };
  }
  return null;
}

// The stage change, if any, when an auditor withdraws a confirmation and the candidate returns to speculative.
export function withdrawnStage(current: StageState | undefined, entry: Pick<FindingEntry, 'finding'>, lookback: StageLookback): StageChange | null {
  if (current?.stage !== 'validated' || current.source !== 'auditor' || entry.finding.verified) return null;
  return { stage: lookback.beforeAuditor ?? 'detected', source: 'withdrawn', note: null };
}
