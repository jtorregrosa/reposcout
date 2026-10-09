import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { applyFilters, DEFAULT_FILTERS, describeScope, matchesStatus, severityMatrix } from './findings';
import type { FindingView } from './types';

const finding = (over: Partial<FindingView>): FindingView =>
  ({
    fingerprint: 'f',
    repo: 'r',
    file: 'src/a.cs',
    line: 1,
    category: 'logic',
    severity: 'low',
    status: 'open',
    new_last_run: false,
    status_pending: false,
    title: 'Title',
    description: 'Description',
    first_seen: '2026-10-01T00:00:00.000Z',
    ...over,
  }) as FindingView;

describe('finding filters', () => {
  it('treats "new" as open findings first confirmed by the last run', () => {
    assert.ok(matchesStatus(finding({ new_last_run: true }), 'new'));
    assert.ok(!matchesStatus(finding({ new_last_run: true, status: 'suppressed' }), 'new'));
    assert.ok(!matchesStatus(finding({}), 'new'));
  });

  it('combines repository, severities, types and search', () => {
    const all = [
      finding({ fingerprint: 'a', repo: 'x', severity: 'high', category: 'security', title: 'SQL injection' }),
      finding({ fingerprint: 'b', repo: 'x', severity: 'low', category: 'security' }),
      finding({ fingerprint: 'c', repo: 'y', severity: 'high', category: 'security' }),
      finding({ fingerprint: 'd', repo: 'x', severity: 'high', category: 'logic' }),
    ];
    const shown = applyFilters(all, { ...DEFAULT_FILTERS, repo: 'x', severities: ['high'], categories: ['security'], q: 'injection' });
    assert.deepEqual(
      shown.map((f) => f.fingerprint),
      ['a'],
    );
  });

  it('filters by type, including findings not classified yet, and by personal data', () => {
    const all = [
      finding({ fingerprint: 'a', kind: 'vulnerability', personal_data: true }),
      finding({ fingerprint: 'b', kind: 'chore' }),
      finding({ fingerprint: 'c' }),
    ];
    const ids = (over: Partial<typeof DEFAULT_FILTERS>) => applyFilters(all, { ...DEFAULT_FILTERS, ...over }).map((f) => f.fingerprint);
    assert.deepEqual(ids({ kinds: ['vulnerability', 'unset'] }), ['a', 'c']);
    assert.deepEqual(ids({ personalData: true }), ['a']);
    assert.match(describeScope({ ...DEFAULT_FILTERS, kinds: ['chore', 'unset'], personalData: true }), /type: Chore, not classified · personal data only/);
  });

  it('sorts the most severe first, then by location', () => {
    const shown = applyFilters(
      [
        finding({ fingerprint: 'low', severity: 'low', file: 'a.cs' }),
        finding({ fingerprint: 'crit-b', severity: 'critical', file: 'b.cs' }),
        finding({ fingerprint: 'crit-a', severity: 'critical', file: 'a.cs' }),
      ],
      DEFAULT_FILTERS,
    );
    assert.deepEqual(
      shown.map((f) => f.fingerprint),
      ['crit-a', 'crit-b', 'low'],
    );
  });

  it('describes the scope a report was exported with', () => {
    assert.equal(describeScope({ ...DEFAULT_FILTERS, repo: 'x', severities: ['high'] }), 'repository: x · status: open · severity: high');
  });

  it('counts findings by category and severity', () => {
    const m = severityMatrix([finding({ severity: 'high', category: 'security' }), finding({ severity: 'high', category: 'security' })]);
    assert.deepEqual(m.rows.find((r) => r.key === 'security')?.cells, [0, 2, 0, 0]);
    assert.deepEqual(m.totals, [0, 2, 0, 0]);
  });

  it('counts findings by type and severity, with a row for the unclassified only while there are some', () => {
    const labelled = [finding({ severity: 'high', kind: 'bug' }), finding({ severity: 'low', kind: 'chore' })];
    assert.deepEqual(
      severityMatrix(labelled, 'kind').rows.map((r) => [r.key, r.total]),
      [
        ['vulnerability', 0],
        ['bug', 1],
        ['chore', 1],
      ],
    );
    assert.deepEqual(severityMatrix([...labelled, finding({ severity: 'medium' })], 'kind').rows.at(-1)?.cells, [0, 0, 1, 0]);
  });
});
