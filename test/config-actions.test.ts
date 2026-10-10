import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, it } from 'vitest';
import { parseConfig } from '../src/config/config.js';
import { addRepository, type LsRemoteFn, removeRepository, setConfigValue, testRepository, unsetConfigValue } from '../src/dashboard/config-actions.js';
import { startServer } from '../src/dashboard/server.js';
import type { FindingEntry } from '../src/findings/types.js';
import { layout } from '../src/paths.js';
import { closeStores, openStore } from '../src/store/index.js';
import { fakeJira } from './fake-jira.js';

const FP = 'a'.repeat(32);

const CONFIG = `# RepoScout configuration.
defaults:
  organization: org
  project: p
  # Models shared by every repository.
  claude:
    models:
      verifier: opus
  excluded_paths:
    - "docs/**"

repos:
  # The main API.
  - name: api
    repo: api
    claude:
      max_turns: 80 # raised for the large solution
    excluded_paths:
      - "scripts/**"
    focus_areas:
      - isolation between rights-holding broadcasters (one RHB must never see or change another's streams)
    analyzers: [security, logic]
  - name: lib
    provider: github
    organization: owner
    repo: lib

notifications:
  webhooks:
    - name: team
      url_env: REPOSCOUT_TEAM_WEBHOOK
      format: teams
`;

let root: string;
let configPath: string;

const comments = (text: string) => text.split('\n').filter((l) => l.includes('#'));
const repo = (name: string) => parseConfig(readFileSync(configPath, 'utf8')).find((r) => r.name === name);
const statusOf = (fn: () => unknown) => {
  try {
    fn();
    return 200;
  } catch (e) {
    return (e as { status?: number }).status ?? 500;
  }
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'reposcout-cfg-'));
  configPath = join(root, 'repos.yaml');
  writeFileSync(configPath, CONFIG);
});

afterEach(() => closeStores());

describe('setConfigValue and unsetConfigValue', () => {
  it('overrides one key of a repository and keeps every comment', () => {
    setConfigValue({ configPath, scope: 'repo', name: 'api', key: 'claude.models.specialists', value: 'haiku' });
    const after = readFileSync(configPath, 'utf8');
    assert.deepEqual(comments(after), comments(CONFIG));
    assert.equal(repo('api')?.claude.models.specialists, 'haiku');
    assert.equal(repo('api')?.claude.models.verifier, 'opus');
    assert.equal(repo('lib')?.claude.models.specialists, 'sonnet');
  });

  it('leaves every line it did not edit as it was, long lines and flow lists included', () => {
    setConfigValue({ configPath, scope: 'repo', name: 'lib', key: 'branch', value: 'trunk' });
    const after = readFileSync(configPath, 'utf8').split('\n');
    const before = CONFIG.split('\n');
    assert.deepEqual(
      before.filter((l) => !after.includes(l)),
      [],
    );
    assert.equal(after.length, before.length + 1);
  });

  it('keeps the inline comment of a scalar it changes', () => {
    setConfigValue({ configPath, scope: 'repo', name: 'api', key: 'claude.max_turns', value: 90 });
    assert.match(readFileSync(configPath, 'utf8'), /max_turns: 90 # raised for the large solution/);
  });

  it('writes defaults and webhooks', () => {
    setConfigValue({ configPath, scope: 'defaults', key: 'max_files_per_run', value: 30 });
    setConfigValue({ configPath, scope: 'webhook', name: 'team', key: 'min_severity', value: 'critical' });
    assert.equal(repo('lib')?.max_files_per_run, 30);
    assert.match(readFileSync(configPath, 'utf8'), /format: teams\n\s+min_severity: critical/);
  });

  it('writes only the scope’s own list for the lists that add up', () => {
    setConfigValue({ configPath, scope: 'repo', name: 'api', key: 'excluded_paths', value: ['scripts/**', 'tools/**'] });
    assert.deepEqual(repo('api')?.excluded_paths, ['docs/**', 'scripts/**', 'tools/**']);
    setConfigValue({ configPath, scope: 'repo', name: 'api', key: 'excluded_paths', value: [] });
    assert.deepEqual(repo('api')?.excluded_paths, ['docs/**']);
    assert.doesNotMatch(readFileSync(configPath, 'utf8'), /scripts/);
  });

  it('refuses an invalid value with 400 naming the field, leaving the file alone', () => {
    assert.throws(
      () => setConfigValue({ configPath, scope: 'repo', name: 'api', key: 'max_files_per_run', value: 500 }),
      (e: { status: number; message: string }) => e.status === 400 && /Files per run/.test(e.message),
    );
    assert.equal(readFileSync(configPath, 'utf8'), CONFIG);
  });

  it('refuses an edit that breaks a rule across keys with 400', () => {
    assert.equal(
      statusOf(() => setConfigValue({ configPath, scope: 'repo', name: 'api', key: 'jira.project', value: 'API' })),
      400,
    );
    assert.equal(readFileSync(configPath, 'utf8'), CONFIG);
  });

  it('refuses every read-only key in set and unset without touching the file', () => {
    const keys = [
      'test_command',
      'test_command_unsandboxed',
      'path',
      'pat_env',
      'claude.auth',
      'organization',
      'name',
      'provider',
      'jira.fields',
      'suppressed',
    ];
    for (const key of keys) {
      assert.equal(
        statusOf(() => setConfigValue({ configPath, scope: 'repo', name: 'api', key, value: 'x' })),
        400,
        key,
      );
      assert.equal(
        statusOf(() => unsetConfigValue({ configPath, scope: 'repo', name: 'api', key })),
        400,
        key,
      );
    }
    assert.equal(
      statusOf(() => setConfigValue({ configPath, scope: 'webhook', name: 'team', key: 'url_env', value: 'REPOSCOUT_X' })),
      400,
    );
    assert.equal(readFileSync(configPath, 'utf8'), CONFIG);
  });

  it('resets a key and removes the objects it leaves empty', () => {
    unsetConfigValue({ configPath, scope: 'repo', name: 'api', key: 'claude.max_turns' });
    const after = readFileSync(configPath, 'utf8');
    assert.doesNotMatch(after.split('repos:')[1] ?? '', /claude:/);
    assert.equal(repo('api')?.claude.max_turns, 60);
    assert.equal(
      statusOf(() => unsetConfigValue({ configPath, scope: 'repo', name: 'api', key: 'claude.max_turns' })),
      404,
    );
  });

  it('applies on top of a hand edit made since the page loaded', () => {
    writeFileSync(configPath, CONFIG.replace('repo: api\n', 'repo: api\n    branch: develop\n'));
    setConfigValue({ configPath, scope: 'repo', name: 'api', key: 'max_file_bytes', value: 1000 });
    assert.deepEqual([repo('api')?.branch, repo('api')?.max_file_bytes], ['develop', 1000]);
  });

  it('refuses to edit through a YAML alias shared with other entries', () => {
    const shared = CONFIG.replace(
      'repo: api\n    claude:\n      max_turns: 80 # raised for the large solution',
      'repo: api\n    claude: &big\n      max_turns: 80',
    ).replace('repo: lib\n', 'repo: lib\n    claude: *big\n');
    writeFileSync(configPath, shared);
    assert.equal(
      statusOf(() => setConfigValue({ configPath, scope: 'repo', name: 'lib', key: 'claude.max_turns', value: 10 })),
      409,
    );
    assert.equal(readFileSync(configPath, 'utf8'), shared);
  });
});

describe('addRepository and removeRepository', () => {
  it('appends an entry with only its identity, inheriting the defaults', () => {
    addRepository({ configPath, entry: { provider: 'github', organization: 'acme', repo: 'web', branch: 'trunk' } });
    const web = repo('web');
    assert.deepEqual([web?.organization, web?.branch, web?.pat_env, web?.excluded_paths], ['acme', 'trunk', 'REPOSCOUT_GITHUB_TOKEN', ['docs/**']]);
    assert.match(readFileSync(configPath, 'utf8'), /- provider: github\n\s+organization: acme\n\s+repo: web\n\s+branch: trunk/);
  });

  it('gives a repository of the other provider its own token variable instead of the defaults’ one', () => {
    writeFileSync(configPath, CONFIG.replace('  project: p\n', '  project: p\n  pat_env: REPOSCOUT_TEAM_ADO_PAT\n'));
    addRepository({ configPath, entry: { provider: 'github', organization: 'acme', repo: 'web' } });
    assert.equal(repo('web')?.pat_env, 'REPOSCOUT_GITHUB_TOKEN');
    addRepository({ configPath, entry: { provider: 'azure-devops', organization: 'org', project: 'p', repo: 'svc' } });
    assert.equal(repo('svc')?.pat_env, 'REPOSCOUT_TEAM_ADO_PAT');
    assert.doesNotMatch(readFileSync(configPath, 'utf8').split('repo: svc')[1] ?? '', /pat_env/);
  });

  it('tests a repository of the other provider with its own token, not the defaults’ one', async () => {
    writeFileSync(configPath, CONFIG.replace('  project: p\n', '  project: p\n  pat_env: REPOSCOUT_TEAM_ADO_PAT\n'));
    const saved = process.env.REPOSCOUT_TEAM_ADO_PAT;
    process.env.REPOSCOUT_TEAM_ADO_PAT = 'abcdefghijklmnopqrstuvwxyz234567abcdefghijklmnopqrst';
    try {
      const envs: NodeJS.ProcessEnv[] = [];
      await testRepository(
        { root, configPath, entry: { provider: 'github', organization: 'octocat', repo: 'hello' } },
        { lsRemote: async (_args, env) => (envs.push(env), { code: 0, stdout: 'x\trefs/heads/main', stderr: '', timedOut: false }) },
      );
      assert.ok(!Object.values(envs[0] ?? {}).some((v) => String(v).startsWith('Authorization:')));
    } finally {
      if (saved === undefined) delete process.env.REPOSCOUT_TEAM_ADO_PAT;
      else process.env.REPOSCOUT_TEAM_ADO_PAT = saved;
    }
  });

  it('refuses a name already configured with 409', () => {
    assert.equal(
      statusOf(() => addRepository({ configPath, entry: { provider: 'azure-devops', organization: 'org', project: 'p', repo: 'api' } })),
      409,
    );
  });

  it('refuses execution and credential keys, the local provider and invalid identifiers with 400', () => {
    for (const entry of [
      { provider: 'github', organization: 'a', repo: 'x', test_command: 'npm test' },
      { provider: 'github', organization: 'a', repo: 'x', pat_env: 'REPOSCOUT_JIRA_TOKEN' },
      { provider: 'github', organization: 'a', repo: 'x', claude: { auth: 'login' } },
      { provider: 'local', organization: 'a', repo: 'x', path: '.' },
      { provider: 'github', organization: 'a;rm', repo: 'x' },
      { provider: 'github', organization: 'a', project: 'p', repo: 'x' },
    ]) {
      assert.equal(
        statusOf(() => addRepository({ configPath, entry })),
        400,
        JSON.stringify(entry),
      );
    }
    assert.equal(readFileSync(configPath, 'utf8'), CONFIG);
  });

  it('removes an entry, keeps its history in state and brings it back when added again', () => {
    const store = openStore(layout(root));
    const finding = {
      status: 'open',
      first_seen: 't0',
      last_seen: 't0',
      finding: { fingerprint: FP, file: 'a.cs', line: 1, category: 'logic', severity: 'low', title: 'A' },
    };
    store.writeRepoState('lib', { repo: 'lib', branch: 'main', last_commit: 'abc', findings: { [FP]: finding as FindingEntry } }, { runId: 'run-1', at: 't0' });
    removeRepository({ configPath, repo: 'lib' });
    assert.equal(repo('lib'), undefined);
    assert.ok(openStore(layout(root)).findingExists('lib', FP));
    addRepository({ configPath, entry: { provider: 'github', organization: 'owner', repo: 'lib' } });
    assert.ok(repo('lib'));
    assert.ok(openStore(layout(root)).findingExists('lib', FP));
  });

  it('refuses to remove the only repository', () => {
    removeRepository({ configPath, repo: 'lib' });
    assert.equal(
      statusOf(() => removeRepository({ configPath, repo: 'api' })),
      409,
    );
    assert.ok(repo('api'));
  });
});

describe('testRepository', () => {
  const env = { pat: process.env.REPOSCOUT_ADO_PAT, bearer: process.env.REPOSCOUT_ADO_BEARER };
  afterEach(() => {
    for (const [k, v] of [
      ['REPOSCOUT_ADO_PAT', env.pat],
      ['REPOSCOUT_ADO_BEARER', env.bearer],
    ] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  const stub = (answer: { code: number | null; stdout?: string; stderr?: string; timedOut?: boolean }) => {
    const calls: { args: string[]; env: NodeJS.ProcessEnv; timeoutMs: number }[] = [];
    const lsRemote: LsRemoteFn = async (args, e, timeoutMs) => {
      calls.push({ args, env: e, timeoutMs });
      return { stdout: '', stderr: '', timedOut: false, ...answer };
    };
    return { calls, lsRemote };
  };
  const ado = { provider: 'azure-devops', organization: 'org', project: 'p', repo: 'svc', branch: 'main' };

  it('reports a reachable branch and passes the token only through GIT_CONFIG_*', async () => {
    const pat = 'abcdefghijklmnopqrstuvwxyz234567abcdefghijklmnopqrst';
    process.env.REPOSCOUT_ADO_PAT = pat;
    delete process.env.REPOSCOUT_ADO_BEARER;
    const s = stub({ code: 0, stdout: 'deadbeef\trefs/heads/main\n' });
    const out = await testRepository({ root, configPath, entry: ado }, s);
    assert.equal(out.result, 'reachable');
    const call = s.calls[0];
    assert.deepEqual(call?.args, ['ls-remote', '--heads', 'https://dev.azure.com/org/p/_git/svc', 'refs/heads/main']);
    assert.equal(call?.timeoutMs, 20_000);
    assert.ok(!call?.args.join(' ').includes(pat));
    const header = Object.entries(call?.env ?? {}).find(([k, v]) => k.startsWith('GIT_CONFIG_VALUE_') && String(v).startsWith('Authorization: Basic'));
    assert.ok(header);
    assert.equal(call?.env.GIT_TERMINAL_PROMPT, '0');
  });

  it('reports a missing branch, no access, a timeout and a redacted failure', async () => {
    process.env.REPOSCOUT_ADO_BEARER = 'bearer-token-1234567890';
    assert.equal((await testRepository({ root, configPath, entry: ado }, stub({ code: 0, stdout: '' }))).result, 'branch-missing');
    const denied = await testRepository(
      { root, configPath, entry: ado },
      stub({ code: 128, stderr: 'remote: TF401019: The Git repository with name or identifier svc does not exist' }),
    );
    assert.equal(denied.result, 'no-access');
    assert.equal((await testRepository({ root, configPath, entry: ado }, stub({ code: null, timedOut: true }))).result, 'failed');
    const failed = await testRepository(
      { root, configPath, entry: ado },
      stub({ code: 1, stderr: 'fatal: Authorization: Bearer bearer-token-1234567890 rejected by proxy' }),
    );
    assert.ok(!failed.detail.includes('bearer-token-1234567890'), failed.detail);
  });

  it('says the token is missing without starting git', async () => {
    delete process.env.REPOSCOUT_ADO_PAT;
    delete process.env.REPOSCOUT_ADO_BEARER;
    const s = stub({ code: 0 });
    assert.deepEqual(await testRepository({ root, configPath, entry: ado }, s), { result: 'token-missing', detail: 'REPOSCOUT_ADO_PAT is not set' });
    assert.equal(s.calls.length, 0);
  });

  it('only reaches the provider’s fixed host and refuses a local entry', async () => {
    const s = stub({ code: 0, stdout: 'x\trefs/heads/main' });
    await testRepository({ root, configPath, entry: { provider: 'github', organization: 'owner', repo: 'lib' } }, s);
    assert.equal(s.calls[0]?.args[2], 'https://github.com/owner/lib.git');
    await assert.rejects(testRepository({ root, configPath, entry: { provider: 'local', organization: 'a', repo: 'x' } }, s), /provider must be/);
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

describe('the dashboard configuration endpoints', () => {
  let server: Server;
  let port: number;
  let serverRoot: string;
  const jira = fakeJira();
  const creds = { email: 'bot@acme.example', token: 'jira-token-abcdef123456' };
  const saved = { e: process.env.REPOSCOUT_JIRA_EMAIL, t: process.env.REPOSCOUT_JIRA_TOKEN };

  beforeAll(async () => {
    process.env.REPOSCOUT_JIRA_EMAIL = creds.email;
    process.env.REPOSCOUT_JIRA_TOKEN = creds.token;
    serverRoot = mkdtempSync(join(tmpdir(), 'reposcout-cfgsrv-'));
    writeFileSync(join(serverRoot, 'repos.yaml'), `jira:\n  site: https://acme.atlassian.net\n${CONFIG}`);
    const uiDir = join(serverRoot, 'web-dist');
    mkdirSync(uiDir, { recursive: true });
    writeFileSync(join(uiDir, 'index.html'), '<!doctype html>');
    server = await startServer({ root: serverRoot, uiDir, configPath: join(serverRoot, 'repos.yaml'), port: 0, pollMs: 50, deps: { jiraFetch: jira.fetch } });
    port = (server.address() as AddressInfo).port;
  });

  afterAll(() => {
    server.close();
    closeStores();
    if (saved.e === undefined) delete process.env.REPOSCOUT_JIRA_EMAIL;
    else process.env.REPOSCOUT_JIRA_EMAIL = saved.e;
    if (saved.t === undefined) delete process.env.REPOSCOUT_JIRA_TOKEN;
    else process.env.REPOSCOUT_JIRA_TOKEN = saved.t;
  });

  const token = async () => JSON.parse((await call(port, '/api/session')).body).token as string;

  it('refuses the checks without the session token, before calling Jira', async () => {
    const before = jira.calls.length;
    assert.equal((await call(port, '/api/checks')).status, 403);
    assert.equal(jira.calls.length, before);
  });

  it('serves the checks with the Jira account and never the credential', async () => {
    const res = await call(port, '/api/checks', { headers: { 'x-reposcout-token': await token() } });
    assert.equal(res.status, 200);
    const view = JSON.parse(res.body);
    assert.ok(view.env_loaded_at);
    const jiraCheck = view.checks.find((c: { name: string }) => c.name.startsWith('jira credential'));
    assert.equal(jiraCheck.ok, true);
    assert.ok(!res.body.includes(creds.token) && !res.body.includes(creds.email));
  });

  it('serves the effective configuration with no secret value', async () => {
    const res = await call(port, '/api/config');
    const view = JSON.parse(res.body);
    assert.deepEqual(
      view.repos.map((r: { name: string }) => r.name),
      ['api', 'lib'],
    );
    assert.equal(view.jira.token_env, 'REPOSCOUT_JIRA_TOKEN');
    assert.ok(!res.body.includes(creds.token) && !res.body.includes(creds.email));
  });

  it('runs an edit as an action and logs it', async () => {
    const res = await call(port, '/api/actions/config-set', {
      method: 'POST',
      headers: { origin: `http://127.0.0.1:${port}`, 'content-type': 'application/json', 'x-reposcout-token': await token() },
      body: JSON.stringify({ scope: 'repo', name: 'api', key: 'mode', value: 'full' }),
    });
    assert.equal(res.status, 200);
    const logs = join(serverRoot, 'reports');
    const day = readdirSync(logs)[0] as string;
    const log = readFileSync(join(logs, day, 'logs', 'dashboard-actions.jsonl'), 'utf8');
    assert.match(log, /"action":"config-set".*"ok":true/);
  });
});
