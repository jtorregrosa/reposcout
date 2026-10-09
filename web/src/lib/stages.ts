import { STAGES } from './domain';
import type { Stage, StageEvent } from './types';

export interface TimelineStep {
  stage: Stage;
  entered: string | null;
  current: boolean;
}

const rank = (s: Stage) => STAGES.indexOf(s);

// Each step with when it was last entered. Only stages a finding actually entered get a date, apart from detected,
// which every finding starts from; a move back clears the steps above it.
export function stageTimeline(events: StageEvent[], current: Stage): TimelineStep[] {
  const entered = new Map<Stage, string>();
  for (const e of events) {
    if (!entered.has('detected')) entered.set('detected', e.at);
    for (const s of STAGES) if (rank(s) > rank(e.to_stage)) entered.delete(s);
    entered.set(e.to_stage, e.at);
  }
  return STAGES.map((stage) => ({ stage, entered: rank(stage) <= rank(current) ? (entered.get(stage) ?? null) : null, current: stage === current }));
}
