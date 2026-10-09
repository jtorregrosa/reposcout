import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import type { FindingView } from '../types';
import { buildSarifReport } from './sarif';

const finding = (over: Partial<FindingView>): FindingView =>
  ({
    fingerprint: 'f'.repeat(32),
    repo: 'demo',
    commit: 'c',
    file: 'src\\a.cs',
    line: 3,
    category: 'logic',
    severity: 'medium',
    confidence: 'high',
    verified: false,
    status: 'open',
    title: 'Title',
    description: 'Description',
    scenario: 'Scenario',
    suggested_fix: 'Fix',
    snippet: 'x',
    suppressed_reason: null,
    ...over,
  }) as FindingView;

describe('buildSarifReport', () => {
  it('builds one run per repository from the filtered findings, with the shared mapping', () => {
    const log = JSON.parse(
      buildSarifReport(
        [
          finding({ repo: 'b' }),
          finding({ repo: 'a', severity: 'critical', kind: 'vulnerability' }),
          finding({ repo: 'a', status: 'suppressed', suppressed_reason: 'ok' }),
        ],
        [{ name: 'a', branch: 'main', last_commit: 'abc' }],
      ),
    );
    assert.equal(log.version, '2.1.0');
    assert.deepEqual(
      log.runs.map((r: { properties: { repository: string } }) => r.properties.repository),
      ['a', 'b'],
    );
    const [first, second] = log.runs[0].results;
    assert.equal(first.level, 'error');
    assert.equal(first.properties['security-severity'], '9.5');
    assert.equal(first.locations[0].physicalLocation.artifactLocation.uri, 'src/a.cs');
    assert.deepEqual(second.suppressions, [{ kind: 'external', status: 'accepted', justification: 'ok' }]);
    assert.equal(log.runs[0].properties.commit, 'abc');
    assert.equal(log.runs[1].results[0].level, 'warning');
  });
});
