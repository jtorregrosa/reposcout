import type { Finding, FindingEntry, FindingsState } from '../src/findings/types.js';

// Fixtures name only the fields a test is about; these widen them to the types the code under test takes.
export const asFinding = (f: object): Finding => f as Finding;
export const asEntry = (e: object): FindingEntry => e as FindingEntry;
export const state = (findings: Record<string, object>): { findings: FindingsState } => ({ findings: findings as FindingsState });
