import assert from 'node:assert/strict';
import type { SpawnOptions } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, it } from 'vitest';
import { parseConfig } from '../src/config/config.js';
import { openInEditor, requestCancel, resolveInClone, startRun, suppressFinding, unsuppressFinding } from '../src/dashboard/actions.js';

const FP = 'a'.repeat(32);

interface SpawnCall {
  command: string;
  args: string[];
  options: SpawnOptions;
}
let root: string;
let configPath: string;

const status = (fn) => {
  try {
    fn();
    return 200;
  } catch (e) {
    return e.status ?? 500;
  }
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'reposcout-act-'));
  mkdirSync(join(root, 'state'), { recursive: true });
  mkdirSync(join(root, 'workspace', 'demo', 'src'), {
    recursive: true,
  });
  writeFileSync(join(root, 'workspace', 'demo', 'src', 'a.cs'), 'class A {}\n');
  configPath = join(root, 'repos.yaml');
  copyFileSync('test/repos.fixture.yaml', configPath);
  writeFileSync(
    join(root, 'state', 'demo.json'),
    JSON.stringify({
      findings: {
        [FP]: {
          status: 'open',
          first_seen: '2026-10-07T00:00:00.000Z',
          last_seen: '2026-10-07T00:00:00.000Z',
          finding: { fingerprint: FP, file: 'src/a.cs', line: 1, category: 'logic', severity: 'low', title: 'A finding' },
        },
      },
    }),
  );
});

describe('suppressFinding', () => {
  it('adds the entry to repos.yaml and keeps every comment', () => {
    const before = readFileSync(configPath, 'utf8');
    suppressFinding({
      root,
      configPath,
      repo: 'demo',
      fingerprint: FP,
      reason: 'values come from trusted config',
    });
    const after = readFileSync(configPath, 'utf8');
    const comments = (t) => t.split('\n').filter((l) => l.trim().startsWith('#'));
    assert.deepEqual(comments(after), comments(before));
    const repo = parseConfig(after).find((r) => r.name === 'demo');
    assert.deepEqual(repo.suppressed, [{ fingerprint: FP, reason: 'values come from trusted config' }]);
  });

  it('refuses a duplicate, an unknown finding, an unknown repository and an empty reason', () => {
    suppressFinding({
      root,
      configPath,
      repo: 'demo',
      fingerprint: FP,
      reason: 'first time',
    });
    assert.equal(
      status(() =>
        suppressFinding({
          root,
          configPath,
          repo: 'demo',
          fingerprint: FP,
          reason: 'again',
        }),
      ),
      409,
    );
    assert.equal(
      status(() =>
        suppressFinding({
          root,
          configPath,
          repo: 'demo',
          fingerprint: 'b'.repeat(32),
          reason: 'nope',
        }),
      ),
      400,
    );
    assert.equal(
      status(() =>
        suppressFinding({
          root,
          configPath,
          repo: 'nope',
          fingerprint: FP,
          reason: 'nope',
        }),
      ),
      400,
    );
    assert.equal(
      status(() =>
        suppressFinding({
          root,
          configPath,
          repo: 'demo',
          fingerprint: FP,
          reason: ' ',
        }),
      ),
      400,
    );
  });

  it('stores a multi-line or control-character reason as one plain line', () => {
    suppressFinding({
      root,
      configPath,
      repo: 'demo',
      fingerprint: FP,
      reason: 'line one\nline two\u0007',
    });
    const repo = parseConfig(readFileSync(configPath, 'utf8')).find((r) => r.name === 'demo');
    assert.equal(repo.suppressed[0].reason, 'line one line two');
  });
});

describe('unsuppressFinding', () => {
  it('removes the entry and leaves a valid file', () => {
    suppressFinding({
      root,
      configPath,
      repo: 'demo',
      fingerprint: FP,
      reason: 'temporary',
    });
    unsuppressFinding({ configPath, repo: 'demo', fingerprint: FP });
    const repo = parseConfig(readFileSync(configPath, 'utf8')).find((r) => r.name === 'demo');
    assert.deepEqual(repo.suppressed, []);
    assert.equal(
      status(() =>
        unsuppressFinding({
          configPath,
          repo: 'demo',
          fingerprint: FP,
        }),
      ),
      404,
    );
  });
});

describe('resolveInClone', () => {
  it('accepts a file inside the clone and rejects every way out of it', () => {
    assert.ok(
      resolveInClone({
        root,
        repo: 'demo',
        file: 'src/a.cs',
      }).endsWith('a.cs'),
    );
    for (const file of ['../../repos.yaml', '..\\..\\repos.yaml', 'C:\\Windows\\win.ini', '/etc/passwd', 'src/../../x', '']) {
      assert.ok([400, 404].includes(status(() => resolveInClone({ root, repo: 'demo', file }))), file);
    }
  });
});

describe('openInEditor', () => {
  it('starts the editor without a shell, at the file and line', () => {
    let call: SpawnCall | undefined;
    const spawnFn = (command: string, args: string[], options: SpawnOptions) => {
      call = { command, args, options };
      return { on() {}, unref() {} };
    };
    openInEditor({ root, configPath, repo: 'demo', file: 'src/a.cs', line: 7 }, { launcher: () => ({ command: 'code', prefix: [], env: {} }), spawnFn });
    assert.equal(call.options.shell, false);
    assert.match(call.args.at(-1), /a\.cs:7$/);
  });
});

describe('startRun', () => {
  const capture = () => {
    const calls: SpawnCall[] = [];
    return {
      calls,
      spawnFn: (command: string, args: string[], options: SpawnOptions) => {
        calls.push({ command, args, options });
        return { pid: 1, on() {}, unref() {} };
      },
    };
  };

  it('launches the CLI detached with the chosen repositories and mode', () => {
    const { calls, spawnFn } = capture();
    startRun(
      {
        root,
        configPath,
        repos: ['demo'],
        mode: 'full',
        maxFiles: 10,
      },
      { spawnFn },
    );
    assert.equal(calls[0].command, process.execPath);
    assert.deepEqual(calls[0].args.slice(1), ['run', '--mode', 'full', '--repo', 'demo', '--max-files', '10']);
    assert.equal(calls[0].options.shell, false);
    assert.equal(calls[0].options.detached, true);
  });

  it('passes a chosen subset of analyzers, and leaves them to the repository when none is chosen', () => {
    const { calls, spawnFn } = capture();
    startRun(
      {
        root,
        configPath,
        repos: [],
        mode: 'incremental',
        analyzers: ['logic', 'security'],
      },
      { spawnFn },
    );
    startRun({ root, configPath, repos: [], mode: 'incremental', analyzers: [] }, { spawnFn });
    assert.deepEqual(calls[0].args.slice(-2), ['--analyzers', 'security,logic']);
    assert.ok(!calls[1].args.includes('--analyzers'));
    assert.equal(
      status(() =>
        startRun(
          {
            root,
            configPath,
            repos: [],
            mode: 'incremental',
            analyzers: ['style'],
          },
          { spawnFn },
        ),
      ),
      400,
    );
  });

  it('passes a sweep with its session limit, only in full mode', () => {
    const { calls, spawnFn } = capture();
    startRun(
      {
        root,
        configPath,
        repos: [],
        mode: 'full',
        untilCovered: true,
        sessionLimit: 80,
      },
      { spawnFn },
    );
    assert.deepEqual(calls[0].args.slice(-3), ['--until-covered', '--session-limit', '80']);
    assert.equal(
      status(() =>
        startRun(
          {
            root,
            configPath,
            repos: [],
            mode: 'incremental',
            untilCovered: true,
          },
          { spawnFn },
        ),
      ),
      400,
    );
    assert.equal(
      status(() =>
        startRun(
          {
            root,
            configPath,
            repos: [],
            mode: 'full',
            untilCovered: true,
            sessionLimit: 120,
          },
          { spawnFn },
        ),
      ),
      400,
    );
    assert.equal(
      status(() => startRun({ root, configPath, repos: [], mode: 'full', untilCovered: 'yes' }, { spawnFn })),
      400,
    );
  });

  it('validates every input', () => {
    const { spawnFn } = capture();
    assert.equal(
      status(() => startRun({ root, configPath, repos: ['x; rm -rf /'], mode: 'full' }, { spawnFn })),
      400,
    );
    assert.equal(
      status(() => startRun({ root, configPath, repos: [], mode: 'everything' }, { spawnFn })),
      400,
    );
    assert.equal(
      status(() => startRun({ root, configPath, repos: [], mode: 'full', maxFiles: 0 }, { spawnFn })),
      400,
    );
    assert.equal(
      status(() => startRun({ root, configPath, repos: [], mode: 'full', maxFiles: 9999 }, { spawnFn })),
      400,
    );
  });

  it('refuses to start while another run holds the lock', () => {
    const { spawnFn, calls } = capture();
    writeFileSync(
      join(root, 'state', '.lock'),
      JSON.stringify({
        pid: process.pid,
        started_at: new Date().toISOString(),
        run_id: 'run-x',
      }),
    );
    assert.equal(
      status(() => startRun({ root, configPath, repos: [], mode: 'incremental' }, { spawnFn })),
      409,
    );
    assert.equal(calls.length, 0);
  });

  it('starts a validation pass only for repositories that can run their tests, with no analyzers', () => {
    const { calls, spawnFn } = capture();
    assert.equal(
      status(() => startRun({ root, configPath, repos: ['demo'], mode: 'validate' }, { spawnFn })),
      400,
      'demo has no test_command',
    );
    const testable = join(root, 'repos-testable.yaml');
    writeFileSync(
      testable,
      readFileSync(configPath, 'utf8').replace(
        '    suppressed: []\n',
        '    suppressed: []\n    test_command: node --version\n    test_command_unsandboxed: true\n',
      ),
    );
    startRun({ root, configPath: testable, repos: ['demo'], mode: 'validate', maxFiles: 5, sessionLimit: 70 }, { spawnFn });
    assert.deepEqual(calls[0]?.args.slice(-9), ['run', '--mode', 'validate', '--repo', 'demo', '--max-files', '5', '--session-limit', '70']);
    assert.equal(
      status(() => startRun({ root, configPath: testable, repos: ['demo'], mode: 'validate', analyzers: ['security'] }, { spawnFn })),
      400,
    );
  });
});

describe('requestCancel', () => {
  it('targets the run that holds the lock, and fails when none does', () => {
    assert.equal(
      status(() => requestCancel({ root })),
      409,
    );
    writeFileSync(
      join(root, 'state', '.lock'),
      JSON.stringify({
        pid: process.pid,
        started_at: new Date().toISOString(),
        run_id: 'run-x',
      }),
    );
    requestCancel({ root });
    assert.equal(JSON.parse(readFileSync(join(root, 'state', '.cancel'), 'utf8')).run_id, 'run-x');
  });
});
