import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { parseNotifications, type WebhookConfig } from '../src/config/config.js';
import { digestOf, type FetchLike, notifyRun, type RunDigest, viewFor } from '../src/notify/webhooks.js';
import type { RepoReport } from '../src/report/types.js';
import type { Logger } from '../src/telemetry/logger.js';

const URL_VALUE = 'https://hooks.example.test/services/T000/B000/secret-path-123456';

const reported = (fingerprint: string, severity: string, status: 'new' | 'existing' = 'new', over = {}) => ({
  fingerprint,
  repo: 'demo',
  commit: 'c',
  file: `src/${fingerprint}.cs`,
  line: 7,
  category: 'security',
  severity,
  title: `Finding ${fingerprint}`,
  description: 'never sent',
  scenario: 'never sent either',
  suggested_fix: 'f',
  confidence: 'high',
  verified: false,
  snippet: 'SECRET_CODE_SNIPPET',
  kind: 'vulnerability',
  status,
  first_seen: 't0',
  ...over,
});

const report = (runId: string, findings: object[], repo = 'demo'): RepoReport =>
  ({ run_id: runId, repo, branch: 'main', commit: 'abcdef1234567890', findings }) as unknown as RepoReport;

const digest = (failures: RunDigest['failures'] = []) =>
  digestOf({
    runId: 'run-1',
    date: '2026-10-08',
    reports: [
      report('run-1', [reported('crit', 'critical'), reported('high', 'high'), reported('med', 'medium'), reported('old', 'critical', 'existing')]),
      // A sweep's second pass: its new finding joins the first pass's.
      report('run-1-p2', [reported('low', 'low'), reported('crit', 'critical')]),
    ],
    failures,
  });

const webhook = (over: Partial<WebhookConfig> = {}): WebhookConfig => ({
  name: 'team',
  url_env: 'REPOSCOUT_TEST_WEBHOOK',
  format: 'generic',
  min_severity: 'high',
  on_failure: true,
  ...over,
});

function recorder() {
  const lines: string[] = [];
  const log: Logger = {
    filePath: null,
    info: (m, f) => lines.push(`INFO ${m} ${JSON.stringify(f ?? {})}`),
    warn: (m, f) => lines.push(`WARN ${m} ${JSON.stringify(f ?? {})}`),
    error: (m, f) => lines.push(`ERROR ${m} ${JSON.stringify(f ?? {})}`),
  };
  return { lines, log };
}

function fakeFetch(responses: (number | Error)[]) {
  const calls: { url: string; body: unknown }[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    const next = responses.shift() ?? 200;
    if (next instanceof Error) throw next;
    return { ok: next < 300, status: next };
  };
  return { calls, fetch };
}

const env = { REPOSCOUT_TEST_WEBHOOK: URL_VALUE };

describe('webhook notifications', () => {
  it('collects only new findings, once each, across sweep passes', () => {
    const d = digest();
    assert.deepEqual(
      d.repos[0]?.findings.map((f) => f.fingerprint),
      ['crit', 'high', 'med', 'low'],
    );
  });

  it('filters by min_severity, and drops failures unless on_failure', () => {
    const failures: RunDigest['failures'] = [{ repo: 'other', status: 'failed', error: 'clone failed' }];
    const high = viewFor(webhook(), digest(failures));
    assert.deepEqual(
      high?.repos[0]?.findings.map((f) => f.severity),
      ['critical', 'high'],
    );
    assert.equal(high?.failures.length, 1);
    assert.equal(viewFor(webhook({ min_severity: 'critical', on_failure: false }), digest(failures))?.failures.length, 0);
    assert.equal(viewFor(webhook({ min_severity: 'low' }), digest())?.repos[0]?.findings.length, 4);
  });

  it('skips sending when nothing reaches the threshold and nothing failed', async () => {
    const quiet = digestOf({ runId: 'run-1', date: 'd', reports: [report('run-1', [reported('m', 'medium')])], failures: [] });
    const { calls, fetch } = fakeFetch([]);
    const { lines, log } = recorder();
    await notifyRun({ webhooks: [webhook()], digest: quiet, log, fetch, env });
    assert.equal(calls.length, 0);
    assert.match(lines.join('\n'), /nothing to report/);
  });

  it('sends a generic JSON payload with locations and no code or descriptions', async () => {
    const { calls, fetch } = fakeFetch([200]);
    const { log } = recorder();
    await notifyRun({ webhooks: [webhook()], digest: digest([{ repo: 'other', status: 'deferred', error: 'usage limit' }]), log, fetch, env });
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, URL_VALUE);
    const body = calls[0]?.body as { repos: { findings: object[] }[]; failures: object[]; summary: string };
    assert.deepEqual(body.repos[0]?.findings[0], {
      severity: 'critical',
      type: 'vulnerability',
      category: 'security',
      title: 'Finding crit',
      repo: 'demo',
      file: 'src/crit.cs',
      line: 7,
      fingerprint: 'crit',
    });
    assert.deepEqual(body.failures, [{ repo: 'other', status: 'deferred', error: 'usage limit' }]);
    assert.equal(body.summary, 'RepoScout: 2 new findings at high or above in 1 repository; 1 repository deferred');
    const text = JSON.stringify(body);
    for (const absent of ['SECRET_CODE_SNIPPET', 'never sent']) assert.ok(!text.includes(absent), absent);
  });

  it('sends a Teams Adaptive Card through the Workflows format, with titles as plain text runs', async () => {
    const { calls, fetch } = fakeFetch([202]);
    await notifyRun({ webhooks: [webhook({ format: 'teams' })], digest: digest(), log: recorder().log, fetch, env });
    const body = calls[0]?.body as { type: string; attachments: { contentType: string; content: { type: string; version: string; body: unknown[] } }[] };
    assert.equal(body.type, 'message');
    assert.equal(body.attachments[0]?.contentType, 'application/vnd.microsoft.card.adaptive');
    assert.equal(body.attachments[0]?.content.type, 'AdaptiveCard');
    assert.equal(body.attachments[0]?.content.version, '1.4');
    const text = JSON.stringify(body);
    assert.match(text, /"type":"TextRun","text":" · Vulnerability · Finding crit"/);
    assert.match(text, /src\/high\.cs:7 · high/);
    assert.ok(!text.includes('Finding med'));
    assert.ok(!text.includes('SECRET_CODE_SNIPPET'));
  });

  it('sends Slack blocks with a fallback text and escaped titles', async () => {
    const d = digestOf({
      runId: 'run-1',
      date: 'd',
      reports: [report('run-1', [reported('x', 'high', 'new', { title: 'Uses <!channel> & <https://evil|click>' })])],
      failures: [],
    });
    const { calls, fetch } = fakeFetch([200]);
    await notifyRun({ webhooks: [webhook({ format: 'slack' })], digest: d, log: recorder().log, fetch, env });
    const body = calls[0]?.body as { text: string; blocks: { type: string; text?: { text: string } }[] };
    assert.equal(body.text, 'RepoScout: 1 new finding at high or above in 1 repository');
    assert.equal(body.blocks[0]?.type, 'header');
    const sections = body.blocks.filter((b) => b.type === 'section').map((b) => b.text?.text ?? '');
    assert.ok(sections.some((s) => s.includes('&lt;!channel&gt; &amp; &lt;https://evil|click&gt;')));
    assert.ok(body.blocks.length <= 50);
  });

  it('retries once on a 5xx or a network error, then gives up without throwing', async () => {
    const flaky = fakeFetch([503, 200]);
    const one = recorder();
    await notifyRun({ webhooks: [webhook()], digest: digest(), log: one.log, fetch: flaky.fetch, env, retryDelayMs: 0 });
    assert.equal(flaky.calls.length, 2);
    assert.match(one.lines.join('\n'), /webhook notified.*"attempts":2/);

    const down = fakeFetch([new TypeError(`Failed to parse URL from ${URL_VALUE}`), new Error('fetch failed')]);
    const two = recorder();
    await notifyRun({ webhooks: [webhook()], digest: digest(), log: two.log, fetch: down.fetch, env, retryDelayMs: 0 });
    assert.equal(down.calls.length, 2);
    assert.match(two.lines.join('\n'), /WARN webhook notification failed/);

    const rejected = fakeFetch([400]);
    await notifyRun({ webhooks: [webhook()], digest: digest(), log: recorder().log, fetch: rejected.fetch, env, retryDelayMs: 0 });
    assert.equal(rejected.calls.length, 1, 'a 4xx is not retried');

    const throwing: FetchLike = () => {
      throw new Error(`boom ${URL_VALUE}`);
    };
    const three = recorder();
    await notifyRun({ webhooks: [webhook()], digest: digest(), log: three.log, fetch: throwing, env, retryDelayMs: 0 });
    for (const lines of [one.lines, two.lines, three.lines]) assert.ok(!lines.join('\n').includes(URL_VALUE), 'the URL never reaches a log');
  });

  it('skips a webhook whose variable is unset, naming the variable but no URL', async () => {
    const { calls, fetch } = fakeFetch([]);
    const { lines, log } = recorder();
    await notifyRun({ webhooks: [webhook()], digest: digest(), log, fetch, env: {} });
    assert.equal(calls.length, 0);
    assert.match(lines.join('\n'), /URL variable is not set.*REPOSCOUT_TEST_WEBHOOK/);
  });
});

describe('notifications config', () => {
  const yaml = (webhooks: string) => `repos: []\nnotifications:\n  webhooks:\n${webhooks}`;

  it('defaults to no webhooks, and fills min_severity and on_failure', () => {
    assert.deepEqual(parseNotifications('repos: []\n'), []);
    assert.deepEqual(parseNotifications(yaml('    - name: sec\n      url_env: REPOSCOUT_TEAMS_URL\n      format: teams\n')), [
      { name: 'sec', url_env: 'REPOSCOUT_TEAMS_URL', format: 'teams', min_severity: 'high', on_failure: true },
    ]);
  });

  it('rejects an unknown format, a bad severity, a URL in the file, or a variable Claude would inherit', () => {
    assert.throws(() => parseNotifications(yaml('    - name: a\n      url_env: REPOSCOUT_X\n      format: discord\n')), /format/);
    assert.throws(
      () => parseNotifications(yaml('    - name: a\n      url_env: REPOSCOUT_X\n      format: slack\n      min_severity: urgent\n')),
      /min_severity/,
    );
    assert.throws(() => parseNotifications(yaml('    - name: a\n      url_env: REPOSCOUT_X\n      format: slack\n      url: https://x\n')));
    assert.throws(() => parseNotifications(yaml('    - name: a\n      url_env: TEAMS_URL\n      format: teams\n')), /REPOSCOUT_/);
  });
});
