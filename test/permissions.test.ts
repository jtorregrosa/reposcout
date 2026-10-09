import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'vitest';
import { claudeEnv } from '../src/claude/session.js';
import { buildSettings, type ClaudeSettings, toPosix } from '../src/claude/settings.js';
import { parseConfig } from '../src/config/config.js';
import { sandboxSupported, verificationFor, verificationState } from '../src/security/sandbox.js';

// Claude Code's documented Bash rule semantics: the rule is matched against the whole command text as written,
// `*` stands for any text (spaces included), a trailing ` *` that is the only wildcard also matches the bare
// command, and `:*` at the end is the same as ` *`. Deny rules apply when any subcommand matches; in dontAsk
// mode, a command is allowed only when every subcommand (or the command as a whole) matches an allow rule.
// Whether `\*` and `\\` are escapes is not documented, so every rule set is checked under both readings.
const READINGS = [{ escapes: false }, { escapes: true }];

function matches(rule: string, command: string, escapes = false): boolean {
  const body = /^Bash\(([\s\S]*)\)$/.exec(rule)?.[1];
  if (body == null) return false;
  const pattern = body.endsWith(':*') ? `${body.slice(0, -2)} *` : body;
  const literal = (s: string) => s.replace(/[.+?^${}()|[\]\\*]/g, '\\$&');
  let re = '';
  let stars = 0;
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (escapes && c === '\\' && (pattern[i + 1] === '*' || pattern[i + 1] === '\\')) re += literal(pattern[++i]);
    else if (/\s/.test(c)) re += ' ';
    else if (c === '*') {
      re += '[\\s\\S]*';
      stars++;
    } else re += literal(c);
  }
  if (new RegExp(`^${re}$`).test(command.replace(/\s/g, ' '))) return true;
  return stars === 1 && pattern.endsWith(' *') && command === pattern.slice(0, -2);
}

const subcommands = (command: string) =>
  command
    .split(/&&|\|\||\|&|[;|&\n]/)
    .map((s) => s.trim())
    .filter(Boolean);

function decide(settings: ClaudeSettings, command: string, escapes = false): 'allow' | 'deny' {
  const { allow, deny } = settings.permissions;
  const parts = subcommands(command);
  const hit = (rules: string[], p: string) => rules.some((r) => matches(r, p, escapes));
  if ([command, ...parts].some((p) => hit(deny, p))) return 'deny';
  return hit(allow, command) || parts.every((p) => hit(allow, p)) ? 'allow' : 'deny';
}

const base = {
  rootDir: '/r',
  cloneDir: '/r/workspace/a',
  workDir: '/r/reports/d/.work/a',
  outputFile: '/r/reports/d/.work/a/raw.json',
};
const clone = toPosix(base.cloneDir);
const git = `git -C ${clone}`;

describe('the rule matcher used by these tests', () => {
  it('follows the documented examples', () => {
    assert.ok(matches('Bash(git log *)', 'git log'));
    assert.ok(matches('Bash(ls:*)', 'ls -la'));
    assert.ok(matches('Bash(a\\*)', 'a\\b'));
    assert.ok(matches('Bash(a\\\\*)', 'a\\b', true));
    assert.ok(!matches('Bash(a\\*)', 'a\\b', true));
    assert.ok(matches('Bash(ls *)', 'ls -la'));
    assert.ok(matches('Bash(ls *)', 'ls'));
    assert.ok(!matches('Bash(ls *)', 'lsof'));
    assert.ok(matches('Bash(ls*)', 'lsof'));
    assert.ok(matches('Bash(* --help *)', 'npm --help x'));
    assert.ok(!matches('Bash(* --help *)', 'npm --help'));
    assert.ok(!matches('Bash(npm run build)', 'npm run build --watch'));
  });
});

describe('git read commands', () => {
  const s = buildSettings({ ...base, verifyDir: null, testCommand: null });

  it('still allow what the verifier and orchestrator need', () => {
    for (const command of [
      `${git} log --oneline -5 -- src/a.cs`,
      `${git} log -p abc123..def456 -- src/a.cs`,
      `${git} show --stat --format=%H HEAD`,
      `${git} log --format="%h %an %s" -3`,
      `${git} log -L 10,20:src/a.cs`,
      `${git} log ..main`,
      `${git} show abc123:src/a.cs`,
      `${git} show HEAD~1 -- src/dir/file.ts`,
    ]) {
      for (const { escapes } of READINGS) assert.equal(decide(s, command, escapes), 'allow', `${command} (escapes: ${escapes})`);
    }
  });

  it('give agents no git diff at all, which reads files outside the clone even through $HOME', () => {
    for (const command of [`${git} diff`, `${git} diff abc123..def456 -- src/a.cs`, `${git} diff --stat HEAD~3 HEAD`]) {
      for (const { escapes } of READINGS) assert.equal(decide(s, command, escapes), 'deny', `${command} (escapes: ${escapes})`);
    }
    assert.ok(!s.permissions.allow.some((r) => r.includes(' diff')));
  });

  it('never add a deny rule made only of wildcards and whitespace, which would deny every command', () => {
    for (const r of s.permissions.deny) assert.doesNotMatch(r, /^Bash\([*\s]*\)$/, r);
  });

  it('deny reading files outside the clone through diff --no-index or its implicit fallback', () => {
    for (const command of [
      `${git} diff --no-index /dev/null C:/Users/me/.env`,
      `${git} diff --no-index a.txt b.txt`,
      `${git} diff /dev/null C:/Users/me/.env`,
      `${git} diff HEAD -- /etc/passwd`,
      `${git} diff C:/Users/me/.env src/a.cs`,
      `${git} diff "C:\\Users\\me\\.env" src/a.cs`,
      `${git} diff 'C:\\Users\\me\\.env' src/a.cs`,
      `${git} diff src/a.cs C:\\Users\\me\\.env`,
      `${git} diff C:secret.txt src/a.cs`,
      `${git} diff "/c/Users/me/.env" src/a.cs`,
      `${git} diff '/c/Users/me/.env' src/a.cs`,
      `${git} diff \\\\server\\share\\secret src/a.cs`,
      `${git} diff ../../.env ../../repos.yaml`,
      `${git} diff src/../../../.env src/a.cs`,
      `${git} diff ..\\..\\.env src/a.cs`,
      `${git} diff .. src`,
      `${git} diff src ..`,
      `${git} diff ".." src`,
      `${git} diff ~/.ssh/id_rsa src/a.cs`,
      `${git} diff {,/etc/passwd} {,/dev/null}`,
      `${git} diff HEAD\t/etc/passwd\t/dev/null`,
      `${git} log -- ../other-repo`,
      `${git} show HEAD -- /etc/passwd`,
      `${git} diff --output=/tmp/x HEAD`,
    ]) {
      for (const { escapes } of READINGS) assert.equal(decide(s, command, escapes), 'deny', `${command} (escapes: ${escapes})`);
    }
  });

  it('deny variable expansion, which would paste the environment into an allowed command', () => {
    assert.equal(decide(s, `${git} log --grep=$CLAUDE_CODE_OAUTH_TOKEN`), 'deny');
    assert.equal(decide(s, `${git} diff \${HOME}/.env src/a.cs`), 'deny');
    assert.ok(s.permissions.deny.includes('Bash(*$(*)'), 'the existing command-substitution deny stays');
  });
});

describe('claudeEnv', () => {
  it('scrubs Claude credentials from every Bash subprocess', () => {
    const env = claudeEnv({ rootDir: mkdtempSync(join(tmpdir(), 'reposcout-')), auth: 'login' });
    assert.equal(env.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB, '1');
  });
});

describe('test_command', () => {
  const root = mkdtempSync(join(tmpdir(), 'reposcout-root-'));
  for (const d of ['src', 'state', 'node_modules', 'workspace/a', 'workspace/other', 'workspace/.no-hooks', 'workspace/.verify/a', 'workspace/.verify/b']) {
    mkdirSync(join(root, d), { recursive: true });
  }
  writeFileSync(join(root, '.env'), 'X=1\n');
  const verifyDir = join(root, 'workspace', '.verify', 'a');
  const paths = {
    rootDir: root,
    cloneDir: join(root, 'workspace', 'a'),
    workDir: join(root, 'reports', '.work', 'a'),
    outputFile: join(root, 'reports', '.work', 'a', 'raw.json'),
    verifyDir,
    testCommand: 'pnpm test',
  };
  const verify = toPosix(verifyDir);

  it('may run exactly as configured, without appended arguments', () => {
    const s = buildSettings({ ...paths, platform: 'linux' });
    assert.equal(decide(s, `cd ${verify} && pnpm test`), 'allow');
    assert.equal(decide(s, `cd ${verify} && pnpm test --reporter=x`), 'deny');
    assert.equal(decide(s, `cd ${verify} && pnpm test -- -t foo`), 'deny');
    assert.ok(!s.permissions.allow.some((r) => r.includes('pnpm test *')));
  });

  it('runs in a sandbox with no network and writes only in the verification worktree', () => {
    for (const platform of ['linux', 'darwin'] as const) {
      const sandbox = buildSettings({ ...paths, platform }).sandbox;
      assert.ok(sandbox, platform);
      assert.equal(sandbox.enabled, true);
      assert.equal(sandbox.failIfUnavailable, true);
      assert.equal(sandbox.allowUnsandboxedCommands, false);
      assert.equal(sandbox.autoAllowBashIfSandboxed, false);
      assert.deepEqual(sandbox.network.allowedDomains, []);
      assert.equal(sandbox.network.allowLocalBinding, false);
      assert.equal(sandbox.filesystem.allowWrite.length, 1);
      assert.match(sandbox.filesystem.allowWrite[0], /workspace\/\.verify\/a$/);
      const denied = sandbox.filesystem.denyWrite.map((p) => p.slice(sandbox.filesystem.allowWrite[0].length - 'workspace/.verify/a'.length));
      for (const p of ['src', 'state', 'node_modules', '.env', 'workspace/a', 'workspace/other', 'workspace/.no-hooks', 'workspace/.verify/b']) {
        assert.ok(denied.includes(p), `${p} must not be writable: ${denied.join(', ')}`);
      }
      assert.ok(!denied.some((p) => p === 'workspace' || p === 'workspace/.verify' || p.startsWith('workspace/.verify/a')), denied.join(', '));
    }
  });

  it('has no sandbox settings on native Windows, or without verification', () => {
    assert.equal(buildSettings({ ...paths, platform: 'win32' }).sandbox, undefined);
    assert.equal(buildSettings({ ...paths, verifyDir: null, platform: 'linux' }).sandbox, undefined);
  });

  it('is refused where Claude Code has no sandbox, unless the repository opts in', () => {
    const repo = { name: 'a', test_command: 'pnpm test', test_command_unsandboxed: false };
    assert.ok(sandboxSupported('linux') && sandboxSupported('darwin') && !sandboxSupported('win32'));
    assert.deepEqual(verificationFor(repo, 'linux'), { testCommand: 'pnpm test', sandboxed: true, warning: null });
    const refused = verificationFor(repo, 'win32');
    assert.equal(refused.testCommand, null);
    assert.match(refused.warning, /verification disabled.*test_command_unsandboxed: true/);
    const optedIn = verificationFor({ ...repo, test_command_unsandboxed: true }, 'win32');
    assert.equal(optedIn.testCommand, 'pnpm test');
    assert.equal(optedIn.sandboxed, false);
    assert.match(optedIn.warning, /without a sandbox/);
    assert.deepEqual(verificationFor({ ...repo, test_command: null }, 'win32'), { testCommand: null, sandboxed: false, warning: null });
  });

  it('tells the dashboard verification is off on native Windows unless the repository opts in', () => {
    const repo = { name: 'a', test_command: 'pnpm test', test_command_unsandboxed: false };
    assert.equal(verificationState(repo, 'linux'), 'on');
    assert.equal(verificationState(repo, 'win32'), 'no-sandbox');
    assert.equal(verificationState({ ...repo, test_command_unsandboxed: true }, 'win32'), 'on');
    assert.equal(verificationState({ ...repo, test_command: null }, 'linux'), 'no-test-command');
  });

  it('validates the opt-in in repos.yaml', () => {
    const config = (extra: string) => `defaults:\n  organization: o\n  project: p\n${extra}repos:\n  - { repo: demo }\n`;
    assert.equal(parseConfig(config('')).at(0).test_command_unsandboxed, false);
    assert.equal(parseConfig(config('  test_command_unsandboxed: true\n')).at(0).test_command_unsandboxed, true);
    assert.throws(() => parseConfig(config('  test_command_unsandboxed: "yes"\n')), /test_command_unsandboxed must be true or false/);
  });
});
