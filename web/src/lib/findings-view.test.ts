import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { finding } from '@/test/fixtures';
import { applyView, DEFAULT_VIEW, describeScope, filterChips, findingsHref, parseFindingsView, serializeFindingsView } from './findings-view';

const parse = (qs: string) => parseFindingsView(new URLSearchParams(qs));

describe('the findings view codec', () => {
  it('opens Triage by default', () => {
    assert.deepEqual(parse(''), DEFAULT_VIEW);
  });

  it('round-trips every key', () => {
    const view = {
      ...DEFAULT_VIEW,
      queue: 'report' as const,
      repo: 'api',
      severities: ['critical' as const, 'high' as const],
      categories: ['security' as const],
      kinds: ['bug' as const, 'unset' as const],
      stages: ['validated' as const],
      statuses: ['open' as const],
      newOnly: true,
      personalData: true,
      q: 'sql',
      sort: 'newest' as const,
      id: 'abc',
      tab: 'evidence' as const,
    };
    assert.deepEqual(parseFindingsView(serializeFindingsView(view)), view);
  });

  it('writes nothing for the default view', () => {
    assert.equal(findingsHref(), '/findings');
    assert.equal(findingsHref({ queue: 'all', statuses: ['open'] }), '/findings?queue=all&status=open');
  });

  it('opens a link from before the queues on All with its status as a filter', () => {
    const v = parse('status=resolved&repo=api');
    assert.equal(v.queue, 'all');
    assert.deepEqual(v.statuses, ['resolved']);
    assert.equal(v.repo, 'api');
  });

  it('turns the old New tab into the new filter', () => {
    const v = parse('status=new');
    assert.equal(v.queue, 'all');
    assert.equal(v.newOnly, true);
    assert.deepEqual(v.statuses, []);
  });

  it('opens the old All tab on All', () => {
    assert.equal(parse('status=all').queue, 'all');
  });

  it('ignores values it does not know', () => {
    const v = parse('stage=validated,shipped&queue=nowhere&sort=random&tab=other');
    assert.deepEqual(v.stages, ['validated']);
    assert.equal(v.queue, 'triage');
    assert.equal(v.sort, 'severity');
    assert.equal(v.tab, 'overview');
  });
});

describe('applying a view', () => {
  const all = [
    finding({ fingerprint: 'spec', status: 'speculative' }),
    finding({ fingerprint: 'det', status: 'open', stage: 'detected', severity: 'critical', new_last_run: true }),
    finding({ fingerprint: 'val', status: 'open', stage: 'validated', category: 'security', personal_data: true, kind: 'vulnerability' }),
    finding({ fingerprint: 'res', status: 'resolved', stage: 'fixed', kind: undefined }),
  ];
  const ids = (over: Partial<typeof DEFAULT_VIEW>) => applyView(all, { ...DEFAULT_VIEW, ...over }).map((f) => f.fingerprint);

  it('lists a queue', () => {
    assert.deepEqual(ids({}), ['det', 'spec']);
    assert.deepEqual(ids({ queue: 'report' }), ['val']);
    assert.deepEqual(ids({ queue: 'closed' }), ['res']);
  });

  it('combines the filters', () => {
    assert.deepEqual(ids({ queue: 'all', statuses: ['open'], categories: ['security'] }), ['val']);
    assert.deepEqual(ids({ queue: 'all', newOnly: true }), ['det']);
    assert.deepEqual(ids({ queue: 'all', personalData: true }), ['val']);
    assert.deepEqual(ids({ queue: 'all', kinds: ['unset'] }), ['res']);
    assert.deepEqual(ids({ queue: 'all', stages: ['validated', 'fixed'] }).sort(), ['res', 'val']);
    assert.deepEqual(ids({ queue: 'all', q: 'DET' }), ['det']);
  });

  it('sorts the most severe first, then by location', () => {
    const sorted = applyView(
      [
        finding({ fingerprint: 'low', severity: 'low', file: 'a.cs' }),
        finding({ fingerprint: 'crit-b', severity: 'critical', file: 'b.cs' }),
        finding({ fingerprint: 'crit-a', severity: 'critical', file: 'a.cs' }),
      ],
      DEFAULT_VIEW,
    );
    assert.deepEqual(
      sorted.map((f) => f.fingerprint),
      ['crit-a', 'crit-b', 'low'],
    );
  });
});

describe('filter chips', () => {
  it('lists every folded filter with the patch that removes it', () => {
    const chips = filterChips({ ...DEFAULT_VIEW, categories: ['security', 'logic'], newOnly: true });
    assert.deepEqual(
      chips.map((c) => c.label),
      ['Category: security', 'Category: logic', 'New in the last run'],
    );
    assert.deepEqual(chips[0]?.patch, { categories: ['logic'] });
  });
});

describe('the scope of an export', () => {
  it('names the queue and every filter', () => {
    assert.equal(
      describeScope({ ...DEFAULT_VIEW, repo: 'x', severities: ['high'], stages: ['validated'], kinds: ['chore', 'unset'], personalData: true }),
      'repository: x · queue: triage · severity: high · type: Chore, not classified · stage: validated · personal data only',
    );
  });
});
