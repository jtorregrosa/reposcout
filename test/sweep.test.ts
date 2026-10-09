import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'vitest';
import { budgetDecision, DEFAULT_PASS_COST, latestRateLimit, passCost } from '../src/audit/budget.js';
import { parseSweepSince } from '../src/commands/options.js';
import { selectFiles } from '../src/selection/select.js';
import { costPerFile, fullRunPace } from '../src/state/coverage.js';

const future = Math.floor(Date.now() / 1000) + 3600;
const past = Math.floor(Date.now() / 1000) - 60;

describe('latestRateLimit', () => {
  it('returns the newest reading of the window still open', () => {
    const rows = [{ rate_limit: { five_hour: 0.2, resets_at: future } }, { rate_limit: null }, { rate_limit: { five_hour: 0.31, resets_at: future } }];
    assert.equal(latestRateLimit(rows)?.five_hour, 0.31);
  });

  it('ignores a reading whose window has already reset', () => {
    assert.equal(latestRateLimit([{ rate_limit: { five_hour: 0.8, resets_at: past } }]), null);
  });
});

describe('passCost', () => {
  it('is the change in each window within the same window', () => {
    const cost = passCost({ five_hour: 0.2, seven_day: 0.3, resets_at: 1 }, { five_hour: 0.26, seven_day: 0.31, resets_at: 1 });
    assert.ok(Math.abs(cost.five_hour - 0.06) < 1e-9);
    assert.ok(Math.abs(cost.seven_day - 0.01) < 1e-9);
  });

  it('is unknown when the window reset between the two readings', () => {
    assert.equal(passCost({ five_hour: 0.8, resets_at: 1 }, { five_hour: 0.05, resets_at: 2 }), null);
  });
});

describe('budgetDecision', () => {
  it('lets the first pass run when usage is not known yet', () => {
    assert.equal(budgetDecision({ rateLimit: null, lastCost: null }).proceed, true);
  });

  it('assumes a safe default cost before any pass of the sweep was measured', () => {
    const at = 0.9 - DEFAULT_PASS_COST.five_hour + 0.01;
    assert.equal(
      budgetDecision({
        rateLimit: { status: 'allowed', five_hour: at, seven_day: 0.1 },
        lastCost: null,
      }).proceed,
      false,
    );
  });

  it('stops before a pass whose measured cost would cross the session limit', () => {
    const d = budgetDecision({
      rateLimit: { status: 'allowed', five_hour: 0.85, seven_day: 0.3 },
      lastCost: { five_hour: 0.06, seven_day: 0.01 },
      sessionLimit: 0.9,
    });
    assert.equal(d.proceed, false);
    assert.match(d.reason, /5-hour window at 85%/);
  });

  it('runs another pass when the measured cost still fits', () => {
    assert.equal(
      budgetDecision({
        rateLimit: { status: 'allowed', five_hour: 0.5, seven_day: 0.3 },
        lastCost: { five_hour: 0.06, seven_day: 0.01 },
      }).proceed,
      true,
    );
  });

  it('also guards the weekly window, and any status other than allowed', () => {
    assert.equal(
      budgetDecision({
        rateLimit: { status: 'allowed', five_hour: 0.1, seven_day: 0.94 },
        lastCost: { five_hour: 0.05, seven_day: 0.02 },
        weeklyLimit: 0.95,
      }).proceed,
      false,
    );
    assert.equal(
      budgetDecision({
        rateLimit: { status: 'rejected', five_hour: 0.1, seven_day: 0.1 },
        lastCost: null,
      }).proceed,
      false,
    );
  });
});

describe('a sweep selection', () => {
  it('only picks files not audited since the sweep began, and ends when none are left', () => {
    const dir = mkdtempSync(join(tmpdir(), 'reposcout-sweep-'));
    mkdirSync(join(dir, 'src'));
    for (const f of ['a', 'b', 'c']) writeFileSync(join(dir, 'src', `${f}.cs`), 'class X {}\n');
    const candidates = ['src/a.cs', 'src/b.cs', 'src/c.cs'].map((path) => ({
      path,
      status: 'tracked',
    }));
    const start = '2026-10-07T10:00:00.000Z';
    const pick = (lastAudited) =>
      selectFiles({
        cloneDir: dir,
        candidates,
        excluded: [],
        focusPaths: [],
        maxFiles: 2,
        maxBytes: 1e6,
        lastAudited,
        order: 'coverage',
        auditedBefore: start,
      });
    const first = pick({ 'src/a.cs': '2026-10-07T09:00:00.000Z' });
    assert.equal(first.selected.length, 2);
    assert.equal(first.eligibleCount, 3);
    const done = pick({
      'src/a.cs': '2026-10-07T10:05:00.000Z',
      'src/b.cs': '2026-10-07T10:05:00.000Z',
      'src/c.cs': '2026-10-07T10:30:00.000Z',
    });
    assert.equal(done.selected.length, 0);
    assert.equal(done.eligibleCount, 3);
  });
});

describe('fullRunPace', () => {
  it('averages the files agents actually opened over recent full runs, ignoring other modes', () => {
    const rep = (mode, read, selected = 120) => ({
      r: { mode, read_coverage: { read, selected } },
    });
    assert.deepEqual(fullRunPace([rep('full', 80), rep('incremental', 10), rep('full', 100)]), { files: 90, runs: 2 });
    assert.equal(fullRunPace([rep('incremental', 10)]), null);
  });
});

describe('costPerFile', () => {
  it('spreads the measured window cost of full runs over the files they audited', () => {
    const usage = [
      {
        mode: 'full',
        files: 100,
        window_cost: { five_hour: 0.04, seven_day: 0.01 },
      },
      {
        mode: 'full',
        files: 100,
        window_cost: { five_hour: 0.06, seven_day: 0.01 },
      },
      { mode: 'full', files: 50, window_cost: null },
      {
        mode: 'incremental',
        files: 10,
        window_cost: { five_hour: 0.01, seven_day: 0 },
      },
    ];
    const c = costPerFile(usage);
    assert.ok(Math.abs(c.five_hour - 0.0005) < 1e-12);
    assert.ok(Math.abs(c.seven_day - 0.0001) < 1e-12);
    assert.equal(c.runs, 2);
    assert.equal(costPerFile([]), null);
  });
});

describe('--sweep-since', () => {
  const now = Date.parse('2026-10-09T12:00:00Z');

  it('takes the instant a sweep began, as its stop message gives it', () => {
    assert.equal(parseSweepSince('2026-10-09T07:00:07.375Z', now), '2026-10-09T07:00:07.375Z');
    assert.equal(parseSweepSince('2026-10-09T09:00:07+02:00', now), '2026-10-09T07:00:07.000Z');
  });

  it('rejects anything but a past ISO date and time', () => {
    assert.throws(() => parseSweepSince('yesterday', now), /ISO date and time/);
    assert.throws(() => parseSweepSince('2026-10-09', now), /ISO date and time/);
    assert.throws(() => parseSweepSince('2026-10-10T00:00:00Z', now), /future/);
  });
});
