// SARIF 2.1.0 from findings, for GitHub code scanning, Azure DevOps and any SARIF viewer. Pure: no Node module,
// so the dashboard builds its export with this same code. Every text taken from a finding is redacted again here,
// since a log may leave the machine.
import { ANALYZERS } from '../config/analyzers.js';
import type { Category, Finding, FindingStatus, Severity } from '../findings/types.js';
import { redact } from '../security/secrets.js';

export const SARIF_SCHEMA = 'https://json.schemastore.org/sarif-2.1.0.json';
// Keyed by fingerprint version, so a consumer never matches results across an algorithm change. Must follow
// FINGERPRINT_VERSION in src/findings/fingerprint.ts, which this module cannot import (it uses node:crypto).
export const SARIF_FINGERPRINT_KEY = 'reposcout/v2';

export type SarifLevel = 'error' | 'warning' | 'note';

export const SARIF_LEVEL: Record<Severity, SarifLevel> = { critical: 'error', high: 'error', medium: 'warning', low: 'note' };

// GitHub's convention: over 9.0 is critical, 7.0 to 8.9 high, 4.0 to 6.9 medium, below that low.
export const SECURITY_SEVERITY: Record<Severity, string> = { critical: '9.5', high: '8.0', medium: '5.5', low: '3.0' };

const RULES: Record<Category, { name: string; text: string; tags: string[] }> = {
  security: {
    name: 'Security',
    text: 'Flaws an attacker or a malformed input can trigger: injection, broken authentication or authorization, secrets, crypto misuse, data exposure.',
    tags: ['security'],
  },
  concurrency: {
    name: 'Concurrency',
    text: 'Races, deadlocks and async misuse that a real interleaving or load pattern triggers.',
    tags: ['reliability', 'concurrency'],
  },
  'error-handling': {
    name: 'ErrorHandling',
    text: 'Failures turned into wrong results, leaks, hangs or silent loss: swallowed exceptions, unchecked results, missing rollback.',
    tags: ['reliability', 'error-handling'],
  },
  logic: { name: 'Logic', text: 'Code that computes or decides something other than what it evidently intends.', tags: ['correctness', 'logic'] },
  performance: {
    name: 'Performance',
    text: 'Costs that grow with data or traffic: N+1 queries, unbounded reads, blocking async calls.',
    tags: ['performance'],
  },
};

export const ruleId = (category: Category) => `reposcout/${category}`;

export type SarifFinding = Pick<Finding, 'fingerprint' | 'file' | 'line' | 'category' | 'severity' | 'title' | 'scenario' | 'confidence'> &
  Partial<Pick<Finding, 'snippet' | 'kind' | 'personal_data'>> & {
    // A report's new/existing, or the state's status.
    status?: FindingStatus | 'new' | 'existing';
    suppressed_reason?: string | null;
  };

export interface SarifRepo {
  name: string;
  findings: SarifFinding[];
  repositoryUri?: string | null;
  branch?: string | null;
  commit?: string | null;
}

// A finding's path relative to the repository root as a URI reference: forward slashes, no leading "./" or "/",
// and each segment percent-encoded so a space, "#" or "?" in a file name cannot change what it points at.
export function artifactUri(file: string): string {
  return file
    .replace(/\\/g, '/')
    .replace(/^(\.\/)+/, '')
    .replace(/^\/+/, '')
    .split('/')
    .map(encodeURIComponent)
    .join('/');
}

function result(f: SarifFinding) {
  const vulnerability = f.kind === 'vulnerability';
  const status = f.status === 'new' || f.status === 'existing' ? 'open' : (f.status ?? 'open');
  const tags = [
    ...new Set([
      f.category,
      f.severity,
      ...(f.kind ? [f.kind] : []),
      ...(vulnerability ? ['security'] : []),
      ...(f.personal_data ? ['personal-data'] : []),
      ...(status === 'speculative' ? ['speculative'] : []),
    ]),
  ];
  const snippet = f.snippet ? redact(f.snippet) : '';
  return {
    ruleId: ruleId(f.category),
    ruleIndex: ANALYZERS.indexOf(f.category),
    level: SARIF_LEVEL[f.severity],
    message: { text: redact([f.title, f.scenario].filter(Boolean).join('\n\n')) },
    locations: [
      {
        physicalLocation: {
          artifactLocation: { uri: artifactUri(f.file) },
          region: { startLine: Math.max(1, Math.trunc(f.line) || 1), ...(snippet ? { snippet: { text: snippet } } : {}) },
        },
      },
    ],
    partialFingerprints: { [SARIF_FINGERPRINT_KEY]: f.fingerprint },
    ...(f.status === 'new' ? { baselineState: 'new' } : f.status === 'existing' ? { baselineState: 'unchanged' } : {}),
    ...(status === 'suppressed'
      ? { suppressions: [{ kind: 'external', status: 'accepted', ...(f.suppressed_reason ? { justification: redact(f.suppressed_reason) } : {}) }] }
      : {}),
    properties: {
      severity: f.severity,
      confidence: f.confidence,
      kind: f.kind ?? null,
      personal_data: f.personal_data ?? null,
      category: f.category,
      status,
      ...(vulnerability ? { 'security-severity': SECURITY_SEVERITY[f.severity] } : {}),
      tags,
    },
  };
}

function run(repo: SarifRepo, version: string) {
  const provenance = repo.repositoryUri
    ? [{ repositoryUri: repo.repositoryUri, ...(repo.commit ? { revisionId: repo.commit } : {}), ...(repo.branch ? { branch: repo.branch } : {}) }]
    : [];
  return {
    tool: {
      driver: {
        name: 'RepoScout',
        version,
        semanticVersion: version,
        rules: ANALYZERS.map((category) => ({
          id: ruleId(category),
          name: RULES[category].name,
          shortDescription: { text: `${RULES[category].name} defects found by RepoScout` },
          fullDescription: { text: RULES[category].text },
          defaultConfiguration: { level: 'warning' },
          properties: { tags: RULES[category].tags },
        })),
      },
    },
    // Distinct per repository, so the runs of one log never collide as one analysis category.
    automationDetails: { id: `reposcout/${repo.name}/` },
    ...(provenance.length ? { versionControlProvenance: provenance } : {}),
    results: [...repo.findings].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line).map(result),
    properties: { repository: repo.name, ...(repo.branch ? { branch: repo.branch } : {}), ...(repo.commit ? { commit: repo.commit } : {}) },
  };
}

// One run per repository, in the order given.
export function buildSarif(repos: SarifRepo[], { version }: { version: string }) {
  return { $schema: SARIF_SCHEMA, version: '2.1.0' as const, runs: repos.map((r) => run(r, version)) };
}

export type SarifLog = ReturnType<typeof buildSarif>;
