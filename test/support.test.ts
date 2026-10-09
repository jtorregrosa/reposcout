import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { buildManifest } from '../src/audit/manifest.js';
import { buildSettings, rulePath } from '../src/claude/settings.js';
import { parseConfig, type RepoConfig, remoteUrl } from '../src/config/config.js';
import { authHeaderFor, gitEnv } from '../src/git/git.js';
import { redact, registerSecret } from '../src/security/secrets.js';
import { matchesAny } from '../src/selection/glob.js';

describe('matchesAny', () => {
  it('matches double-star patterns at any depth, including the root', () => {
    assert.ok(matchesAny('node_modules/x/y.js', ['**/node_modules/**']));
    assert.ok(matchesAny('web/node_modules/x.js', ['**/node_modules/**']));
    assert.ok(matchesAny('a/b/c.min.js', ['**/*.min.js']));
  });

  it('keeps a single star within one path segment', () => {
    assert.ok(!matchesAny('src/a/b.cs', ['src/*.cs']));
    assert.ok(matchesAny('src/b.cs', ['src/*.cs']));
  });
});

describe('redact', () => {
  it('removes registered runtime secrets wherever they appear', () => {
    registerSecret('super-secret-pat-value-123');
    assert.equal(redact('token super-secret-pat-value-123 end'), 'token [REDACTED] end');
  });

  it('removes credential values but keeps their keys', () => {
    assert.equal(redact('Password=hunter2hunter2;Server=x'), 'Password=[REDACTED];Server=x');
    assert.equal(redact('"client_secret": "abcd1234efgh"'), '"client_secret": "[REDACTED]"');
  });

  it('removes authorization headers and credentials in URLs', () => {
    assert.equal(redact('Authorization: Basic OmFiY2RlZg=='), 'Authorization: Basic [REDACTED]');
    assert.equal(redact('https://user:pw@dev.azure.com/x'), 'https://[REDACTED]@dev.azure.com/x');
  });
});

describe('git auth', () => {
  it('passes the auth header through environment config, never through argv', () => {
    const env = gitEnv({
      authHeader: authHeaderFor({ pat: 'abc' }),
      hooksDir: '/tmp/none',
    });
    const keys = Object.keys(env)
      .filter((k) => k.startsWith('GIT_CONFIG_KEY_'))
      .map((k) => env[k]);
    assert.ok(keys.includes('http.extraHeader'));
    assert.ok(keys.includes('core.hooksPath'));
    assert.equal(env.GIT_TERMINAL_PROMPT, '0');
  });

  it('encodes a PAT as basic auth with an empty user', () => {
    assert.equal(authHeaderFor({ pat: 'abc' }), `Authorization: Basic ${Buffer.from(':abc').toString('base64')}`);
    assert.equal(authHeaderFor({ bearer: 'tok' }), 'Authorization: Bearer tok');
  });

  it('names a user when GitHub needs one', () => {
    const encoded = Buffer.from('x-access-token:abc').toString('base64');
    assert.equal(authHeaderFor({ pat: 'abc', user: 'x-access-token' }), `Authorization: Basic ${encoded}`);
  });
});

describe('providers', () => {
  const config = (defaults: string) => `defaults:\n${defaults}repos:\n  - { repo: demo }\n`;

  it('keeps Azure DevOps as the default provider', () => {
    const [repo] = parseConfig(config('  organization: org\n  project: p\n'));
    assert.equal(repo.provider, 'azure-devops');
    assert.equal(repo.pat_env, 'REPOSCOUT_ADO_PAT');
    assert.equal(remoteUrl(repo), 'https://dev.azure.com/org/p/_git/demo');
  });

  it('clones GitHub repositories by owner, with no project and an optional token', () => {
    const [repo] = parseConfig(config('  provider: github\n  organization: owner\n'));
    assert.equal(repo.project, 'owner');
    assert.equal(repo.pat_env, 'REPOSCOUT_GITHUB_TOKEN');
    assert.equal(remoteUrl(repo), 'https://github.com/owner/demo.git');
  });

  it('rejects an unknown provider', () => {
    assert.throws(() => parseConfig(config('  provider: gitlab\n  organization: o\n  project: p\n')), /unknown "provider"/);
  });
});

describe('owner facts', () => {
  const config = (defaults: string, entry = '') => `defaults:\n  organization: o\n  project: p\n${defaults}repos:\n  - repo: demo\n${entry}  - repo: other\n`;

  it('add the repository facts to the defaults, and reach the manifest redacted', () => {
    const [demo, other] = parseConfig(
      config('  facts:\n    - Every service runs behind the gateway.\n', '    facts:\n      - A federation has at most 3,000 members. token=abcdef123456\n'),
    );
    assert.deepEqual(demo?.facts, ['Every service runs behind the gateway.', 'A federation has at most 3,000 members. token=abcdef123456']);
    assert.deepEqual(other?.facts, ['Every service runs behind the gateway.']);
    const manifest = buildManifest({
      repo: demo as RepoConfig,
      cloneDir: '/w/demo',
      mode: 'full',
      base: null,
      head: 'abc',
      analyzers: ['performance'],
      diffPath: '/w/diff',
      selected: [],
      deleted: [],
      omitted: [],
      known: [],
      speculative: undefined,
      verifyDir: null,
      outputPath: '/w/out.json',
    });
    assert.equal(manifest.owner_facts[0], 'Every service runs behind the gateway.');
    assert.match(manifest.owner_facts[1] ?? '', /3,000 members\. token=\[REDACTED\]/);
  });

  it('default to none and reject entries that are not short sentences', () => {
    assert.deepEqual(parseConfig(config('')).at(0)?.facts, []);
    assert.throws(() => parseConfig(config('  facts: a federation is small\n')), /facts must be a list/);
    assert.throws(() => parseConfig(config(`  facts:\n    - "${'x'.repeat(501)}"\n`)), /at most 500 characters/);
  });
});

describe('permission rules', () => {
  it('writes absolute Windows paths with the drive as the first segment', () => {
    if (process.platform !== 'win32') return;
    assert.equal(rulePath('D:\\Repos\\x\\out.json'), '//d/Repos/x/out.json');
  });

  it('allows writing only the raw output file, and test runs only when verification is configured', () => {
    const s = buildSettings({
      rootDir: '/r',
      cloneDir: '/r/workspace/a',
      workDir: '/r/reports/d/.work/a',
      outputFile: '/r/reports/d/.work/a/raw.json',
      verifyDir: null,
      testCommand: null,
    });
    const edits = s.permissions.allow.filter((r) => r.startsWith('Edit('));
    assert.equal(edits.length, 1);
    assert.match(edits[0], /raw\.json\)$/);
    assert.ok(!s.permissions.allow.some((r) => r.startsWith('Bash(cd ')));
    assert.ok(s.permissions.deny.some((r) => r.includes('workspace/a/**')));
  });

  it('never allows reading outside the clone and the audit work directory', () => {
    const s = buildSettings({
      rootDir: '/r',
      cloneDir: '/r/workspace/a',
      workDir: '/r/reports/d/.work/a',
      outputFile: '/r/reports/d/.work/a/raw.json',
      verifyDir: null,
      testCommand: null,
    });
    const reads = s.permissions.allow.filter((r) => /^(Read|Grep|Glob)\b/.test(r));
    assert.ok(!reads.some((r) => !r.includes('(')), 'an unscoped Read/Grep/Glob rule would expose the whole disk');
    const outside = reads.filter((r) => !r.includes('/r/workspace/a/**') && !r.includes('/r/reports/d/.work/a/**'));
    assert.deepEqual(
      outside.map((r) => r.replace(/^.*\.claude-home/, '.claude-home')),
      ['.claude-home/projects/*/*/tool-results/**)'],
    );
  });

  it('lets agents read saved tool results but no other part of the private config dir', () => {
    const s = buildSettings({
      rootDir: '/r',
      cloneDir: '/r/workspace/a',
      workDir: '/r/reports/d/.work/a',
      outputFile: '/r/reports/d/.work/a/raw.json',
      verifyDir: null,
      testCommand: null,
    });
    const homeDenies = s.permissions.deny.filter((r) => r.includes('.claude-home'));
    // `*` in a rule crosses `/`, so a wildcard directly under .claude-home would also hide tool-results.
    assert.ok(!homeDenies.some((r) => /\.claude-home\/\*/.test(r)), homeDenies.join('\n'));
    assert.ok(homeDenies.some((r) => r.endsWith('/session-env/**)')));
    assert.ok(homeDenies.some((r) => r.endsWith('/.claude.json)')));
  });
});
