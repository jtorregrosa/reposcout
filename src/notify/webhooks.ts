// The end of a run, announced to Teams, Slack or any HTTP endpoint. A message carries what someone needs to decide
// whether to open the dashboard: per repository, the new findings at or above the webhook's threshold (severity,
// type, title, location, fingerprint) and the repositories that failed. Never code, never descriptions: the channel
// is wider than the people who may read the findings. Sending can never fail the run or change its exit code.
import type { WebhookConfig } from '../config/config.js';
import { errorMessage } from '../errors.js';
import { type Category, type Kind, SEVERITY_RANK, type Severity } from '../findings/types.js';
import type { RepoReport } from '../report/types.js';
import { redact, registerSecret } from '../security/secrets.js';
import type { Logger } from '../telemetry/logger.js';

export interface DigestFinding {
  repo: string;
  severity: Severity;
  kind: Kind | null;
  category: Category;
  title: string;
  file: string;
  line: number;
  fingerprint: string;
}

export interface DigestRepo {
  repo: string;
  branch: string;
  commit: string;
  findings: DigestFinding[];
}

export interface DigestFailure {
  repo: string;
  status: 'failed' | 'deferred';
  error: string;
}

export interface RunDigest {
  runId: string;
  date: string;
  repos: DigestRepo[];
  failures: DigestFailure[];
}

const TIMEOUT_MS = 10_000;
// Teams cards and Slack messages have size limits; the rest is in the summary and the dashboard.
const MAX_LISTED = 25;
const MAX_TITLE = 200;
const MAX_ERROR = 300;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const oneLine = (s: unknown) =>
  String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim();
const clean = (s: unknown, n: number) => clip(redact(oneLine(s)), n);

// What one run produced: its reports (a sweep has one per pass) and the repositories that failed or were deferred.
export function digestOf({
  runId,
  date,
  reports,
  failures,
}: {
  runId: string;
  date: string;
  reports: RepoReport[];
  failures: { repo: string; status: 'failed' | 'deferred'; error: string }[];
}): RunDigest {
  const repos = new Map<string, DigestRepo>();
  for (const r of reports) {
    const entry = repos.get(r.repo) ?? { repo: r.repo, branch: r.branch, commit: r.commit, findings: [] };
    entry.commit = r.commit;
    const seen = new Set(entry.findings.map((f) => f.fingerprint));
    for (const f of r.findings) {
      if (f.status !== 'new' || seen.has(f.fingerprint)) continue;
      seen.add(f.fingerprint);
      entry.findings.push({
        repo: r.repo,
        severity: f.severity,
        kind: f.kind ?? null,
        category: f.category,
        title: clean(f.title, MAX_TITLE),
        file: oneLine(f.file),
        line: f.line,
        fingerprint: f.fingerprint,
      });
    }
    repos.set(r.repo, entry);
  }
  return {
    runId,
    date,
    repos: [...repos.values()],
    failures: failures.map((f) => ({ repo: f.repo, status: f.status, error: clean(f.error, MAX_ERROR) })),
  };
}

const bySeverity = (a: DigestFinding, b: DigestFinding) =>
  SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.file.localeCompare(b.file) || a.line - b.line;

// The digest as one webhook sees it: findings below its threshold dropped, failures only if it wants them. Null
// when that leaves nothing to report.
export function viewFor(webhook: Pick<WebhookConfig, 'min_severity' | 'on_failure'>, digest: RunDigest): RunDigest | null {
  const limit = SEVERITY_RANK[webhook.min_severity];
  const repos = digest.repos
    .map((r) => ({ ...r, findings: r.findings.filter((f) => SEVERITY_RANK[f.severity] <= limit).sort(bySeverity) }))
    .filter((r) => r.findings.length);
  const failures = webhook.on_failure ? digest.failures : [];
  return repos.length || failures.length ? { ...digest, repos, failures } : null;
}

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const repositories = (n: number) => count(n, 'repository', 'repositories');
const kindLabel = (k: Kind | null) => (k ? k.charAt(0).toUpperCase() + k.slice(1) : 'Unclassified');

export function headline(view: RunDigest, minSeverity: Severity): string {
  const total = view.repos.reduce((n, r) => n + r.findings.length, 0);
  const parts: string[] = [];
  if (total) parts.push(`${count(total, 'new finding')} at ${minSeverity} or above in ${repositories(view.repos.length)}`);
  const failed = view.failures.filter((f) => f.status === 'failed').length;
  const deferred = view.failures.length - failed;
  if (failed) parts.push(`${repositories(failed)} failed`);
  if (deferred) parts.push(`${repositories(deferred)} deferred`);
  return `RepoScout: ${parts.join('; ')}`;
}

// The first MAX_LISTED findings in reading order, and how many were left out.
function listed(view: RunDigest): { repos: DigestRepo[]; omitted: number } {
  let left = MAX_LISTED;
  let omitted = 0;
  const repos = view.repos.map((r) => {
    const shown = r.findings.slice(0, Math.max(0, left));
    left -= shown.length;
    omitted += r.findings.length - shown.length;
    return { ...r, findings: shown };
  });
  return { repos: repos.filter((r) => r.findings.length), omitted };
}

export function genericPayload(view: RunDigest, minSeverity: Severity) {
  return {
    source: 'reposcout',
    run_id: view.runId,
    date: view.date,
    min_severity: minSeverity,
    summary: headline(view, minSeverity),
    repos: view.repos.map((r) => ({
      repo: r.repo,
      branch: r.branch,
      commit: r.commit,
      findings: r.findings.map((f) => ({
        severity: f.severity,
        type: f.kind,
        category: f.category,
        title: f.title,
        repo: f.repo,
        file: f.file,
        line: f.line,
        fingerprint: f.fingerprint,
      })),
    })),
    failures: view.failures,
  };
}

// Slack mrkdwn: escaping &, < and > keeps a title from forming a link or a mention; backticks would end a code span.
const mrkdwn = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const code = (s: string) => `\`${mrkdwn(s.replace(/`/g, "'"))}\``;
const SLACK_SECTION_CHARS = 2900;
const SLACK_MAX_BLOCKS = 50;

function sections(lines: string[]): { type: 'section'; text: { type: 'mrkdwn'; text: string } }[] {
  const out: string[] = [];
  for (const line of lines) {
    const last = out.at(-1);
    if (last !== undefined && last.length + line.length + 1 <= SLACK_SECTION_CHARS) out[out.length - 1] = `${last}\n${line}`;
    else out.push(clip(line, SLACK_SECTION_CHARS));
  }
  return out.map((text) => ({ type: 'section', text: { type: 'mrkdwn', text } }));
}

export function slackPayload(view: RunDigest, minSeverity: Severity) {
  const title = headline(view, minSeverity);
  const { repos, omitted } = listed(view);
  const blocks: unknown[] = [
    { type: 'header', text: { type: 'plain_text', text: clip(title, 150) } },
    { type: 'context', elements: [{ type: 'mrkdwn', text: `${code(view.runId)} · ${view.date}` }] },
  ];
  for (const r of repos) {
    blocks.push({ type: 'divider' });
    const lines = [`*${mrkdwn(r.repo)}* · ${mrkdwn(r.branch)} @ ${code(r.commit.slice(0, 10))}`];
    for (const f of r.findings) {
      lines.push(
        `• *${f.severity.toUpperCase()}* · ${kindLabel(f.kind)} · ${mrkdwn(f.title)}`,
        `      ${code(`${f.file}:${f.line}`)} · ${code(f.fingerprint)}`,
      );
    }
    blocks.push(...sections(lines));
  }
  if (view.failures.length) {
    blocks.push({ type: 'divider' });
    blocks.push(...sections(['*Not audited*', ...view.failures.map((f) => `• *${mrkdwn(f.repo)}* (${f.status}): ${mrkdwn(f.error)}`)]));
  }
  const tail = omitted ? [{ type: 'context', elements: [{ type: 'mrkdwn', text: `…and ${count(omitted, 'more finding')}; see the dashboard.` }] }] : [];
  const kept = blocks.slice(0, SLACK_MAX_BLOCKS - tail.length);
  return { text: title, blocks: [...kept, ...tail] };
}

// Teams: an Adaptive Card through a Workflows webhook. Finding text goes in TextRuns, which Teams never renders as
// Markdown, so a title cannot turn into a link.
const SEVERITY_COLOR: Record<Severity, string> = { critical: 'Attention', high: 'Attention', medium: 'Warning', low: 'Default' };
const run = (text: string, extra: Record<string, unknown> = {}) => ({ type: 'TextRun', text, ...extra });
const rich = (inlines: unknown[], extra: Record<string, unknown> = {}) => ({ type: 'RichTextBlock', inlines, ...extra });

export function teamsPayload(view: RunDigest, minSeverity: Severity) {
  const { repos, omitted } = listed(view);
  const body: unknown[] = [
    rich([run(headline(view, minSeverity), { size: 'Medium', weight: 'Bolder' })]),
    rich([run(`${view.runId} · ${view.date}`, { isSubtle: true, size: 'Small' })], { spacing: 'None' }),
  ];
  for (const r of repos) {
    body.push(rich([run(r.repo, { weight: 'Bolder' }), run(` · ${r.branch} @ ${r.commit.slice(0, 10)}`, { isSubtle: true })], { separator: true }));
    for (const f of r.findings) {
      body.push(rich([run(f.severity.toUpperCase(), { weight: 'Bolder', color: SEVERITY_COLOR[f.severity] }), run(` · ${kindLabel(f.kind)} · ${f.title}`)]));
      body.push(rich([run(`${f.file}:${f.line} · ${f.fingerprint}`, { fontType: 'Monospace', isSubtle: true, size: 'Small' })], { spacing: 'None' }));
    }
  }
  if (view.failures.length) {
    body.push(rich([run('Not audited', { weight: 'Bolder' })], { separator: true }));
    for (const f of view.failures) body.push(rich([run(f.repo, { weight: 'Bolder' }), run(` (${f.status}): ${f.error}`)]));
  }
  if (omitted) body.push(rich([run(`…and ${count(omitted, 'more finding')}; see the dashboard.`, { isSubtle: true })]));
  return {
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        contentUrl: null,
        content: { $schema: 'http://adaptivecards.io/schemas/adaptive-card.json', type: 'AdaptiveCard', version: '1.4', body, msteams: { width: 'Full' } },
      },
    ],
  };
}

export function payloadFor(webhook: Pick<WebhookConfig, 'format' | 'min_severity'>, view: RunDigest): unknown {
  if (webhook.format === 'teams') return teamsPayload(view, webhook.min_severity);
  if (webhook.format === 'slack') return slackPayload(view, webhook.min_severity);
  return genericPayload(view, webhook.min_severity);
}

export type FetchLike = (
  url: string,
  init: { method: 'POST'; headers: Record<string, string>; body: string; signal: AbortSignal },
) => Promise<{ ok: boolean; status: number; body?: { cancel(): Promise<void> } | null }>;

interface Attempt {
  ok: boolean;
  status?: number;
  error?: string;
  attempts: number;
}

// One retry, after a 5xx or a network error (a timeout included); a 4xx is the webhook's answer and is not retried.
async function post(url: string, body: string, fetchImpl: FetchLike, retryDelayMs: number): Promise<Attempt> {
  let last: Attempt = { ok: false, attempts: 0 };
  for (let attempt = 1; attempt <= 2; attempt++) {
    if (attempt > 1) await new Promise((r) => setTimeout(r, retryDelayMs));
    try {
      const res = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body, signal: AbortSignal.timeout(TIMEOUT_MS) });
      await res.body?.cancel().catch(() => {});
      if (res.ok) return { ok: true, status: res.status, attempts: attempt };
      last = { ok: false, status: res.status, attempts: attempt };
      if (res.status < 500) return last;
    } catch (e) {
      const cause = (e as { cause?: { code?: unknown } }).cause?.code;
      // An invalid URL's error quotes it; the URL is a secret.
      const message = errorMessage(e).split(url).join('[webhook URL]');
      last = { ok: false, error: typeof cause === 'string' ? `${message} (${cause})` : message, attempts: attempt };
    }
  }
  return last;
}

export interface NotifyOptions {
  webhooks: WebhookConfig[];
  digest: RunDigest;
  log: Logger;
  fetch?: FetchLike;
  env?: NodeJS.ProcessEnv;
  retryDelayMs?: number;
}

// Sends one message per webhook. Every failure is logged and swallowed; the URL never appears in a log line.
export async function notifyRun({
  webhooks,
  digest,
  log,
  fetch: fetchImpl = globalThis.fetch,
  env = process.env,
  retryDelayMs = 2000,
}: NotifyOptions): Promise<void> {
  for (const webhook of webhooks) {
    const who = { webhook: webhook.name, format: webhook.format };
    try {
      const view = viewFor(webhook, digest);
      if (!view) {
        log.info('webhook: nothing to report', who);
        continue;
      }
      const url = env[webhook.url_env]?.trim();
      if (!url) {
        log.warn('webhook skipped: its URL variable is not set', { ...who, url_env: webhook.url_env });
        continue;
      }
      registerSecret(url);
      if (!/^https?:$/.test(safeProtocol(url))) {
        log.warn('webhook skipped: its URL is not an http(s) URL', { ...who, url_env: webhook.url_env });
        continue;
      }
      const outcome = await post(url, JSON.stringify(payloadFor(webhook, view)), fetchImpl, retryDelayMs);
      const sent = {
        ...who,
        findings: view.repos.reduce((n, r) => n + r.findings.length, 0),
        failures: view.failures.length,
        attempts: outcome.attempts,
      };
      if (outcome.ok) log.info('webhook notified', { ...sent, status: outcome.status });
      else
        log.warn('webhook notification failed; the run is unaffected', {
          ...sent,
          ...(outcome.status ? { status: outcome.status } : {}),
          error: outcome.error,
        });
    } catch (e) {
      log.warn('webhook notification failed; the run is unaffected', { ...who, error: redact(errorMessage(e)) });
    }
  }
}

function safeProtocol(url: string): string {
  try {
    return new URL(url).protocol;
  } catch {
    return '';
  }
}
