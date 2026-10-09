import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, it } from 'vitest';
import { ExitCode } from '../../src/errors.js';
import type { RepoReport } from '../../src/report/types.js';
import { LOOP_BUG, SOURCES, TOKEN_BUG } from './fixtures.js';
import { createHome, type Home, readJsonFile, runEvents } from './harness.js';

const CLAMP_BUG = {
  file: 'src/util.ts',
  line: 1,
  snippet: 'export const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));',
  category: 'logic',
  title: 'Clamp gives the wrong bound when lo is above hi',
};
const unverified = <T extends object>(f: T) => ({ ...f, verified: false });
// Native Windows has no sandbox, so the opt-in keeps verification on there; elsewhere the sandbox applies.
const TESTABLE = { test_command: 'node --version', test_command_unsandboxed: true };

describe('e2e: validation passes', { timeout: 90_000 }, () => {
  let home: Home;
  afterEach(() => home?.remove());

  const report = () => readJsonFile<RepoReport>(join(home.reportsDir(), 'demo.json'));
  const finished = () => runEvents(home).filter((e) => e.type === 'repo_finished');
  const byTitle = (title: string) =>
    home.store((s) => {
      const [fp, entry] = Object.entries(s.readRepoState('demo')?.findings ?? {}).find(([, e]) => e.finding.title === title) ?? [];
      assert.ok(fp && entry, title);
      return { fp, entry, stage: s.stagesFor('demo').get(fp), attempts: s.validationAttempts('demo', fp) };
    });

  it('validates what it reproduces, records the rest as attempts, and leaves coverage and statuses alone', async () => {
    home = createHome();
    const origin = home.createRepo('demo', SOURCES);
    home.writeConfig([{ name: 'demo', path: origin, ...TESTABLE }]);
    home.scenario({ default: { behaviour: 'findings', findings: [TOKEN_BUG, LOOP_BUG, CLAMP_BUG].map(unverified) } });
    assert.equal((await home.run(['run', '--mode', 'full'])).code, 0);
    const before = home.store((s) => s.readRepoState('demo'));
    assert.equal(byTitle(TOKEN_BUG.title).stage?.stage, 'detected');

    home.scenario({
      default: { behaviour: 'findings', validation: { 'src/auth.ts': 'reproduced', 'src/math.ts': 'not_reproduced', 'src/util.ts': 'not_testable' } },
    });
    const run = await home.run(['run', '--mode', 'validate']);
    assert.equal(run.code, 0, run.stderr);

    const token = byTitle(TOKEN_BUG.title);
    assert.equal(token.entry.status, 'open');
    assert.equal(token.entry.finding.verified, true);
    assert.match(token.entry.finding.reproduction ?? '', /failed/);
    assert.equal(token.entry.finding.description, before?.findings[token.fp]?.finding.description);
    assert.deepEqual([token.stage?.stage, token.stage?.source], ['validated', 'reproduced']);
    for (const [title, outcome] of [
      [LOOP_BUG.title, 'not_reproduced'],
      [CLAMP_BUG.title, 'not_testable'],
    ] as const) {
      const f = byTitle(title);
      assert.equal(f.entry.status, 'open');
      assert.equal(f.entry.finding.confidence, 'high');
      assert.equal(f.stage?.stage, 'detected');
      assert.deepEqual(
        f.attempts.map((a) => a.outcome),
        [outcome],
      );
    }

    const after = home.store((s) => s.readRepoState('demo'));
    assert.deepEqual(after?.last_commit_by_analyzer, before?.last_commit_by_analyzer);
    assert.deepEqual(after?.file_audits_by_analyzer, before?.file_audits_by_analyzer);
    assert.equal(after?.last_run_at, before?.last_run_at);
    for (const [fp, e] of Object.entries(after?.findings ?? {})) assert.equal(e.last_seen, before?.findings[fp]?.last_seen);

    const r = report();
    assert.equal(r.mode, 'validate');
    assert.deepEqual(r.findings, []);
    assert.equal(r.validation?.tried, 3);
    assert.deepEqual(
      r.validation?.reproduced.map((f) => f.title),
      [TOKEN_BUG.title],
    );
    assert.equal(r.validation?.not_reproduced.length, 1);
    assert.equal(r.validation?.not_testable.length, 1);
    assert.equal(r.yield, undefined);
    assert.match(readFileSync(join(home.reportsDir(), 'summary.md'), 'utf8'), /\*\*Validation:\*\* 1 of 3 findings tried were reproduced/);
    home.store((s) => {
      const row = s.usage().find((u) => u.mode === 'validate');
      assert.equal(row?.files, 3);
      assert.deepEqual(row?.analyzers, []);
    });
    const last = finished().at(-1);
    assert.deepEqual([last?.status, last?.tried, last?.reproduced, last?.not_reproduced, last?.not_testable], ['ok', 3, 1, 1, 1]);
  });

  it('stops trying a finding after two unsuccessful attempts', async () => {
    home = createHome();
    const origin = home.createRepo('demo', SOURCES);
    home.writeConfig([{ name: 'demo', path: origin, ...TESTABLE }]);
    home.scenario({ default: { behaviour: 'findings', findings: [unverified(LOOP_BUG)] } });
    assert.equal((await home.run(['run', '--mode', 'full'])).code, 0);

    home.scenario({ default: { behaviour: 'findings', validation: { 'src/math.ts': 'not_testable' } } });
    for (let i = 0; i < 3; i++) assert.equal((await home.run(['run', '--mode', 'validate'])).code, 0);
    assert.equal(home.calls().filter((c) => c.kind === 'audit' && c.mode === 'validate').length, 2);
    assert.equal(byTitle(LOOP_BUG.title).attempts.length, 2);
    assert.equal(finished().at(-1)?.reason, 'no findings to validate');
  });

  it('skips a repository whose verification is off without starting a session', async () => {
    home = createHome();
    const origin = home.createRepo('demo', SOURCES);
    home.writeConfig([{ name: 'demo', path: origin }]);
    home.scenario({ default: { behaviour: 'findings', findings: [unverified(LOOP_BUG)] } });
    assert.equal((await home.run(['run', '--mode', 'full'])).code, 0);

    const run = await home.run(['run', '--mode', 'validate']);
    assert.equal(run.code, 0, run.stderr);
    assert.equal(home.calls().filter((c) => c.mode === 'validate').length, 0);
    assert.match(String(finished().at(-1)?.reason), /^verification off: no test_command configured/);
    home.store((s) => assert.equal(s.usage().filter((u) => u.mode === 'validate').length, 0));
  });

  it('exits 5 when the next validation session would cross the session budget', async () => {
    home = createHome();
    const origin = home.createRepo('demo', SOURCES);
    home.writeConfig([{ name: 'demo', path: origin, ...TESTABLE }]);
    // The audit leaves a 5-hour reading of 85%: the next session's estimated 8% would cross 90%.
    home.scenario({ default: { behaviour: 'findings', findings: [unverified(LOOP_BUG)], five_hour: 0.85 } });
    assert.equal((await home.run(['run', '--mode', 'full'])).code, 0);

    const run = await home.run(['run', '--mode', 'validate']);
    assert.equal(run.code, ExitCode.Budget, run.stderr);
    assert.equal(home.calls().filter((c) => c.mode === 'validate').length, 0);
    assert.equal(finished().at(-1)?.status, 'deferred');
    assert.equal(runEvents(home).find((e) => e.type === 'validation_budget')?.proceed, false);
  });

  it('refuses analyzers and lets the budget limits through', async () => {
    home = createHome();
    const origin = home.createRepo('demo', SOURCES);
    home.writeConfig([{ name: 'demo', path: origin, ...TESTABLE }]);
    const refused = await home.run(['run', '--mode', 'validate', '--analyzers', 'security']);
    assert.equal(refused.code, ExitCode.Failed);
    assert.match(refused.stderr, /takes no analyzers/);
    const limited = await home.run(['run', '--mode', 'validate', '--session-limit', '70']);
    assert.equal(limited.code, 0, limited.stderr);
    const withoutMode = await home.run(['run', '--session-limit', '70']);
    assert.equal(withoutMode.code, ExitCode.Failed);
    assert.match(withoutMode.stderr, /--until-covered or --mode validate/);
  });
});
