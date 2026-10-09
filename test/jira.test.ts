import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'vitest';
import { parseConfig, parseJiraSite } from '../src/config/config.js';
import { findingDescription, fingerprintLabel, issueSummary } from '../src/jira/adf.js';
import { createJiraClient, JiraError, jiraCredentials, segment } from '../src/jira/client.js';
import { checkParent, issueWithLabel, projectSprints, searchParents, searchUsers } from '../src/jira/lookups.js';
import { buildFields, clearMetadataCache, issueTypeId, rawFields } from '../src/jira/metadata.js';
import { toJiraFields } from '../src/jira/values.js';
import { redact } from '../src/security/secrets.js';
import { fakeJira } from './fake-jira.js';

const SITE = 'jira:\n  site: https://acme.atlassian.net\n';
const repos = (extra: string) =>
  `${SITE}defaults:\n  organization: org\n  project: p\n${extra}repos:\n  - name: api\n    repo: api\n    jira:\n      project: API\n      fields: { Severity: High }\n`;

const creds = { site: 'https://acme.atlassian.net', email: 'bot@acme.example', token: 'tok-1234567890abcdef' };

describe('Jira configuration', () => {
  it('reads the site with the default credential variables', () => {
    assert.deepEqual(parseJiraSite(SITE), { site: 'https://acme.atlassian.net', email_env: 'REPOSCOUT_JIRA_EMAIL', token_env: 'REPOSCOUT_JIRA_TOKEN' });
    assert.equal(parseJiraSite('repos: []\n'), null);
  });

  it('refuses a site outside Jira Cloud and a token in the file', () => {
    assert.throws(() => parseJiraSite('jira:\n  site: http://jira.example.com\n'), /must be https:\/\/<name>\.atlassian\.net/);
    assert.throws(() => parseJiraSite(`${SITE}  token: abc\n`), /unknown key/);
    assert.throws(() => parseJiraSite(`${SITE}  token_env: JIRA_TOKEN\n`), /REPOSCOUT_<something>/);
  });

  it('merges a repository target with the defaults, fields per key and labels replaced', () => {
    const [repo] = parseConfig(repos('  jira:\n    issue_type: Bug\n    labels: [security]\n    fields: { Team: Security }\n'));
    assert.deepEqual(repo?.jira, { project: 'API', issue_type: 'Bug', labels: ['security'], fields: { Team: 'Security', Severity: 'High' } });
    const [own] = parseConfig(
      `${SITE}defaults:\n  organization: org\n  project: p\n  jira: { labels: [a] }\nrepos:\n  - { name: api, repo: api, jira: { labels: [b] } }\n`,
    );
    assert.deepEqual(own?.jira?.labels, ['b']);
  });

  it('refuses a target without the top-level site, and keys it does not know', () => {
    assert.throws(
      () => parseConfig('defaults:\n  organization: org\n  project: p\nrepos:\n  - { name: api, repo: api, jira: { project: API } }\n'),
      /needs the top-level jira\.site/,
    );
    assert.throws(() => parseConfig(repos('').replace('project: API', 'project: api')), /not a Jira project key/);
    assert.throws(() => parseConfig(repos('').replace('project: API', 'project: API\n      board: 7')), /unknown key/);
  });
});

describe('the Jira client', () => {
  let saved: Record<string, string | undefined>;
  beforeEach(() => {
    saved = { e: process.env.REPOSCOUT_JIRA_EMAIL, t: process.env.REPOSCOUT_JIRA_TOKEN };
  });
  afterEach(() => {
    process.env.REPOSCOUT_JIRA_EMAIL = saved.e;
    process.env.REPOSCOUT_JIRA_TOKEN = saved.t;
    if (saved.e === undefined) delete process.env.REPOSCOUT_JIRA_EMAIL;
    if (saved.t === undefined) delete process.env.REPOSCOUT_JIRA_TOKEN;
  });

  it('names the variable that is missing, and redacts the token once read', () => {
    delete process.env.REPOSCOUT_JIRA_TOKEN;
    process.env.REPOSCOUT_JIRA_EMAIL = 'bot@acme.example';
    const site = { site: creds.site, email_env: 'REPOSCOUT_JIRA_EMAIL', token_env: 'REPOSCOUT_JIRA_TOKEN' };
    assert.throws(() => jiraCredentials(site), /REPOSCOUT_JIRA_TOKEN/);
    process.env.REPOSCOUT_JIRA_TOKEN = 'secret-token-value-123';
    jiraCredentials(site);
    assert.equal(redact('it said secret-token-value-123'), 'it said [REDACTED]');
  });

  it('sends Basic auth to the configured site only', async () => {
    const jira = fakeJira();
    await createJiraClient(creds, { fetchFn: jira.fetch }).get('/rest/api/3/myself');
    assert.equal(jira.calls[0]?.auth, `Basic ${Buffer.from(`${creds.email}:${creds.token}`).toString('base64')}`);
    await assert.rejects(createJiraClient(creds, { fetchFn: jira.fetch }).get('https://evil.example/steal'), /outside the configured site/);
  });

  it('never follows a redirect', async () => {
    const jira = fakeJira();
    jira.failNext(302, { location: 'https://evil.example/' });
    await assert.rejects(createJiraClient(creds, { fetchFn: jira.fetch }).get('/rest/api/3/myself'), /redirect/);
    assert.equal(jira.calls.length, 1);
  });

  it('waits once for Retry-After on 429, capped at ten seconds', async () => {
    const jira = fakeJira();
    const waits: number[] = [];
    jira.failNext(429, { retryAfter: 60 });
    const me = await createJiraClient(creds, { fetchFn: jira.fetch, sleep: async (ms) => void waits.push(ms) }).get<{ displayName: string }>(
      '/rest/api/3/myself',
    );
    assert.equal(me.displayName, 'Reporter bot');
    assert.deepEqual(waits, [10_000]);
  });

  it('maps Jira errors per field and redacts them', async () => {
    const jira = fakeJira();
    jira.failNext(400, { body: { errorMessages: [`token ${creds.token} rejected`], errors: { customfield_100: 'Team is required.' } } });
    redact(creds.token);
    const e = await createJiraClient(creds, { fetchFn: jira.fetch })
      .post('/rest/api/3/issue', {})
      .catch((x: unknown) => x);
    assert.ok(e instanceof JiraError);
    assert.equal(e.status, 400);
    assert.deepEqual(e.fields, { customfield_100: 'Team is required.' });
    assert.match(e.message, /Team is required/);
  });

  it('encodes values that reach a path', () => {
    assert.equal(segment('../../rest/api/3/user'), '..%2F..%2Frest%2Fapi%2F3%2Fuser');
  });
});

describe('create metadata', () => {
  beforeEach(() => clearMetadataCache());
  const client = () => createJiraClient(creds, { fetchFn: fakeJira().fetch });

  it('lists required fields and those with defaults, resolving defaults by name and option value', async () => {
    const c = client();
    const raw = await rawFields(c, 'API', await issueTypeId(c, 'API', 'bug'));
    const { fields, unknown } = buildFields(raw, { Severity: 'High', customfield_102: 3, Nonexistent: 1 });
    assert.deepEqual(
      fields.map((f) => [f.id, f.kind, f.required, f.default ?? null]),
      [
        ['customfield_100', 'select', true, null],
        ['customfield_101', 'select', false, '10'],
        ['customfield_102', 'number', false, 3],
      ],
    );
    assert.deepEqual(unknown, [{ key: 'Nonexistent', error: 'Nonexistent is not a field this issue type offers' }]);
  });

  it('keeps a default that is not an option as an error on its field', async () => {
    const c = client();
    const { fields } = buildFields(await rawFields(c, 'API', '1'), { Severity: 'Urgent' });
    assert.match(fields.find((f) => f.id === 'customfield_101')?.error ?? '', /not one of its options: Urgent/);
  });

  it('marks a field of a type it cannot fill in', async () => {
    const c = client();
    const { fields } = buildFields(await rawFields(c, 'API', '1'), { Area: 'x' });
    assert.equal(fields.find((f) => f.id === 'customfield_106')?.kind, 'unsupported');
  });

  it('refuses an issue type the project does not offer, naming the ones it does', async () => {
    await assert.rejects(issueTypeId(client(), 'API', 'Story'), /offers Bug, Epic/);
  });
});

describe('field values', () => {
  const specs = buildFields(
    [
      { fieldId: 'customfield_100', name: 'Team', required: true, schema: { type: 'option' }, allowedValues: [{ id: '1', value: 'Security' }] },
      { fieldId: 'customfield_102', name: 'Points', required: false, schema: { type: 'number' } },
      { fieldId: 'customfield_103', name: 'Sprint', required: false, schema: { custom: 'com.pyxis.greenhopper.jira:gh-sprint' } },
      { fieldId: 'customfield_104', name: 'Owner', required: false, schema: { type: 'user' } },
      { fieldId: 'customfield_105', name: 'Due', required: false, schema: { type: 'date' } },
    ],
    { Points: 1, Sprint: 1, Owner: 'x', Due: '2026-10-10' },
  ).fields;

  it('sends each kind in Jira shape', () => {
    assert.deepEqual(
      toJiraFields(specs, { customfield_100: '1', customfield_102: 5, customfield_103: 42, customfield_104: 'acc-1', customfield_105: '2026-11-01' }),
      {
        customfield_100: { id: '1' },
        customfield_102: 5,
        customfield_103: 42,
        customfield_104: { accountId: 'acc-1' },
        customfield_105: '2026-11-01',
      },
    );
  });

  it('names every field that is missing or does not fit', () => {
    const e = (() => {
      try {
        toJiraFields(specs, { customfield_105: '10/11/2026', customfield_999: 'x' });
      } catch (x) {
        return x as JiraError;
      }
    })();
    assert.ok(e instanceof JiraError);
    assert.deepEqual(Object.keys(e.fields).sort(), ['customfield_100', 'customfield_105', 'customfield_999']);
    assert.match(e.message, /Team is required/);
  });

  it('refuses an option the field does not allow', () => {
    assert.throws(() => toJiraFields(specs, { customfield_100: '9' }), /Team does not allow 9/);
  });
});

describe('the issue description', () => {
  const finding = {
    fingerprint: 'a'.repeat(32),
    repo: 'api',
    commit: 'abcdef1234567890',
    file: 'src/Orders.cs',
    line: 42,
    category: 'security' as const,
    severity: 'high' as const,
    kind: 'vulnerability' as const,
    description: 'h1. Not a heading <script>alert(1)</script>',
    scenario: 'First paragraph.\n\nSecond paragraph.',
    suggested_fix: 'Parameterize the query.',
    snippet: 'var sql = "SELECT " + input;',
    repro: { preconditions: ['A user'], steps: ['Post the form', 'Read the response'], expected: '400', actual: '500' },
  };

  it('holds every section as plain text nodes, markup included literally', () => {
    const doc = findingDescription(finding);
    const texts: string[] = [];
    const walk = (n: { type: string; text?: string; content?: unknown[] }) => {
      if (n.type === 'text') texts.push(n.text ?? '');
      for (const c of (n.content ?? []) as (typeof n)[]) walk(c);
    };
    walk(doc as never);
    for (const s of ['Scenario', 'Why it is a bug', 'How to reproduce', 'Code at line 42', 'Suggested fix', finding.fingerprint, 'Second paragraph.']) {
      assert.ok(
        texts.some((t) => t.includes(s)),
        `missing ${s}`,
      );
    }
    assert.ok(texts.includes(finding.description));
    assert.equal(JSON.stringify(doc).includes('"type":"codeBlock","attrs":{"language":"csharp"}'), true);
  });

  it('keeps the summary to one line of 255 characters', () => {
    assert.equal(issueSummary('a\nb'), 'a b');
    assert.equal(issueSummary('x'.repeat(300)).length, 255);
    assert.equal(fingerprintLabel('ab'), 'reposcout-ab');
  });
});

describe('lookups', () => {
  const client = () => createJiraClient(creds, { fetchFn: fakeJira().fetch });

  it('searches parents one hierarchy level up, open only', async () => {
    const jira = fakeJira();
    const c = createJiraClient(creds, { fetchFn: jira.fetch });
    assert.deepEqual(await searchParents(c, 'API', '1', 'checkout'), [{ key: 'API-1', summary: 'Checkout hardening', type: 'Epic' }]);
    const jql = jira.calls.find((x) => x.path === '/rest/api/3/search/jql')?.query.jql ?? '';
    assert.match(jql, /issuetype in \(2\) AND statusCategory != Done AND summary ~ "checkout\*"/);
  });

  it('keeps search text inside its JQL string', async () => {
    const jira = fakeJira();
    await searchParents(createJiraClient(creds, { fetchFn: jira.fetch }), 'API', '1', 'x" OR project = OTHER');
    const jql = jira.calls.find((x) => x.path === '/rest/api/3/search/jql')?.query.jql ?? '';
    assert.match(jql, /AND summary ~ "x +OR project = OTHER\*" ORDER BY updated DESC$/);
  });

  it('accepts a parent only when its type can be one', async () => {
    assert.equal((await checkParent(client(), 'API', '1', 'API-1')).key, 'API-1');
    await assert.rejects(checkParent(client(), 'API', '1', 'API-77'), /does not exist/);
  });

  it('lists assignable people, active sprints first, and finds an issue by its label', async () => {
    assert.deepEqual(await searchUsers(client(), 'API', 'ada'), [{ account_id: 'acc-1', name: 'Ada Lovelace' }]);
    assert.deepEqual(
      (await projectSprints(client(), 'API')).map((s) => s.id),
      [42, 43],
    );
    assert.equal(await issueWithLabel(client(), 'API', 'reposcout-none'), null);
  });
});
