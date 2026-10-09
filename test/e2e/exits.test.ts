import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, it } from 'vitest';
import { ExitCode } from '../../src/errors.js';
import { localDate } from '../../src/fs.js';
import { layout } from '../../src/paths.js';
import type { RepoReport } from '../../src/report/types.js';
import { FINDS_BOTH, SOURCES } from './fixtures.js';
import { createHome, type Home, readJsonFile, runEvents } from './harness.js';

// Every exit code the CLI documents, each reached the way it happens in a real run.
describe('e2e: exit codes', { timeout: 90_000 }, () => {
  let home: Home;
  afterEach(() => home?.remove());

  const failures = () => home.store((s) => s.failuresFor(localDate(new Date())));

  it('exits 1 when one repository fails (a session that hangs past its timeout) while another succeeds', async () => {
    home = createHome();
    const stuck = home.createRepo('stuck', SOURCES);
    const fine = home.createRepo('fine', SOURCES);
    // 3 seconds; the fake never answers, so the CLI kills it.
    home.writeConfig([
      { name: 'stuck', path: stuck, claude: { timeout_minutes: 0.05 } },
      { name: 'fine', path: fine },
    ]);
    home.scenario({ default: FINDS_BOTH, repos: { stuck: { behaviour: 'hang' } } });

    const run = await home.run(['run']);
    assert.equal(run.code, ExitCode.Failed, run.stderr);
    assert.match(failures().stuck?.error ?? '', /timed out/);
    assert.equal(failures().fine, undefined);
    home.store((s) => {
      assert.equal(s.readRepoState('stuck'), null);
      assert.equal(Object.values(s.readRepoState('fine')?.findings ?? {}).filter((e) => e.status === 'open').length, 2);
    });
    assert.ok(existsSync(join(home.reportsDir(), 'fine.json')));
    assert.ok(!existsSync(join(home.reportsDir(), 'stuck.json')));
    assert.match(readFileSync(join(home.reportsDir(), 'summary.md'), 'utf8'), /stuck/);
  });

  it('exits 3 at the usage limit and defers the remaining repositories untouched', async () => {
    home = createHome();
    const a = home.createRepo('a', SOURCES);
    const b = home.createRepo('b', SOURCES);
    home.writeConfig([
      { name: 'a', path: a },
      { name: 'b', path: b },
    ]);
    home.scenario({ default: { behaviour: 'usage-limit' } });

    const run = await home.run(['run']);
    assert.equal(run.code, ExitCode.UsageLimit, run.stderr);
    assert.equal(home.calls().filter((c) => c.kind === 'audit').length, 1);
    assert.equal(failures().a?.deferred, true);
    assert.equal(failures().b?.deferred, true);
    assert.match(failures().b?.error ?? '', /not attempted/);
    home.store((s) => assert.deepEqual(s.repoNames(), []));
    assert.match(readFileSync(join(home.reportsDir(), 'summary.md'), 'utf8'), /deferred/i);
  });

  it('exits 4 when the dashboard cancels the run while Claude is auditing, leaving the state as it was', async () => {
    home = createHome();
    const origin = home.createRepo('demo', SOURCES);
    home.writeConfig([{ name: 'demo', path: origin }]);
    home.scenario({ default: { ...FINDS_BOTH, behaviour: 'slow', delay_ms: 60_000 } });
    const paths = layout(home.dir);

    // What the dashboard's Cancel does: write the run's id, read from the lock, to the cancel file.
    const run = await home.run(['run'], {
      onCall: (call) => {
        if (call.kind !== 'audit') return;
        const { run_id } = readJsonFile<{ run_id: string }>(paths.lockFile);
        writeFileSync(paths.cancelFile, JSON.stringify({ run_id, at: new Date().toISOString() }));
      },
    });
    assert.equal(run.code, ExitCode.Cancelled, run.stderr);
    home.store((s) => assert.equal(s.readRepoState('demo'), null));
    assert.ok(runEvents(home).some((e) => e.type === 'run_cancelled'));
    assert.ok(!existsSync(paths.cancelFile));
    assert.ok(!existsSync(paths.lockFile));
  });

  it('exits 5 when a sweep stops before a pass that would cross the session budget, keeping the passes it made', async () => {
    home = createHome();
    const origin = home.createRepo('demo', SOURCES);
    // One file per pass, and a 5-hour window at 85%: the second pass's estimated 8% would cross 90%.
    home.writeConfig([{ name: 'demo', path: origin, max_files_full_run: 1 }]);
    home.scenario({ default: { ...FINDS_BOTH, five_hour: 0.85 } });

    const run = await home.run(['run', '--until-covered']);
    assert.equal(run.code, ExitCode.Budget, run.stderr);
    assert.equal(home.calls().filter((c) => c.kind === 'audit').length, 1);
    const pass = runEvents(home).filter((e) => e.type === 'sweep_pass');
    assert.deepEqual(
      pass.map((e) => e.proceed),
      [true, false],
    );
    const runs = join(home.reportsDir(), 'runs');
    const [passDir] = readdirSync(runs);
    assert.match(passDir ?? '', /-p1$/);
    assert.equal(readJsonFile<RepoReport>(join(runs, passDir as string, 'demo.json')).audited_files.length, 1);
    home.store((s) => assert.ok(s.readRepoState('demo')?.last_full_run_at));
  });

  it('exits 2 without touching anything while another run holds the lock', async () => {
    home = createHome();
    const origin = home.createRepo('demo', SOURCES);
    home.writeConfig([{ name: 'demo', path: origin }]);
    const paths = layout(home.dir);
    mkdirSync(paths.stateDir, { recursive: true });
    // This test process is alive, so the lock is not stale.
    writeFileSync(paths.lockFile, JSON.stringify({ pid: process.pid, started_at: new Date().toISOString(), run_id: 'run-other' }));

    const run = await home.run(['run']);
    assert.equal(run.code, ExitCode.Busy, run.stderr);
    assert.equal(home.calls().filter((c) => c.kind === 'audit').length, 0);
  });

  it('refuses the local provider unless it is explicitly allowed', async () => {
    home = createHome();
    const origin = home.createRepo('demo', SOURCES);
    home.writeConfig([{ name: 'demo', path: origin }]);
    const run = await home.run(['run'], { env: { REPOSCOUT_ALLOW_LOCAL_PROVIDER: '' } });
    assert.equal(run.code, ExitCode.Failed);
    assert.match(run.stderr, /provider "local".*REPOSCOUT_ALLOW_LOCAL_PROVIDER=1/);
  });
});
