import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SubagentReply } from '../claude/stream.js';
import { ANALYZERS, type Analyzer, isAnalyzer } from '../config/analyzers.js';
import type { Discard, Finding } from '../findings/types.js';
import type { AnalyzerYield, RunUsage } from '../report/types.js';
import { redact, redactDeep } from '../security/secrets.js';

// A subagent's reply as JSON when it is JSON, also inside a fenced block or after a sentence of preamble; null when
// no reading of it parses.
export function parseReply(text: string): unknown {
  const attempts = [text.trim(), /```(?:json)?\s*\n([\s\S]*?)\n\s*```/.exec(text)?.[1]?.trim()];
  for (const [open, close] of [
    ['[', ']'],
    ['{', '}'],
  ] as const) {
    const start = text.indexOf(open);
    const end = text.lastIndexOf(close);
    if (start >= 0 && end > start) attempts.push(text.slice(start, end + 1));
  }
  for (const attempt of attempts) {
    if (!attempt) continue;
    try {
      return JSON.parse(attempt) as unknown;
    } catch {
      // Try the next reading.
    }
  }
  return null;
}

// How many candidates a specialist reply proposes: its array, or the findings of an object that wraps one.
export function candidateCount(parsed: unknown): number | null {
  if (Array.isArray(parsed)) return parsed.length;
  const findings = parsed && typeof parsed === 'object' ? (parsed as { findings?: unknown }).findings : undefined;
  return Array.isArray(findings) ? findings.length : null;
}

export interface CapturedReply {
  agent: string;
  file: string;
  candidates: number | null;
}

// Writes each subagent's final reply to <workDir>/specialists/<agent>-<n>.json, or .txt when it is not JSON, with
// secrets redacted: the record of what each specialist proposed before the verifier filtered it.
export function writeReplies(workDir: string, replies: readonly SubagentReply[]): CapturedReply[] {
  if (!replies.length) return [];
  const dir = join(workDir, 'specialists');
  mkdirSync(dir, { recursive: true });
  const seen = new Map<string, number>();
  return replies.map(({ agent, text }) => {
    const name = agent.replace(/[^a-z0-9-]/gi, '_').slice(0, 40) || 'subagent';
    const n = (seen.get(name) ?? 0) + 1;
    seen.set(name, n);
    const parsed = parseReply(text);
    const file = join(dir, `${name}-${n}.${parsed === null ? 'txt' : 'json'}`);
    writeFileSync(file, parsed === null ? redact(text) : `${JSON.stringify(redactDeep(parsed), null, 2)}\n`);
    return { agent, file, candidates: candidateCount(parsed) };
  });
}

// The analyzers a verdict credits: each named specialist that is an analyzer ("security", "security-2", "the logic
// specialist"), or the category when it names none.
export function creditedAnalyzers(specialists: unknown, category?: unknown): Analyzer[] {
  const names = Array.isArray(specialists) ? specialists.map((s) => String(s).toLowerCase()) : [];
  const credited = new Set<Analyzer>();
  for (const name of names) {
    // No analyzer's name contains another's, so a name matches at most one.
    const match = ANALYZERS.find((a) => name.includes(a));
    if (match) credited.add(match);
  }
  if (!credited.size && isAnalyzer(category)) credited.add(category);
  return [...credited];
}

const totalTokens = (usage: RunUsage): number | null => {
  const models = Object.values(usage.models ?? {});
  const total = models.reduce((s, m) => s + (m.input ?? 0) + (m.output ?? 0), 0);
  return total > 0 ? total : null;
};

// Tokens of one subagent type: what the stream reported, or the result's per-type stats when they carry tokens.
function tokensOf(analyzer: Analyzer, usage: RunUsage): number | null {
  const streamed = usage.subagent_tokens?.[analyzer];
  if (typeof streamed === 'number') return streamed;
  const stat = usage.subagents?.[analyzer];
  if (stat && typeof stat === 'object') {
    const t = (stat as { total_tokens?: unknown; tokens?: unknown }).total_tokens ?? (stat as { tokens?: unknown }).tokens;
    if (typeof t === 'number') return t;
  }
  return null;
}

// One row per analyzer that ran: what its specialists proposed, what came of it, and what it cost.
export function analyzerYield({
  analyzers,
  captured,
  kept,
  speculative,
  discarded,
  usage,
  reported = {},
}: {
  analyzers: readonly Analyzer[];
  captured: readonly CapturedReply[];
  kept: readonly Pick<Finding, 'category' | 'specialists'>[];
  speculative: readonly Pick<Finding, 'category' | 'specialists'>[];
  discarded: readonly Discard[];
  usage: RunUsage;
  // The orchestrator's own count of each specialist type's candidates, from its output's specialist_candidates.
  reported?: Partial<Record<string, unknown>>;
}): AnalyzerYield[] {
  const credits = (list: readonly { specialists?: unknown; category?: unknown }[], a: Analyzer) =>
    list.filter((f) => creditedAnalyzers(f.specialists, f.category).includes(a)).length;
  const total = totalTokens(usage);
  return analyzers.map((analyzer) => {
    const replies = captured.filter((r) => r.agent === analyzer);
    // One unparseable reply makes the count unknown rather than low.
    // Background subagents' replies do not reach the stream, so the orchestrator's count stands in for them.
    const fromReplies = replies.length && replies.every((r) => r.candidates !== null) ? replies.reduce((s, r) => s + (r.candidates ?? 0), 0) : null;
    const counted = reported[analyzer];
    const candidates = fromReplies ?? (typeof counted === 'number' && Number.isInteger(counted) && counted >= 0 ? counted : null);
    const launched = usage.subagents?.[analyzer];
    const tokens = tokensOf(analyzer, usage);
    const share = tokens !== null && total ? Math.min(1, tokens / total) : null;
    return {
      analyzer,
      instances: replies.length || (typeof launched === 'number' ? launched : 0),
      candidates,
      kept: credits(kept, analyzer),
      speculative: credits(speculative, analyzer),
      // A discard names no category: only the specialists the verifier credits count it.
      discarded: discarded.filter((d) => creditedAnalyzers(d.specialists).includes(analyzer)).length,
      tokens,
      cost_usd: share !== null && usage.cost_usd_equivalent != null ? Math.round(share * usage.cost_usd_equivalent * 10_000) / 10_000 : null,
    };
  });
}

// The verifier's discards as the report keeps them: objects only, with the specialists it credits as strings.
export function normalizeDiscards(raw: unknown): Discard[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((d): d is Record<string, unknown> => !!d && typeof d === 'object' && !Array.isArray(d))
    .map(({ specialists, ...rest }) => ({ ...rest, ...(Array.isArray(specialists) ? { specialists: specialists.map(String) } : {}) }) as Discard);
}
