import type { FindingView } from './types';

export interface AvailableActions {
  confirm: boolean;
  refute: boolean;
  suppress: boolean;
  unsuppress: boolean;
}

type Decidable = Pick<FindingView, 'status' | 'stage' | 'decision'>;

// The one place that mirrors the server's decide and suppress rules: the Next step bar, the shortcuts, the Not a
// bug dialog and the bulk bar all read it, so none of them offers what another hides.
export function availableActions(f: Decidable): AvailableActions {
  const undecided = !f.decision;
  return {
    confirm: undecided && (f.status === 'speculative' || (f.status === 'open' && f.stage === 'detected')),
    refute: undecided && (f.status === 'speculative' || f.status === 'open'),
    suppress: f.status === 'open',
    unsuppress: f.status === 'suppressed',
  };
}

// What every finding of a selection allows.
export function commonActions(findings: Decidable[]): AvailableActions {
  const all = findings.map(availableActions);
  const every = (key: keyof AvailableActions) => all.length > 0 && all.every((a) => a[key]);
  return { confirm: every('confirm'), refute: every('refute'), suppress: every('suppress'), unsuppress: every('unsuppress') };
}

export const REASON_MIN = 3;
export const REASON_MAX = 300;

export const validReason = (reason: string) => {
  const n = reason.trim().length;
  return n >= REASON_MIN && n <= REASON_MAX;
};
