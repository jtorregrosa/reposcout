import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { redactDeep } from '../security/secrets.js';

export type Emit = (type: string, data?: Record<string, unknown>) => void;

export interface EventSink {
  readonly filePath: string | null;
  emit: Emit;
}

// The UI tails this file, so a run started by Task Scheduler is as observable as one started by hand.
export function createEventSink(filePath: string): EventSink {
  mkdirSync(dirname(filePath), { recursive: true });
  return {
    filePath,
    emit(type, data = {}) {
      const event = redactDeep({ ts: new Date().toISOString(), ...data, type });
      appendFileSync(filePath, `${JSON.stringify(event)}\n`);
    },
  };
}

export const nullSink: EventSink = { filePath: null, emit() {} };
