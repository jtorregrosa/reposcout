import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { Logger } from '../telemetry/logger.js';
import type { LockInfo } from './types.js';

const STALE_MS = 12 * 60 * 60 * 1000;

export type { LockInfo };

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

// Two runs (the daily and the weekly task) must never share a clone or write the same state file.
export function acquireLock(path: string, log: Logger, info: Omit<LockInfo, 'pid' | 'started_at'> = {}): (() => void) | null {
  const mine: LockInfo = { pid: process.pid, started_at: new Date().toISOString(), ...info };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(path, JSON.stringify(mine), { flag: 'wx' });
      const release = () => rmSync(path, { force: true });
      process.once('exit', release);
      return release;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    }
    const held = describeLock(path);
    const age = held?.started_at ? Date.now() - Date.parse(held.started_at) : Number.POSITIVE_INFINITY;
    if (held && alive(held.pid) && age < STALE_MS) return null;
    log.warn('removing a stale lock left by a run that is no longer alive', { lock: path, held });
    rmSync(path, { force: true });
  }
  return null;
}

export function describeLock(path: string): LockInfo | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as LockInfo;
  } catch {
    return null;
  }
}

// The lock describes the run in progress; a lock whose process died is reported as no run at all.
export function activeRun(path: string): LockInfo | null {
  const held = describeLock(path);
  if (!held || !alive(held.pid) || Date.now() - Date.parse(held.started_at) >= STALE_MS) return null;
  return held;
}
