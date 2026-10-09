import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, it } from 'vitest';
import { claudeCommand } from '../src/claude/session.js';
import { buildSettings, rulePath } from '../src/claude/settings.js';
import { ALLOW_LOCAL_ENV, parseConfig, remoteUrl } from '../src/config/config.js';
import { gitEnv } from '../src/git/git.js';

// The seams the end-to-end tests and the evaluation use: a replaceable claude, a separate data root, a local provider.

const gitConfig = (env: NodeJS.ProcessEnv) =>
  Object.fromEntries(Array.from({ length: Number(env.GIT_CONFIG_COUNT) }, (_, i) => [env[`GIT_CONFIG_KEY_${i}`], env[`GIT_CONFIG_VALUE_${i}`]]));

describe('REPOSCOUT_CLAUDE_BIN', () => {
  it('runs claude from PATH by default', () => {
    assert.deepEqual(claudeCommand(['--version'], {}), { command: 'claude', args: ['--version'] });
  });

  it('runs another executable in its place', () => {
    assert.deepEqual(claudeCommand(['-p', 'x'], { REPOSCOUT_CLAUDE_BIN: '/opt/claude-next' }), { command: '/opt/claude-next', args: ['-p', 'x'] });
  });

  it('runs a .js or .mjs script with this Node, with no shell', () => {
    const r = claudeCommand(['--version'], { REPOSCOUT_CLAUDE_BIN: 'test/e2e/fake-claude.mjs' });
    assert.equal(r.command, process.execPath);
    assert.deepEqual(r.args, [resolve('test/e2e/fake-claude.mjs'), '--version']);
  });
});

describe('provider: local', () => {
  const saved = process.env[ALLOW_LOCAL_ENV];
  afterEach(() => {
    if (saved === undefined) delete process.env[ALLOW_LOCAL_ENV];
    else process.env[ALLOW_LOCAL_ENV] = saved;
  });
  const yaml = 'repos:\n  - provider: local\n    path: ../origin/demo\n';

  it('is refused unless REPOSCOUT_ALLOW_LOCAL_PROVIDER=1', () => {
    delete process.env[ALLOW_LOCAL_ENV];
    assert.throws(
      () => parseConfig(yaml, '/data/repos.yaml'),
      /provider "local", which is only for tests and evaluation; set REPOSCOUT_ALLOW_LOCAL_PROVIDER=1/,
    );
    process.env[ALLOW_LOCAL_ENV] = 'true';
    assert.throws(() => parseConfig(yaml, '/data/repos.yaml'), /REPOSCOUT_ALLOW_LOCAL_PROVIDER=1/);
  });

  it('needs a path, resolved against the config file, and names itself after it', () => {
    process.env[ALLOW_LOCAL_ENV] = '1';
    assert.throws(() => parseConfig('repos:\n  - provider: local\n    name: demo\n', '/data/repos.yaml'), /without a "path"/);
    const [repo] = parseConfig(yaml, '/data/repos.yaml');
    assert.equal(repo?.path, resolve('/origin/demo'));
    assert.equal(repo?.name, 'demo');
    assert.equal(remoteUrl(repo as NonNullable<typeof repo>), pathToFileURL(resolve('/origin/demo')).href);
  });

  it('is the only provider git may use the file protocol for', () => {
    assert.equal(gitConfig(gitEnv({ authHeader: null, hooksDir: '/h' }))['protocol.file.allow'], 'never');
    assert.equal(gitConfig(gitEnv({ authHeader: null, hooksDir: '/h', allowFileProtocol: true }))['protocol.file.allow'], 'always');
  });
});

describe('REPOSCOUT_HOME', () => {
  it('keeps .env and the private config dir in the data root, and denies edits to both roots', () => {
    const s = buildSettings({
      rootDir: '/pkg',
      dataDir: '/data',
      cloneDir: '/data/workspace/a',
      workDir: '/data/reports/d/.work/a',
      outputFile: '/data/reports/d/.work/a/raw.json',
      verifyDir: null,
      testCommand: null,
    });
    assert.ok(s.permissions.deny.includes(`Read(${rulePath(join('/data', '.env'))})`));
    assert.ok(s.permissions.allow.some((r) => r.startsWith(`Read(${rulePath(join('/data', '.claude-home'))}/`)));
    for (const dir of [join('/pkg', '.claude'), join('/pkg', 'src'), join('/data', 'state')]) {
      assert.ok(s.permissions.deny.includes(`Edit(${rulePath(dir)}/**)`), dir);
    }
  });
});
