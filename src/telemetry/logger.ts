import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { redact } from '../security/secrets.js';

export type LogFields = Record<string, unknown>;

export interface Logger {
  readonly filePath: string | null;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
}

type Level = 'INFO' | 'WARN' | 'ERROR';

export function createLogger(filePath: string): Logger {
  mkdirSync(dirname(filePath), { recursive: true });
  const write = (level: Level, message: string, fields?: LogFields) => {
    const suffix = fields ? ` ${JSON.stringify(fields)}` : '';
    const line = redact(`${new Date().toISOString()} ${level.padEnd(5)} ${message}${suffix}`);
    appendFileSync(filePath, `${line}\n`);
    (level === 'INFO' ? console.log : console.error)(line);
  };
  return {
    filePath,
    info: (m, f) => write('INFO', m, f),
    warn: (m, f) => write('WARN', m, f),
    error: (m, f) => write('ERROR', m, f),
  };
}

export const silentLogger: Logger = { filePath: null, info() {}, warn() {}, error() {} };
