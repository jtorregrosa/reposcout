import { closeSync, openSync, readSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { matchesAny } from './glob.js';

const ALWAYS_EXCLUDED = ['.git/**', '**/.claude/**', 'CLAUDE.local.md', '.mcp.json'];
const SOURCE = /\.(cs|fs|vb|ts|tsx|js|jsx|mjs|cjs|py|go|java|kt|rs|rb|php|swift|c|cc|cpp|h|hpp|sql|ps1|psm1|sh|razor|cshtml|vue|svelte)$/i;
const CONFIG = /(\.(json|ya?ml|tf|bicep|xml|config|props|targets|csproj|toml|ini)|Dockerfile|\.env\.[a-z]+)$/i;
const TEST = /(^|\/)(tests?|__tests__|specs?|e2e)\/|[._-](test|spec|tests)\.[a-z]+$|Tests?\.cs$/i;

export function tier(path: string, focusPaths: readonly string[]): number {
  if (TEST.test(path)) return SOURCE.test(path) ? 3 : 4;
  if (matchesAny(path, focusPaths)) return 0;
  if (SOURCE.test(path)) return 1;
  if (CONFIG.test(path)) return 2;
  return 4;
}

function isBinary(absPath: string): boolean {
  const fd = openSync(absPath, 'r');
  try {
    const buf = Buffer.alloc(8000);
    const n = readSync(fd, buf, 0, buf.length, 0);
    return buf.subarray(0, n).includes(0);
  } finally {
    closeSync(fd);
  }
}

export interface Candidate {
  path: string;
  status: string;
  additions?: number;
  deletions?: number;
}

export interface SelectedFile extends Candidate {
  bytes: number;
  tier: number;
  focus: boolean;
}

export interface Selection {
  selected: SelectedFile[];
  skipped: { path: string; reason: string }[];
  omitted: string[];
  eligibleCount: number;
  eligiblePaths: string[];
}

export interface SelectOptions {
  cloneDir: string;
  candidates: Candidate[];
  excluded: readonly string[];
  focusPaths: readonly string[];
  maxFiles: number;
  maxBytes: number;
  lastAudited?: Record<string, string>;
  order?: 'priority' | 'coverage';
  auditedBefore?: string | null;
}

// Returns the files the auditors will see, plus what was dropped and why, so every cut is logged.
// Two orders. "priority" (incremental): focus paths, source, config, tests, the rest, then most churn.
// "coverage" (full): never audited first, then least recently audited, with priority only as the tie-break.
// Coverage has to lead in full mode: when the focus paths alone fill the cap, priority-first picked the same
// already-audited files on every run and the rest of the repository was never reached.
// auditedBefore (a sweep's start): only files not audited since then are picked, so a sweep never repeats
// itself and ends when the pool is empty.
export function selectFiles({
  cloneDir,
  candidates,
  excluded,
  focusPaths,
  maxFiles,
  maxBytes,
  lastAudited = {},
  order = 'priority',
  auditedBefore = null,
}: SelectOptions): Selection {
  const skipped: Selection['skipped'] = [];
  const eligible: SelectedFile[] = [];
  const exclusions = [...ALWAYS_EXCLUDED, ...excluded];
  for (const c of candidates) {
    if (matchesAny(c.path, exclusions)) {
      skipped.push({ path: c.path, reason: 'excluded' });
      continue;
    }
    let size: number;
    try {
      size = statSync(join(cloneDir, c.path)).size;
    } catch {
      skipped.push({ path: c.path, reason: 'not in working tree' });
      continue;
    }
    if (size > maxBytes) skipped.push({ path: c.path, reason: `larger than ${maxBytes} bytes` });
    else if (size === 0) skipped.push({ path: c.path, reason: 'empty' });
    else if (isBinary(join(cloneDir, c.path))) skipped.push({ path: c.path, reason: 'binary' });
    else eligible.push({ ...c, bytes: size, tier: tier(c.path, focusPaths), focus: matchesAny(c.path, focusPaths) });
  }

  const churn = (f: SelectedFile) => (f.additions ?? 0) + (f.deletions ?? 0);
  const age = (a: SelectedFile, b: SelectedFile) => (lastAudited[a.path] ?? '').localeCompare(lastAudited[b.path] ?? '');
  const priority = (a: SelectedFile, b: SelectedFile) => a.tier - b.tier || churn(b) - churn(a);
  eligible.sort((a, b) => (order === 'coverage' ? age(a, b) || priority(a, b) : priority(a, b) || age(a, b)) || a.path.localeCompare(b.path));
  const pool = auditedBefore ? eligible.filter((f) => (lastAudited[f.path] ?? '') < auditedBefore) : eligible;
  return {
    selected: pool.slice(0, maxFiles),
    skipped,
    omitted: pool.slice(maxFiles).map((f) => f.path),
    eligibleCount: eligible.length,
    eligiblePaths: eligible.map((f) => f.path),
  };
}
