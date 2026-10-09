import type { Behaviour } from './harness.js';

// A tiny service with two seeded bugs and one clean file, and what the fake claude reports about it.
export const SOURCES: Record<string, string> = {
  'src/auth.ts': ['export function checkToken(token: string, expected: string): boolean {', '  return token == expected;', '}', ''].join('\n'),
  'src/math.ts': [
    'export function average(values: number[]): number {',
    '  let sum = 0;',
    '  for (let i = 0; i <= values.length; i++) sum += values[i];',
    '  return sum / values.length;',
    '}',
    '',
  ].join('\n'),
  'src/util.ts': ['export const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));', ''].join('\n'),
};

export const TOKEN_BUG = {
  file: 'src/auth.ts',
  line: 2,
  snippet: 'return token == expected;',
  category: 'security',
  title: 'Token compared with a timing-unsafe equality',
};
export const LOOP_BUG = {
  file: 'src/math.ts',
  line: 3,
  snippet: 'for (let i = 0; i <= values.length; i++) sum += values[i];',
  category: 'logic',
  title: 'Off-by-one loop reads past the end of the array',
};

export const FINDS_BOTH: Behaviour = { behaviour: 'findings', findings: [TOKEN_BUG, LOOP_BUG] };
