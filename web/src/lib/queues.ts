import type { FindingView, Stage } from './types';

// What a finding asks of the auditor, derived from its status and stage. Every finding is in exactly one queue.
export const QUEUES = ['triage', 'report', 'reported', 'closed'] as const;
export type Queue = (typeof QUEUES)[number];
export type QueueView = Queue | 'all';
export const QUEUE_VIEWS: QueueView[] = [...QUEUES, 'all'];

export const QUEUE_LABEL: Record<QueueView, string> = {
  triage: 'Triage',
  report: 'To report',
  reported: 'Reported',
  closed: 'Closed',
  all: 'All',
};

export const QUEUE_HELP: Record<QueueView, string> = {
  triage: 'Waiting for a verdict: speculative candidates, and open findings still at detected. Confirm, refute, suppress or validate them.',
  report: 'Validated open findings: real, and ready to put in front of the people who own the code.',
  reported: 'Open findings already put in front of their owners, waiting for a fix.',
  closed: 'Resolved, suppressed, refuted or duplicate. Nothing is asked of you.',
  all: 'Every finding, whatever its queue.',
};

const OPEN_QUEUE: Record<Stage, Queue> = { detected: 'triage', validated: 'report', reported: 'reported', fixed: 'closed' };

export function queueOf(f: Pick<FindingView, 'status' | 'stage'>): Queue {
  if (f.status === 'speculative') return 'triage';
  if (f.status === 'open') return OPEN_QUEUE[f.stage];
  return 'closed';
}

export const inQueue = (f: Pick<FindingView, 'status' | 'stage'>, view: QueueView) => view === 'all' || queueOf(f) === view;
