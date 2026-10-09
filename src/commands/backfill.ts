import { resolve } from 'node:path';
import { kindTask } from '../backfill/kind.js';
import { reproTask } from '../backfill/repro.js';
import { runBackfill } from '../backfill/runner.js';
import { loadConfig } from '../config/config.js';
import type { ExitCode } from '../errors.js';
import type { FindingStatus } from '../findings/types.js';
import { layout, ROOT } from '../paths.js';
import { loadEnv } from '../security/env.js';

export interface BackfillFlags {
  config: string;
  repo?: string[];
  status: FindingStatus[];
  batchSize: number;
  limit?: number;
  sessionLimit: number;
  weeklyLimit: number;
  dryRun: boolean;
}

export async function backfillCommand(what: 'repro' | 'kind', flags: BackfillFlags): Promise<ExitCode> {
  loadEnv(ROOT);
  const repos = loadConfig(resolve(ROOT, flags.config)).filter((r) => !flags.repo?.length || flags.repo.includes(r.name));
  if (!repos.length) throw new Error(`no repository in ${flags.config} matches --repo ${flags.repo?.join(', ')}`);
  const opts = {
    layout: layout(),
    repos,
    statuses: flags.status,
    batchSize: flags.batchSize,
    limit: flags.limit ?? null,
    sessionLimit: flags.sessionLimit / 100,
    weeklyLimit: flags.weeklyLimit / 100,
    dryRun: flags.dryRun,
  };
  return what === 'repro' ? runBackfill(reproTask, opts) : runBackfill(kindTask, opts);
}
