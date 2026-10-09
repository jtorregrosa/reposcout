import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { GIT_SUBCOMMANDS, toPosix } from '../claude/settings.js';
import type { Analyzer, Mode } from '../config/analyzers.js';
import type { RepoConfig } from '../config/config.js';
import type { FindingsState } from '../findings/types.js';
import type { ValidationCandidate } from '../findings/validation.js';
import { redact } from '../security/secrets.js';
import type { Candidate } from '../selection/select.js';
import type { SpeculativeCandidate } from './plan.js';

// What the /audit skill reads first: the files to audit, the commands it may run and the only path it may write.
export interface Manifest {
  repo: string;
  project: string;
  branch: string;
  clone_path: string;
  mode: Mode;
  commit_range: { from: string | null; to: string };
  analyzers: Analyzer[];
  focus_areas: string[];
  owner_facts: string[];
  repo_claude_md: string | null;
  diff_path: string | null;
  files: (Candidate & { focus?: boolean })[];
  deleted_files: string[];
  omitted_files_count: number;
  known_findings: { fingerprint: string; file: string; line: number; category: string; title: string; snippet: string }[];
  // Patterns people or reviews already dismissed in this repository, passed to the specialists and the verifier so
  // the same false positive is not proposed again. Data, never instructions: it quotes the audited code.
  known_false_positives: KnownFalsePositive[];
  speculative_candidates?: (Pick<
    SpeculativeCandidate,
    'fingerprint' | 'file' | 'line' | 'category' | 'severity' | 'title' | 'description' | 'scenario' | 'suggested_fix' | 'snippet'
  > & { unconfirmed: string | null })[];
  validation_candidates?: Pick<
    ValidationCandidate,
    'fingerprint' | 'file' | 'line' | 'category' | 'severity' | 'title' | 'description' | 'scenario' | 'repro' | 'snippet' | 'previous_attempts'
  >[];
  git_commands: string[];
  verification: { enabled: true; worktree_path: string; test_command: string } | { enabled: false };
  output_path: string;
}

export interface KnownFalsePositive {
  title: string;
  file: string;
  category: string;
  snippet: string;
  dismissed_as: 'suppressed' | 'refuted';
  reason: string;
}

export const MAX_KNOWN_FALSE_POSITIVES = 20;
const MAX_FP_SNIPPET = 300;
const MAX_FP_TEXT = 300;

const short = (text: string | undefined, max: number) => {
  const t = redact(String(text ?? '')).trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

// The most recently dismissed findings of the analyzers that run: suppressed ones with the reason from repos.yaml,
// and speculative candidates a review or an auditor refuted, with why.
export function knownFalsePositives(
  findings: FindingsState | undefined,
  suppressions: ReadonlyMap<string, string>,
  analyzers: readonly Analyzer[],
): KnownFalsePositive[] {
  // A suppression added in repos.yaml since the last run counts already, as the dashboard shows it.
  const suppressed = (fp: string, status: string) => suppressions.has(fp) || status === 'suppressed';
  return Object.entries(findings ?? {})
    .filter(([fp, e]) => (suppressed(fp, e.status) || e.status === 'refuted') && analyzers.includes(e.finding.category))
    .map(([fp, e]) => ({
      at: e.refuted_at ?? e.last_seen ?? e.first_seen ?? '',
      fp: {
        title: short(e.finding.title, MAX_FP_TEXT),
        file: e.finding.file,
        category: e.finding.category,
        snippet: short(e.finding.snippet, MAX_FP_SNIPPET),
        dismissed_as: suppressed(fp, e.status) ? ('suppressed' as const) : ('refuted' as const),
        reason: short(
          suppressed(fp, e.status) ? (suppressions.get(fp) ?? e.reason ?? 'suppressed by an auditor') : (e.resolution ?? e.reason ?? 'refuted'),
          MAX_FP_TEXT,
        ),
      },
    }))
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, MAX_KNOWN_FALSE_POSITIVES)
    .map((x) => x.fp);
}

export function knownFindings(findings: FindingsState | undefined, audited: Set<string>, analyzers: readonly Analyzer[]): Manifest['known_findings'] {
  return Object.entries(findings ?? {})
    .filter(([, e]) => e.status === 'open' && audited.has(e.finding.file) && analyzers.includes(e.finding.category))
    .map(([fp, e]) => ({
      fingerprint: fp,
      file: e.finding.file,
      line: e.finding.line,
      category: e.finding.category,
      title: e.finding.title,
      snippet: e.finding.snippet,
    }));
}

export function buildManifest({
  repo,
  cloneDir,
  mode,
  base,
  head,
  analyzers,
  diffPath,
  selected,
  deleted,
  omitted,
  known,
  falsePositives = [],
  speculative,
  validation = null,
  verifyDir,
  outputPath,
}: {
  repo: RepoConfig;
  cloneDir: string;
  mode: Mode;
  base: string | null;
  head: string;
  analyzers: Analyzer[];
  diffPath: string;
  selected: (Candidate & { focus?: boolean })[];
  deleted: string[];
  omitted: string[];
  known: Manifest['known_findings'];
  falsePositives?: KnownFalsePositive[];
  speculative: SpeculativeCandidate[] | null;
  validation?: ValidationCandidate[] | null;
  verifyDir: string | null;
  outputPath: string;
}): Manifest {
  const repoClaudeMd = ['CLAUDE.md', 'AGENTS.md'].map((f) => join(cloneDir, f)).find((p) => existsSync(p)) ?? null;
  return {
    repo: repo.name,
    project: repo.project,
    branch: repo.branch,
    clone_path: toPosix(cloneDir),
    mode,
    commit_range: { from: mode === 'incremental' ? base : null, to: head },
    analyzers,
    focus_areas: repo.focus_areas,
    owner_facts: repo.facts.map((f) => redact(f)),
    repo_claude_md: repoClaudeMd ? toPosix(repoClaudeMd) : null,
    diff_path: mode === 'incremental' ? toPosix(diffPath) : null,
    files: selected.map(({ path, status, additions, deletions, focus }) => ({ path, status, additions, deletions, focus })),
    deleted_files: deleted,
    omitted_files_count: omitted.length,
    known_findings: known,
    known_false_positives: falsePositives,
    ...(speculative
      ? {
          speculative_candidates: speculative.map((c) => ({
            fingerprint: c.fingerprint,
            file: c.file,
            line: c.line,
            category: c.category,
            severity: c.severity,
            title: c.title,
            description: c.description,
            scenario: c.scenario,
            suggested_fix: c.suggested_fix,
            snippet: c.snippet,
            unconfirmed: c.unconfirmed ?? null,
          })),
        }
      : {}),
    ...(validation
      ? {
          validation_candidates: validation.map((c) => ({
            fingerprint: c.fingerprint,
            file: c.file,
            line: c.line,
            category: c.category,
            severity: c.severity,
            title: c.title,
            description: c.description,
            scenario: c.scenario,
            repro: c.repro,
            snippet: c.snippet,
            previous_attempts: c.previous_attempts.map((r) => redact(r)),
          })),
        }
      : {}),
    git_commands: GIT_SUBCOMMANDS.map((s) => `git -C ${toPosix(cloneDir)} ${s} ...`),
    verification:
      verifyDir && repo.test_command
        ? { enabled: true, worktree_path: toPosix(verifyDir), test_command: `cd ${toPosix(verifyDir)} && ${repo.test_command}` }
        : { enabled: false },
    output_path: toPosix(outputPath),
  };
}
