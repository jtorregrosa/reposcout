import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, it } from 'vitest';
import type { RepoReport } from '../../src/report/types.js';
import { FINDS_BOTH, LOOP_BUG, SOURCES, TOKEN_BUG } from './fixtures.js';
import { createHome, git, type Home, readJsonFile, runEvents } from './harness.js';

// The CLI end to end, from src/ through tsx, against a git repository on disk and the fake claude.
describe('e2e: run', { timeout: 90_000 }, () => {
  let home: Home;
  afterEach(() => home?.remove());

  const report = (name = 'demo') => readJsonFile<RepoReport>(join(home.reportsDir(), `${name}.json`));
  const statuses = () => home.store((s) => Object.values(s.readRepoState('demo')?.findings ?? {}).map((e) => `${e.finding.title}: ${e.status}`));

  it('audits a baseline, sees the findings again, and resolves them after two runs that miss them', async () => {
    home = createHome();
    const origin = home.createRepo('demo', SOURCES);
    const head = git(origin, ['rev-parse', 'HEAD']);
    home.writeConfig([{ name: 'demo', path: origin }]);
    home.scenario({ default: FINDS_BOTH });

    const first = await home.run(['run']);
    assert.equal(first.code, 0, first.stderr);
    const baseline = report();
    // No state yet, so the default incremental run is a full baseline.
    assert.equal(baseline.mode, 'full');
    assert.equal(baseline.commit, head);
    assert.deepEqual(baseline.findings.map((f) => [f.title, f.status]).sort(), [
      [LOOP_BUG.title, 'new'],
      [TOKEN_BUG.title, 'new'],
    ]);
    assert.deepEqual(baseline.read_coverage, { selected: 3, read: 3, unread: [], by_analyzer: { security: 3, logic: 3 } });
    assert.equal(baseline.usage.num_turns, 6);
    assert.equal(baseline.usage.cost_usd_equivalent, 0.42);
    assert.ok(baseline.usage.models?.['claude-sonnet-4-5']);
    assert.equal(baseline.discarded_count, 1);
    const summary = readFileSync(join(home.reportsDir(), 'summary.md'), 'utf8');
    assert.match(summary, new RegExp(TOKEN_BUG.title));
    assert.match(summary, new RegExp(LOOP_BUG.title));
    assert.deepEqual(statuses().sort(), [`${LOOP_BUG.title}: open`, `${TOKEN_BUG.title}: open`]);
    home.store((s) => {
      assert.equal(s.readRepoState('demo')?.last_commit, head);
      const usage = s.usage(10);
      assert.equal(usage.length, 1);
      assert.equal(usage[0]?.ok, true);
      assert.equal(usage[0]?.rate_limit?.five_hour, 0.1);
    });

    const second = await home.run(['run', '--mode', 'full']);
    assert.equal(second.code, 0, second.stderr);
    assert.deepEqual(
      report().findings.map((f) => f.status),
      ['existing', 'existing'],
    );

    // The specialists open both files again and report nothing: one miss keeps a finding open, two resolve it.
    home.scenario({ default: { behaviour: 'findings', findings: [] } });
    assert.equal((await home.run(['run', '--mode', 'full'])).code, 0);
    assert.deepEqual(statuses().sort(), [`${LOOP_BUG.title}: open`, `${TOKEN_BUG.title}: open`]);
    assert.equal(report().resolved.length, 0);
    assert.equal((await home.run(['run', '--mode', 'full'])).code, 0);
    assert.deepEqual(statuses().sort(), [`${LOOP_BUG.title}: resolved`, `${TOKEN_BUG.title}: resolved`]);
    assert.equal(report().resolved.length, 2);
    assert.equal(report().open_total, 0);
    assert.equal(home.calls().filter((c) => c.kind === 'audit').length, 4);
  });

  it('audits only what changed since the last audited commit, then skips when nothing did', async () => {
    home = createHome();
    const origin = home.createRepo('demo', SOURCES);
    const base = git(origin, ['rev-parse', 'HEAD']);
    home.writeConfig([{ name: 'demo', path: origin }]);
    home.scenario({ default: FINDS_BOTH });
    assert.equal((await home.run(['run'])).code, 0);

    const head = home.commit(origin, {
      'src/util.ts': `${SOURCES['src/util.ts']}export const twice = (n: number): number => n * 2;\n`,
      'src/new.ts': 'export {};\n',
    });
    const second = await home.run(['run']);
    assert.equal(second.code, 0, second.stderr);
    const audit = home.calls().filter((c) => c.kind === 'audit');
    assert.equal(audit.length, 2);
    assert.deepEqual(audit[1]?.files?.sort(), ['src/new.ts', 'src/util.ts']);
    const incremental = report();
    assert.equal(incremental.mode, 'incremental');
    assert.equal(incremental.previous_commit, base);
    assert.equal(incremental.commit, head);
    // Neither finding's file was audited, so both are carried open, not missed.
    assert.equal(incremental.findings.length, 0);
    assert.equal(incremental.open_total, 2);
    assert.deepEqual(statuses().sort(), [`${LOOP_BUG.title}: open`, `${TOKEN_BUG.title}: open`]);
    assert.equal(
      home.store((s) => s.readRepoState('demo')?.last_commit),
      head,
    );

    const third = await home.run(['run']);
    assert.equal(third.code, 0, third.stderr);
    assert.equal(home.calls().filter((c) => c.kind === 'audit').length, 2);
  });

  it('resumes a session that ended before writing its output, once', async () => {
    home = createHome();
    const origin = home.createRepo('demo', SOURCES);
    home.writeConfig([{ name: 'demo', path: origin }]);
    home.scenario({ default: { ...FINDS_BOTH, behaviour: 'no-output' } });

    const run = await home.run(['run', '--mode', 'full']);
    assert.equal(run.code, 0, run.stderr);
    assert.deepEqual(
      home.calls().map((c) => c.kind),
      ['version', 'audit', 'resume'],
    );
    assert.ok(runEvents(home).some((e) => e.type === 'claude_resumed'));
    assert.equal(report().findings.length, 2);
    // Turns add up across the first session and the resume.
    assert.equal(report().usage.num_turns, 9);
    assert.ok(existsSync(join(home.reportsDir(), 'summary.md')));
  });
});
