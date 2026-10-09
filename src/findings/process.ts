import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { redact, redactDeep } from '../security/secrets.js';
import type { Logger } from '../telemetry/logger.js';
import { anchorLine, anchorSnippet, fingerprint, locateSnippet } from './fingerprint.js';
import {
  CATEGORIES,
  type Category,
  CONFIDENCES,
  type Confidence,
  type Finding,
  KINDS,
  type Kind,
  type RawFindings,
  type Rejection,
  type Repro,
  SEVERITIES,
  type Severity,
} from './types.js';

const REQUIRED_TEXT = ['title', 'description', 'scenario', 'suggested_fix'] as const;
const MAX_STEPS = 12;
const MAX_PRECONDITIONS = 8;
const MAX_TEXT = 800;

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, MAX_TEXT) : null);
const texts = (v: unknown, max: number): string[] =>
  Array.isArray(v)
    ? v
        .map(text)
        .filter((t): t is string => !!t)
        .slice(0, max)
    : [];

// Reproduction steps are optional and never cost a finding: a malformed block is dropped, the finding is kept.
export function parseRepro(raw: unknown): Repro | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const steps = texts(r.steps, MAX_STEPS);
  if (!steps.length) return null;
  return { preconditions: texts(r.preconditions, MAX_PRECONDITIONS), steps, expected: text(r.expected), actual: text(r.actual) };
}

export const parseKind = (raw: unknown): Kind | null => ((KINDS as readonly unknown[]).includes(raw) ? (raw as Kind) : null);

// Labels are optional like the steps: a missing or unknown one leaves the finding unlabelled, to be set later.
function labels(f: { kind?: unknown; personal_data?: unknown }): Pick<Finding, 'kind' | 'personal_data'> {
  const kind = parseKind(f.kind);
  return { ...(kind ? { kind } : {}), ...(typeof f.personal_data === 'boolean' ? { personal_data: f.personal_data } : {}) };
}

interface ValidCandidate {
  file: string;
  line: number;
  category: Category;
  severity: Severity;
  confidence: Confidence;
  verified: boolean;
  title: string;
  description: string;
  scenario: string;
  suggested_fix: string;
  snippet?: unknown;
  reproduction?: unknown;
  repro?: unknown;
  kind?: unknown;
  personal_data?: unknown;
  specialists?: unknown;
  unconfirmed?: unknown;
}

const includes = <T>(list: readonly T[], value: unknown): value is T => (list as readonly unknown[]).includes(value);

export function validateFinding(f: unknown, { auditedSet }: { auditedSet: Set<string> }): string | null {
  if (!f || typeof f !== 'object') return 'not an object';
  const c = f as Record<string, unknown>;
  if (typeof c.file !== 'string' || !c.file) return 'missing file';
  if (!auditedSet.has(c.file)) return `file "${c.file}" was not in the audited set`;
  if (!Number.isInteger(c.line) || (c.line as number) < 1) return 'missing or invalid line';
  if (!includes(CATEGORIES, c.category)) return `invalid category "${c.category}"`;
  if (!includes(SEVERITIES, c.severity)) return `invalid severity "${c.severity}"`;
  if (!includes(CONFIDENCES, c.confidence)) return `invalid confidence "${c.confidence}"`;
  if (typeof c.verified !== 'boolean') return 'verified must be boolean';
  for (const k of REQUIRED_TEXT) {
    const v = c[k];
    if (typeof v !== 'string' || v.trim().length < 10) return `missing evidence field "${k}"`;
  }
  return null;
}

interface ListInput {
  list: unknown[] | undefined;
  kind: Rejection['kind'];
  repoName: string;
  commit: string;
  cloneDir: string;
  auditedSet: Set<string>;
  log: Logger;
}

export const QUOTE_NOT_FOUND = 'the quoted code was not found in the file';

const sameTitle = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

// Two findings that anchor to the same line in the same category share a fingerprint, and only the first is kept.
// The same title is the same finding reported twice; a different one may be a second bug that was lost.
function warnCollision(log: Logger, kept: Finding, dropped: { title: string; line: number }, fp: string) {
  if (sameTitle(kept.title, dropped.title)) return;
  log.warn('two distinct findings got the same fingerprint; only the first is kept', {
    fingerprint: fp,
    file: kept.file,
    kept: { title: kept.title, line: kept.line },
    dropped: { title: redact(dropped.title), line: dropped.line },
  });
}

function processList({ list, kind, repoName, commit, cloneDir, auditedSet, log }: ListInput) {
  const accepted: Finding[] = [];
  // Confirmed findings whose quote is nowhere in the file: kept as speculative, for a human to look at.
  const demoted: Finding[] = [];
  const rejected: Rejection[] = [];
  for (const raw of list ?? []) {
    // A speculative candidate is unconfirmed by definition; it never claims a reproduction.
    const candidate =
      kind === 'speculative' && raw && typeof raw === 'object'
        ? { ...raw, verified: false, confidence: (raw as { confidence?: unknown }).confidence ?? 'low' }
        : raw;
    const problem = validateFinding(candidate, { auditedSet });
    const loose = candidate as { title?: unknown; file?: unknown } | null;
    if (problem) {
      rejected.push({ kind, title: redact(String(loose?.title ?? '(untitled)')), file: loose?.file, reason: problem });
      continue;
    }
    const f = candidate as ValidCandidate;
    const text = readFileSync(join(cloneDir, f.file), 'utf8');
    const lineCount = text.split(/\r?\n/).length;
    if (f.line > lineCount) {
      rejected.push({ kind, title: redact(f.title), file: f.file, reason: `line ${f.line} beyond end of file (${lineCount})` });
      continue;
    }
    // The line must agree with the code the model quotes: a quote a few lines off moves the line to it, and a quote
    // that is nowhere in the file means the model described code that does not exist.
    const located = locateSnippet(text, f.line, f.snippet);
    const line = located.line;
    if (line !== f.line) log.info('finding re-anchored to the line it quotes', { file: f.file, title: f.title, reported: f.line, line });
    const absent = located.quote === 'absent';
    if (absent) log.warn('quoted code not found in the file; kept as speculative', { kind, file: f.file, line, title: f.title });
    const fp = fingerprint({ repo: repoName, file: f.file, category: f.category, snippet: anchorLine(text, line) });
    const repro = parseRepro(f.repro);
    if (f.repro != null && !repro) log.warn('reproduction steps dropped: not in the expected shape', { file: f.file, title: f.title });
    const kept = [...accepted, ...demoted].find((a) => a.fingerprint === fp);
    if (kept) {
      warnCollision(log, kept, { title: f.title, line }, fp);
      continue;
    }
    const ownUnconfirmed = kind === 'speculative' && f.unconfirmed ? String(f.unconfirmed) : null;
    const unconfirmed = absent ? (ownUnconfirmed ? `${ownUnconfirmed} Also, ${QUOTE_NOT_FOUND}.` : QUOTE_NOT_FOUND) : ownUnconfirmed;
    const finding = redactDeep<Finding>({
      fingerprint: fp,
      repo: repoName,
      commit,
      file: f.file,
      line,
      category: f.category,
      severity: f.severity,
      title: f.title.trim(),
      description: f.description.trim(),
      scenario: f.scenario.trim(),
      suggested_fix: f.suggested_fix.trim(),
      confidence: f.confidence,
      verified: absent ? false : f.verified,
      // A quote far from the line would show code the finding is not about; the line's own text is shown instead.
      snippet: located.quote === 'near' || located.quote === 'unchecked' ? anchorSnippet(text, line, f.snippet) : anchorLine(text, line),
      ...(f.reproduction ? { reproduction: String(f.reproduction) } : {}),
      ...(repro ? { repro } : {}),
      ...labels(f),
      ...(Array.isArray(f.specialists) ? { specialists: f.specialists.map(String) } : {}),
      ...(unconfirmed ? { unconfirmed } : {}),
    });
    (absent && kind === 'finding' ? demoted : accepted).push(finding);
  }
  return { accepted, demoted, rejected };
}

export interface ProcessedFindings {
  accepted: Finding[];
  speculative: Finding[];
  rejected: Rejection[];
}

export function processFindings({
  raw,
  repoName,
  commit,
  cloneDir,
  auditedFiles,
  log,
}: {
  raw: Pick<RawFindings, 'findings' | 'speculative'>;
  repoName: string;
  commit: string;
  cloneDir: string;
  auditedFiles: string[];
  log: Logger;
}): ProcessedFindings {
  const auditedSet = new Set(auditedFiles);
  const confirmed = processList({ list: raw.findings, kind: 'finding', repoName, commit, cloneDir, auditedSet, log });
  const speculative = processList({ list: raw.speculative, kind: 'speculative', repoName, commit, cloneDir, auditedSet, log });
  const confirmedByFp = new Map(confirmed.accepted.map((f) => [f.fingerprint, f]));
  const rejected = [...confirmed.rejected, ...speculative.rejected];
  for (const r of rejected) log.warn('candidate rejected by validation', { ...r });
  // A demoted finding comes first: the verifier meant it as a finding, so it wins over a candidate on the same line.
  const candidates: Finding[] = [];
  for (const s of [...confirmed.demoted, ...speculative.accepted]) {
    const kept = confirmedByFp.get(s.fingerprint) ?? candidates.find((c) => c.fingerprint === s.fingerprint);
    if (kept) warnCollision(log, kept, s, s.fingerprint);
    else candidates.push(s);
  }
  return { accepted: confirmed.accepted, speculative: candidates, rejected };
}
