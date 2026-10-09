import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, it } from 'vitest';
import { startServer } from '../src/dashboard/server.js';
import type { FindingEntry } from '../src/findings/types.js';
import { createJiraClient } from '../src/jira/client.js';
import { clearMetadataCache } from '../src/jira/metadata.js';
import { reportFindings, reportForm } from '../src/jira/report.js';
import type { ReportBody } from '../src/jira/types.js';
import { layout } from '../src/paths.js';
import type { RepoState } from '../src/state/types.js';
import { restoreExport, writeExport } from '../src/store/backup.js';
import { closeStores, IssueError, openStore, Store } from '../src/store/index.js';
import { fakeJira } from './fake-jira.js';

const VALIDATED = 'a'.repeat(32);
const DETECTED = 'b'.repeat(32);
const SECOND = 'c'.repeat(32);
const THIRD = 'd'.repeat(32);

const entry = (fingerprint: string, verified: boolean, title = `Finding ${fingerprint.slice(0, 4)}`): FindingEntry =>
  ({
    status: 'open',
    first_seen: 't0',
    last_seen: 't0',
    finding: {
      fingerprint,
      repo: 'api',
      commit: 'abcdef1234567890',
      file: 'src/Orders.cs',
      line: 7,
      category: 'security',
      severity: 'high',
      title,
      description: 'Why.',
      scenario: 'How.',
      suggested_fix: 'Fix.',
      confidence: 'high',
      verified,
      snippet: 'x',
    },
  }) as FindingEntry;

const state = (findings: RepoState['findings']): RepoState => ({ repo: 'api', branch: 'main', last_commit: 'abc', findings });

const CONFIG = `jira:
  site: https://acme.atlassian.net
defaults:
  organization: org
  project: p
repos:
  - name: api
    repo: api
    jira:
      project: API
      issue_type: Bug
      parent: API-1
      labels: [security]
      fields: { Team: Security, Severity: High }
`;

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'reposcout-jira-'));
  writeFileSync(join(root, 'repos.yaml'), CONFIG);
  const store = openStore(layout(root));
  store.writeRepoState(
    'api',
    state({ [VALIDATED]: entry(VALIDATED, true), [DETECTED]: entry(DETECTED, false), [SECOND]: entry(SECOND, true), [THIRD]: entry(THIRD, true) }),
    { runId: 'run-1', at: 't0' },
  );
  return { root, store, configPath: join(root, 'repos.yaml') };
}

const creds = { site: 'https://acme.atlassian.net', email: 'bot@acme.example', token: 'jira-token-abcdef123456' };

const body = (fingerprints: string[], over: Partial<ReportBody> = {}): ReportBody => ({
  repo: 'api',
  fingerprints,
  project: 'API',
  issue_type: 'Bug',
  parent: 'API-1',
  labels: ['security'],
  fields: { customfield_100: '1', customfield_101: '10' },
  summaries: {},
  ...over,
});

describe('issue links in the store', () => {
  const link = { key: 'API-42', url: 'https://acme.atlassian.net/browse/API-42', project: 'API', reported_by: 'jorge', reported_at: 't1' };

  it('moves a validated finding to reported and back on unlink, with its stage history', () => {
    const store = new Store(':memory:');
    store.writeRepoState('api', state({ [VALIDATED]: entry(VALIDATED, true) }), { runId: 'run-1', at: 't0' });
    store.linkIssue('api', VALIDATED, link);
    assert.equal(store.stagesFor('api').get(VALIDATED)?.stage, 'reported');
    assert.deepEqual(store.issuesFor('api').get(VALIDATED), link);
    store.unlinkIssue('api', VALIDATED, 'ana', 't2');
    assert.equal(store.stagesFor('api').get(VALIDATED)?.stage, 'validated');
    assert.deepEqual(
      store.stageHistory('api', VALIDATED).map((e) => [e.from_stage, e.to_stage, e.source, e.note, e.actor]),
      [
        [null, 'validated', 'initial', null, null],
        ['validated', 'reported', 'reported', 'API-42', 'jorge'],
        ['reported', 'validated', 'unlinked', 'API-42', 'ana'],
      ],
    );
  });

  it('refuses a finding not validated, one already linked, and an unlink with no link', () => {
    const store = new Store(':memory:');
    store.writeRepoState('api', state({ [VALIDATED]: entry(VALIDATED, true), [DETECTED]: entry(DETECTED, false) }), { runId: 'run-1', at: 't0' });
    assert.throws(
      () => store.linkIssue('api', DETECTED, link),
      (e) => e instanceof IssueError && e.kind === 'not-reportable',
    );
    store.linkIssue('api', VALIDATED, link);
    assert.throws(
      () => store.linkIssue('api', VALIDATED, link),
      (e) => e instanceof IssueError && e.kind === 'already-reported',
    );
    assert.throws(
      () => store.unlinkIssue('api', DETECTED, 'ana', 't2'),
      (e) => e instanceof IssueError && e.kind === 'no-issue',
    );
  });

  it('keeps reported through a later run, and drops the link when the fingerprint leaves the state', () => {
    const store = new Store(':memory:');
    store.writeRepoState('api', state({ [VALIDATED]: entry(VALIDATED, true) }), { runId: 'run-1', at: 't0' });
    store.linkIssue('api', VALIDATED, link);
    store.writeRepoState('api', state({ [VALIDATED]: { ...entry(VALIDATED, false), last_seen: 't3' } }), { runId: 'run-2', at: 't3' });
    assert.equal(store.stagesFor('api').get(VALIDATED)?.stage, 'reported');
    assert.equal(store.issuesFor('api').get(VALIDATED)?.key, 'API-42');
    store.writeRepoState('api', state({}), { runId: 'run-3', at: 't4' });
    assert.equal(store.issuesFor('api').size, 0);
  });

  it('round-trips links through an export, and restores an export without them', () => {
    const { root, store } = setup();
    store.linkIssue('api', VALIDATED, link);
    const dir = join(root, 'export');
    writeExport(store, dir);
    assert.ok(existsSync(join(dir, 'finding-issues.json')));
    const restored = new Store(':memory:');
    restoreExport(restored, dir);
    assert.equal(restored.issuesFor('api').get(VALIDATED)?.key, 'API-42');
    assert.equal(restored.stagesFor('api').get(VALIDATED)?.stage, 'reported');
    rmSync(join(dir, 'finding-issues.json'));
    const empty = new Store(':memory:');
    restoreExport(empty, dir);
    assert.equal(empty.issuesFor('api').size, 0);
    closeStores();
  });
});

describe('reporting findings', () => {
  beforeEach(() => clearMetadataCache());
  afterEach(() => closeStores());

  const ctx = (jira = fakeJira()) => {
    const { root, store, configPath } = setup();
    return { jira, root, store, ctx: { configPath, store, client: createJiraClient(creds, { fetchFn: jira.fetch }), by: 'jorge', now: () => 't9' } };
  };

  it('builds the form from the target, with the default parent checked', async () => {
    const { ctx: c } = ctx();
    const form = await reportForm(c, 'api');
    assert.equal(form.project, 'API');
    assert.equal(form.issue_type, 'Bug');
    assert.deepEqual(form.parent, { key: 'API-1', summary: 'Checkout hardening', type: 'Epic' });
    assert.equal(form.parent_allowed, true);
    assert.deepEqual(
      form.fields.map((f) => [f.name, f.default ?? null]),
      [
        ['Team', '1'],
        ['Severity', '10'],
      ],
    );
  });

  it('creates the issue with the finding as content, links it and moves the finding to reported', async () => {
    const { jira, store, ctx: c } = ctx();
    const [outcome] = await reportFindings(c, body([VALIDATED]));
    assert.deepEqual(outcome, { fingerprint: VALIDATED, ok: true, key: 'API-100', url: 'https://acme.atlassian.net/browse/API-100', adopted: false });
    const [create] = jira.creates();
    assert.ok(create);
    const { fields } = create.body as { fields: Record<string, unknown> };
    assert.deepEqual(fields.labels, ['security', 'reposcout', `reposcout-${VALIDATED}`]);
    assert.deepEqual(fields.parent, { key: 'API-1' });
    assert.deepEqual(fields.customfield_100, { id: '1' });
    assert.equal(fields.summary, 'Finding aaaa');
    assert.equal(store.stagesFor('api').get(VALIDATED)?.stage, 'reported');
    assert.equal(store.issuesFor('api').get(VALIDATED)?.reported_by, 'jorge');
  });

  it('refuses a finding that is not validated without calling Jira to create', async () => {
    const { jira, ctx: c } = ctx();
    const [outcome] = await reportFindings(c, body([DETECTED]));
    assert.equal(outcome?.ok, false);
    assert.match(outcome?.ok === false ? outcome.error : '', /only a validated open finding/);
    assert.equal(jira.creates().length, 0);
  });

  it('links the issue an earlier report filed instead of creating a second one', async () => {
    const { jira, store, ctx: c } = ctx();
    jira.issues.set('API-55', { key: 'API-55', type: '1', summary: 'old', labels: [`reposcout-${VALIDATED}`], fields: {} });
    const [outcome] = await reportFindings(c, body([VALIDATED]));
    assert.deepEqual(outcome, { fingerprint: VALIDATED, ok: true, key: 'API-55', url: 'https://acme.atlassian.net/browse/API-55', adopted: true });
    assert.equal(jira.creates().length, 0);
    assert.equal(store.issuesFor('api').get(VALIDATED)?.key, 'API-55');
  });

  it('reports each finding of a batch on its own, and returns every outcome', async () => {
    const { jira, ctx: c } = ctx();
    let n = 0;
    const flaky = (async (input: URL | RequestInfo, init?: RequestInit) => {
      if (init?.method === 'POST' && ++n === 2) return new Response(JSON.stringify({ errorMessages: ['Summary is too long'] }), { status: 400 });
      return jira.fetch(input, init);
    }) as typeof fetch;
    const outcomes = await reportFindings({ ...c, client: createJiraClient(creds, { fetchFn: flaky }) }, body([VALIDATED, SECOND, THIRD]));
    assert.deepEqual(
      outcomes.map((o) => o.ok),
      [true, false, true],
    );
    assert.match(outcomes[1]?.ok === false ? outcomes[1].error : '', /Summary is too long/);
  });

  it('refuses the whole request before creating anything when a field value does not fit', async () => {
    const { jira, ctx: c } = ctx();
    await assert.rejects(reportFindings(c, body([VALIDATED], { fields: { customfield_101: '99' } })), /Team is required; Severity does not allow 99/);
    assert.equal(jira.creates().length, 0);
  });

  it('refuses a parent that cannot be a parent', async () => {
    const { jira, ctx: c } = ctx();
    jira.issues.set('API-9', { key: 'API-9', type: '1', summary: 'a bug', labels: [], fields: {} });
    await assert.rejects(reportFindings(c, body([VALIDATED], { parent: 'API-9' })), /cannot be the parent/);
  });
});

function call(port: number, path: string, { method = 'GET', headers = {}, body }: { method?: string; headers?: Record<string, string>; body?: string } = {}) {
  return new Promise<{ status: number; body: string }>((resolveCall, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      let data = '';
      res.on('data', (d) => (data += d));
      res.on('end', () => resolveCall({ status: res.statusCode ?? 0, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

describe('the dashboard reporting to Jira', () => {
  let root: string;
  let server: Server;
  let port: number;
  const jira = fakeJira();
  const env = { e: process.env.REPOSCOUT_JIRA_EMAIL, t: process.env.REPOSCOUT_JIRA_TOKEN };

  beforeAll(async () => {
    process.env.REPOSCOUT_JIRA_EMAIL = creds.email;
    process.env.REPOSCOUT_JIRA_TOKEN = creds.token;
    clearMetadataCache();
    ({ root } = setup());
    const uiDir = join(root, 'web-dist');
    mkdirSync(uiDir, { recursive: true });
    writeFileSync(join(uiDir, 'index.html'), '<!doctype html>');
    server = await startServer({ root, uiDir, configPath: join(root, 'repos.yaml'), port: 0, pollMs: 50, deps: { jiraFetch: jira.fetch } });
    port = (server.address() as AddressInfo).port;
  });

  afterAll(() => {
    server.close();
    closeStores();
    if (env.e === undefined) delete process.env.REPOSCOUT_JIRA_EMAIL;
    else process.env.REPOSCOUT_JIRA_EMAIL = env.e;
    if (env.t === undefined) delete process.env.REPOSCOUT_JIRA_TOKEN;
    else process.env.REPOSCOUT_JIRA_TOKEN = env.t;
  });

  const token = async () => JSON.parse((await call(port, '/api/session')).body).token as string;
  const post = async (action: string, payload: unknown) =>
    call(port, `/api/actions/${action}`, {
      method: 'POST',
      headers: { origin: `http://127.0.0.1:${port}`, 'content-type': 'application/json', 'x-reposcout-token': await token() },
      body: JSON.stringify(payload),
    });

  it('refuses a lookup without the session token, before calling Jira', async () => {
    const before = jira.calls.length;
    assert.equal((await call(port, '/api/jira/meta?repo=api')).status, 403);
    assert.equal(jira.calls.length, before);
  });

  it('refuses a crafted project key with 400', async () => {
    const res = await call(port, `/api/jira/users?project=${encodeURIComponent('../../rest/api/3/user')}`, { headers: { 'x-reposcout-token': await token() } });
    assert.equal(res.status, 400);
  });

  it('serves the form and the lookups to the page', async () => {
    const headers = { 'x-reposcout-token': await token() };
    const form = JSON.parse((await call(port, '/api/jira/meta?repo=api', { headers })).body);
    assert.equal(form.parent.key, 'API-1');
    const sprints = JSON.parse((await call(port, '/api/jira/sprints?project=API', { headers })).body);
    assert.equal(sprints[0].name, 'Sprint 42');
  });

  it('shows the overview with Jira ready and never the credential', async () => {
    const text = (await call(port, '/api/overview')).body;
    const ov = JSON.parse(text);
    assert.deepEqual(ov.jira, { site: 'https://acme.atlassian.net', ready: true });
    assert.deepEqual(ov.repos[0].jira, { project: 'API', issue_type: 'Bug' });
    assert.ok(!text.includes(creds.token) && !text.includes(creds.email));
  });

  it('reports a finding end to end: issue, stage, link, action log and export', async () => {
    const res = await post('report', {
      repo: 'api',
      fingerprints: [VALIDATED],
      project: 'API',
      issue_type: 'Bug',
      parent: 'API-1',
      fields: { customfield_100: '1' },
    });
    assert.equal(res.status, 200);
    const [outcome] = JSON.parse(res.body);
    assert.equal(outcome.ok, true);
    const ov = JSON.parse((await call(port, '/api/overview')).body);
    const f = ov.findings.find((x: { fingerprint: string }) => x.fingerprint === VALIDATED);
    assert.equal(f.stage, 'reported');
    assert.equal(f.issue.key, outcome.key);
    const logDir = join(root, 'reports');
    const day = readdirSync(logDir).find((d) => existsSync(join(logDir, d, 'logs', 'dashboard-actions.jsonl'))) as string;
    const log = readFileSync(join(logDir, day, 'logs', 'dashboard-actions.jsonl'), 'utf8');
    assert.match(log, new RegExp(outcome.key));
    assert.ok(!log.includes(creds.token) && !log.includes(creds.email));
    const dir = join(root, 'exports-test');
    writeExport(openStore(layout(root)), dir);
    assert.match(readFileSync(join(dir, 'finding-issues.json'), 'utf8'), new RegExp(outcome.key));
  });

  it('refuses to report the same finding twice with 409 named in the outcome, and unlinks it', async () => {
    const [again] = JSON.parse(
      (await post('report', { repo: 'api', fingerprints: [VALIDATED], project: 'API', issue_type: 'Bug', fields: { customfield_100: '1' } })).body,
    );
    assert.equal(again.ok, false);
    assert.match(again.error, /already reported as API-/);
    const unlink = await post('unlink', { repo: 'api', fingerprint: VALIDATED });
    assert.equal(unlink.status, 200);
    assert.equal((await post('unlink', { repo: 'api', fingerprint: VALIDATED })).status, 404);
    const writes = jira.calls.filter((c) => c.method !== 'GET').length;
    assert.equal(writes, 1);
  });

  it('answers a Jira field error with 400 and the field, changing nothing', async () => {
    const res = await post('report', { repo: 'api', fingerprints: [SECOND], project: 'API', issue_type: 'Bug', fields: {} });
    assert.equal(res.status, 400);
    assert.deepEqual(JSON.parse(res.body).fields, { customfield_100: 'is required' });
    const ov = JSON.parse((await call(port, '/api/overview')).body);
    assert.equal(ov.findings.find((x: { fingerprint: string }) => x.fingerprint === SECOND).stage, 'validated');
  });
});
