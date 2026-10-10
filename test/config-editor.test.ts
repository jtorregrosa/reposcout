import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'vitest';
import { parse } from 'yaml';
import { parseConfig } from '../src/config/config.js';
import { checkValue, type FieldView, getPath, resolveConfig } from '../src/config/editable.js';

const YAML = `
defaults:
  organization: org
  project: p
  max_turns_note: ignored
  claude:
    models:
      verifier: opus
  excluded_paths: ["docs/**"]
  facts: ["Runs behind a gateway."]
  focus_paths: ["src/**"]
jira:
  site: https://acme.atlassian.net
repos:
  - name: api
    repo: api
    claude:
      models:
        specialists: haiku
      max_turns: 80
    excluded_paths: ["scripts/**"]
    focus_paths: ["api/**"]
    jira:
      project: API
  - repo: lib
    provider: github
    organization: owner
notifications:
  webhooks:
    - name: team
      url_env: REPOSCOUT_TEAM_WEBHOOK
      format: teams
`;

const field = (fields: FieldView[], key: string) => {
  const f = fields.find((x) => x.key === key);
  assert.ok(f, `no field ${key}`);
  return f;
};

describe('resolveConfig', () => {
  const view = resolveConfig(YAML);
  const api = view.repos.find((r) => r.name === 'api')?.fields ?? [];
  const lib = view.repos.find((r) => r.name === 'lib')?.fields ?? [];

  it('labels each value with where it comes from', () => {
    assert.deepEqual(
      { value: field(api, 'claude.models.specialists').value, origin: field(api, 'claude.models.specialists').origin },
      { value: 'haiku', origin: 'repo' },
    );
    assert.equal(field(api, 'claude.models.verifier').origin, 'defaults');
    assert.equal(field(api, 'claude.models.orchestrator').origin, 'built-in');
    assert.equal(field(api, 'claude.models.orchestrator').value, 'sonnet');
    assert.equal(field(api, 'max_files_full_run').origin, 'unset');
  });

  it('marks derived keys', () => {
    assert.deepEqual([field(lib, 'name').value, field(lib, 'name').origin], ['lib', 'derived']);
    assert.deepEqual([field(lib, 'pat_env').value, field(lib, 'pat_env').origin], ['REPOSCOUT_GITHUB_TOKEN', 'derived']);
    assert.deepEqual([field(api, 'pat_env').value, field(api, 'pat_env').origin], ['REPOSCOUT_ADO_PAT', 'derived']);
    const github = resolveConfig('repos:\n  - { provider: github, organization: owner, repo: lib }\n').repos[0]?.fields ?? [];
    assert.deepEqual([field(github, 'project').value, field(github, 'project').origin], ['owner', 'derived']);
    assert.equal(field(api, 'project').origin, 'defaults');
  });

  it('splits the lists that add up and lets the others replace', () => {
    const excluded = field(api, 'excluded_paths');
    assert.deepEqual([excluded.inherited, excluded.own, excluded.value], [['docs/**'], ['scripts/**'], ['docs/**', 'scripts/**']]);
    const facts = field(lib, 'facts');
    assert.deepEqual([facts.inherited, facts.own, facts.origin], [['Runs behind a gateway.'], [], 'defaults']);
    assert.deepEqual([field(api, 'focus_paths').value, field(api, 'focus_paths').origin], [['api/**'], 'repo']);
    assert.deepEqual([field(lib, 'focus_paths').value, field(lib, 'focus_paths').origin], [['src/**'], 'defaults']);
  });

  it('says why a key is read-only', () => {
    assert.equal(field(api, 'test_command').editable, false);
    assert.match(field(api, 'test_command').reason ?? '', /what runs on this machine/);
    assert.match(field(api, 'pat_env').reason ?? '', /credential/);
    assert.equal(field(api, 'branch').editable, true);
  });

  it('counts the repositories that inherit and override a default', () => {
    const turns = field(view.defaults, 'claude.max_turns');
    assert.deepEqual([turns.inherited_by, turns.overridden_by, turns.origin, turns.value], [1, 1, 'built-in', 60]);
    assert.equal(field(view.defaults, 'claude.models.verifier').origin, 'defaults');
    assert.equal(
      view.defaults.some((f) => f.key === 'name'),
      false,
    );
    assert.deepEqual([field(view.defaults, 'provider').value, field(view.defaults, 'provider').origin], ['azure-devops', 'built-in']);
    assert.deepEqual([field(view.defaults, 'pat_env').value, field(view.defaults, 'pat_env').origin], [undefined, 'unset']);
  });

  it('shows webhooks with only their delivery settings editable', () => {
    const hook = view.webhooks[0];
    assert.equal(hook?.name, 'team');
    assert.deepEqual(
      hook?.fields.filter((f) => f.editable).map((f) => f.key),
      ['format', 'min_severity', 'on_failure'],
    );
    assert.deepEqual([field(hook?.fields ?? [], 'min_severity').value, field(hook?.fields ?? [], 'min_severity').origin], ['high', 'built-in']);
  });

  it('agrees with the run parser for every value it attributes to a scope', () => {
    for (const file of ['test/repos.fixture.yaml', 'repos.example.yaml']) {
      const text = readFileSync(file, 'utf8');
      const runs = parseConfig(text);
      const raw = parse(text);
      for (const [i, repo] of resolveConfig(text).repos.entries()) {
        for (const f of repo.fields) {
          assert.deepEqual(f.value, getPath(runs[i], f.key), `${file} ${repo.name} ${f.key}`);
          if (f.inherited) continue;
          if (f.origin === 'repo') assert.deepEqual(f.value, getPath(raw.repos[i], f.key), `${file} ${repo.name} ${f.key}`);
          if (f.origin === 'defaults') assert.deepEqual(f.value, getPath(raw.defaults, f.key), `${file} ${repo.name} ${f.key}`);
        }
      }
    }
  });
});

describe('checkValue', () => {
  it('names the field in its error', () => {
    assert.throws(() => checkValue('repo', 'max_files_per_run', 500), /Files per run max_files_per_run must be an integer from 1 to 150/);
    assert.throws(() => checkValue('repo', 'claude.models.verifier', 'gpt'), /Verifier model uses unknown model "gpt"/);
    assert.throws(() => checkValue('repo', 'analyzers', ['nope']), /unknown analyzer "nope"/);
  });

  it('refuses keys outside the editable list', () => {
    for (const key of ['test_command', 'pat_env', 'claude.auth', 'organization', 'name', 'jira.fields', 'suppressed']) {
      assert.throws(
        () => checkValue('repo', key, 'x'),
        (e: { status: number }) => e.status === 400,
        key,
      );
    }
    assert.throws(() => checkValue('webhook', 'url_env', 'REPOSCOUT_X'), /cannot be changed/);
    assert.throws(() => checkValue('defaults', 'format', 'teams'), /cannot be changed/);
  });

  it('normalizes analyzers to their canonical order', () => {
    assert.deepEqual(checkValue('repo', 'analyzers', ['logic', 'security']), ['security', 'logic']);
  });
});
