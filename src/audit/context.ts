import type { Analyzer, AuthMode, Mode } from '../config/analyzers.js';
import type { Layout } from '../paths.js';
import type { RateLimit } from '../state/types.js';
import type { Store } from '../store/index.js';
import type { EventSink } from '../telemetry/events.js';
import type { Logger } from '../telemetry/logger.js';

export interface RunContext {
  layout: Layout;
  store: Store;
  date: string;
  dateDir: string;
  log: Logger;
  events: EventSink;
  runId: string;
}

export interface AuditOptions {
  mode?: Mode;
  analyzers?: Analyzer[];
  maxFiles?: number;
  prepareOnly: boolean;
  auth?: AuthMode;
  isCancelled: () => boolean;
  // Set by a sweep: only files not audited since this moment are picked.
  sweepStart?: string;
}

export interface SweepOptions {
  sessionLimit: number;
  weeklyLimit: number;
  maxPasses: number;
  // Resume an earlier sweep: count the audits made since this instant instead of since now.
  since?: string;
}

export interface ValidationOptions {
  sessionLimit: number;
  weeklyLimit: number;
}

export type RepoOutcome =
  | { status: 'skipped'; reason: string; complete?: boolean }
  | { status: 'prepared'; manifest: string }
  | {
      status: 'ok';
      new: number;
      resolved: number;
      confirmed?: number;
      speculative: number;
      refuted?: number;
      tried?: number;
      reproduced?: number;
      not_reproduced?: number;
      not_testable?: number;
      unreviewed?: number;
      files_read?: number;
      files_selected?: number;
      pending?: number;
      rate_limit?: RateLimit | null;
      sweep?: true;
      stopped?: string;
      reason?: string;
      passes?: number;
    }
  | { status: 'failed' | 'deferred'; error: string }
  | { status: 'cancelled'; reason: string };
