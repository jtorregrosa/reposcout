import { InvalidArgumentError } from 'commander';
import { type Analyzer, AUTH_MODES, type AuthMode, checkMaxFiles, isMode, MODES, type Mode, parseAnalyzers } from '../config/analyzers.js';

// Commander argument parsers: each turns a raw flag into a typed value or a usage error naming the flag.
const asUsageError = <T>(fn: () => T): T => {
  try {
    return fn();
  } catch (e) {
    throw new InvalidArgumentError((e as Error).message);
  }
};

export const parseMode = (value: string): Mode => {
  if (!isMode(value)) throw new InvalidArgumentError(`must be ${MODES.join(', ')}`);
  return value;
};

export const parseAuth = (value: string): AuthMode => {
  if (!(AUTH_MODES as readonly string[]).includes(value)) throw new InvalidArgumentError(`must be ${AUTH_MODES.join(' or ')}`);
  return value as AuthMode;
};

export const parseMaxFiles = (value: string): number => asUsageError(() => checkMaxFiles(value, '--max-files'));

export const parseAnalyzerList = (value: string): Analyzer[] => asUsageError(() => parseAnalyzers(value, '--analyzers'));

export const parsePercent = (value: string): number => {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 10 || n > 99) throw new InvalidArgumentError('must be a whole percentage from 10 to 99');
  return n;
};

export const parseMaxPasses = (value: string): number => {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 100) throw new InvalidArgumentError('must be an integer from 1 to 100');
  return n;
};

// A sweep resumed with --sweep-since counts the audits made since that instant, so the files an earlier sweep
// already covered are not audited again.
export const parseSweepSince = (value: string, now = Date.now()): string => {
  const at = Date.parse(value);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(value) || Number.isNaN(at)) throw new InvalidArgumentError('must be an ISO date and time, such as 2026-10-09T07:00:07Z');
  if (at > now) throw new InvalidArgumentError('cannot be in the future');
  return new Date(at).toISOString();
};

export const parsePort = (value: string): number => {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 65535) throw new InvalidArgumentError('must be a number between 0 and 65535');
  return n;
};

export const collect = (value: string, previous: string[] = []): string[] => [...previous, value];
