import { resolve } from 'node:path';
import { runAudits } from '../audit/run.js';
import type { Analyzer, AuthMode, Mode } from '../config/analyzers.js';
import { loadConfig, loadNotifications } from '../config/config.js';
import type { ExitCode } from '../errors.js';
import { layout, ROOT } from '../paths.js';
import { loadEnv } from '../security/env.js';

export interface RunFlags {
  config: string;
  mode?: Mode;
  repo?: string[];
  maxFiles?: number;
  analyzers?: Analyzer[];
  prepareOnly: boolean;
  auth?: AuthMode;
  untilCovered: boolean;
  sessionLimit?: number;
  weeklyLimit?: number;
  maxPasses?: number;
  sweepSince?: string;
}

const SWEEP_DEFAULTS = { sessionLimit: 90, weeklyLimit: 95, maxPasses: 30 };

export function validateRunFlags(flags: RunFlags): void {
  if (flags.mode === 'validate' && flags.analyzers?.length) throw new Error('a validation pass takes no analyzers; drop --analyzers with --mode validate');
  if (!flags.untilCovered && flags.mode !== 'validate' && (flags.sessionLimit != null || flags.weeklyLimit != null)) {
    throw new Error('--session-limit and --weekly-limit only apply with --until-covered or --mode validate');
  }
  if (!flags.untilCovered && (flags.maxPasses != null || flags.sweepSince != null))
    throw new Error('--max-passes and --sweep-since only apply with --until-covered');
}

export async function runCommand(flags: RunFlags): Promise<ExitCode> {
  loadEnv(ROOT);
  validateRunFlags(flags);
  let mode = flags.mode;
  let sweep = null;
  if (flags.untilCovered) {
    if (mode && mode !== 'full') throw new Error('--until-covered sweeps in full mode; drop --mode or use --mode full');
    mode = 'full';
    sweep = {
      sessionLimit: (flags.sessionLimit ?? SWEEP_DEFAULTS.sessionLimit) / 100,
      weeklyLimit: (flags.weeklyLimit ?? SWEEP_DEFAULTS.weeklyLimit) / 100,
      maxPasses: flags.maxPasses ?? SWEEP_DEFAULTS.maxPasses,
      ...(flags.sweepSince ? { since: flags.sweepSince } : {}),
    };
  }
  const validation =
    mode === 'validate'
      ? { sessionLimit: (flags.sessionLimit ?? SWEEP_DEFAULTS.sessionLimit) / 100, weeklyLimit: (flags.weeklyLimit ?? SWEEP_DEFAULTS.weeklyLimit) / 100 }
      : null;

  const repos = loadConfig(resolve(ROOT, flags.config)).filter((r) => !flags.repo?.length || flags.repo.includes(r.name));
  if (repos.length === 0) throw new Error(`no repository in ${flags.config} matches --repo ${flags.repo?.join(', ')}`);

  return runAudits({
    layout: layout(),
    webhooks: loadNotifications(resolve(ROOT, flags.config)),
    repos,
    opts: { mode, analyzers: flags.analyzers, maxFiles: flags.maxFiles, prepareOnly: flags.prepareOnly, auth: flags.auth },
    sweep,
    validation,
  });
}
