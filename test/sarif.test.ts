import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'vitest';
import { sarifFromStore } from '../src/commands/export.js';
import { FINGERPRINT_VERSION } from '../src/findings/fingerprint.js';
import type { FindingsState } from '../src/findings/types.js';
import { artifactUri, buildSarif, SARIF_FINGERPRINT_KEY, SARIF_SCHEMA, type SarifFinding } from '../src/report/sarif.js';
import { reposcoutVersion } from '../src/report/sarif-file.js';
import { Store } from '../src/store/store.js';

const finding = (over: Partial<SarifFinding> = {}): SarifFinding => ({
  fingerprint: 'a'.repeat(32),
  file: 'src/a.cs',
  line: 12,
  category: 'security',
  severity: 'high',
  title: 'Token compared with ==',
  scenario: 'An attacker times the comparison.',
  confidence: 'high',
  snippet: 'if (token == expected)',
  kind: 'vulnerability',
  personal_data: false,
  ...over,
});

const log = (findings: SarifFinding[], extra = {}) => buildSarif([{ name: 'demo', findings, ...extra }], { version: '1.2.3' });
const firstResult = (f: SarifFinding) => log([f]).runs[0]?.results[0];

describe('SARIF', () => {
  it('has the 2.1.0 shape: schema, version, tool driver with one rule per category', () => {
    const out = log([finding()], { repositoryUri: 'https://dev.azure.com/o/p/_git/demo', branch: 'main', commit: 'c0ffee' });
    assert.equal(out.$schema, SARIF_SCHEMA);
    assert.equal(out.version, '2.1.0');
    const run = out.runs[0];
    assert.ok(run);
    assert.equal(run.tool.driver.name, 'RepoScout');
    assert.equal(run.tool.driver.version, '1.2.3');
    assert.deepEqual(
      run.tool.driver.rules.map((r) => r.id),
      ['reposcout/security', 'reposcout/concurrency', 'reposcout/error-handling', 'reposcout/logic', 'reposcout/performance'],
    );
    assert.deepEqual(run.versionControlProvenance, [{ repositoryUri: 'https://dev.azure.com/o/p/_git/demo', revisionId: 'c0ffee', branch: 'main' }]);
    const r = run.results[0];
    assert.ok(r);
    assert.equal(r.ruleId, 'reposcout/security');
    assert.equal(run.tool.driver.rules[r.ruleIndex]?.id, r.ruleId);
    assert.equal(r.message.text, 'Token compared with ==\n\nAn attacker times the comparison.');
    assert.deepEqual(r.locations[0]?.physicalLocation.region, { startLine: 12, snippet: { text: 'if (token == expected)' } });
    // Round-trips through JSON, as a file would.
    assert.deepEqual(JSON.parse(JSON.stringify(out)), out);
  });

  it('omits provenance when the repository URI is unknown, and names the package version by default', () => {
    assert.equal(log([finding()]).runs[0]?.versionControlProvenance, undefined);
    assert.equal(reposcoutVersion(), (JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }).version);
  });

  it('maps severity to level, and to security-severity for vulnerabilities only', () => {
    const levels = (['critical', 'high', 'medium', 'low'] as const).map((severity) => firstResult(finding({ severity })));
    assert.deepEqual(
      levels.map((r) => r?.level),
      ['error', 'error', 'warning', 'note'],
    );
    assert.deepEqual(
      levels.map((r) => r?.properties['security-severity']),
      ['9.5', '8.0', '5.5', '3.0'],
    );
    const bug = firstResult(finding({ kind: 'bug', category: 'logic' }));
    assert.equal(bug?.properties['security-severity'], undefined);
    assert.deepEqual(bug?.properties.tags, ['logic', 'high', 'bug']);
    const personal = firstResult(finding({ personal_data: true }));
    assert.deepEqual(personal?.properties.tags, ['security', 'high', 'vulnerability', 'personal-data']);
    assert.deepEqual(firstResult(finding({ category: 'logic' }))?.properties.tags, ['logic', 'high', 'vulnerability', 'security']);
  });

  it('keys partialFingerprints by the current fingerprint version', () => {
    assert.equal(SARIF_FINGERPRINT_KEY, `reposcout/v${FINGERPRINT_VERSION}`);
    assert.deepEqual(firstResult(finding())?.partialFingerprints, { [`reposcout/v${FINGERPRINT_VERSION}`]: 'a'.repeat(32) });
  });

  it('normalises paths to relative URIs with forward slashes', () => {
    assert.equal(artifactUri('src\\Api\\Auth.cs'), 'src/Api/Auth.cs');
    assert.equal(artifactUri('./src/a b#1.ts'), 'src/a%20b%231.ts');
    assert.equal(artifactUri('/rooted/x.ts'), 'rooted/x.ts');
    assert.equal(firstResult(finding({ file: 'src\\win\\path.cs' }))?.locations[0]?.physicalLocation.artifactLocation.uri, 'src/win/path.cs');
  });

  it('redacts secrets in the message and the snippet', () => {
    const r = firstResult(
      finding({
        title: 'Hardcoded key AKIAABCDEFGHIJKLMNOP',
        scenario: 'password = "hunter2hunter2"',
        snippet: 'const key = "ghp_abcdefghijklmnopqrstuvwxyz0123456789"',
      }),
    );
    const text = JSON.stringify(r);
    assert.ok(!text.includes('AKIAABCDEFGHIJKLMNOP'));
    assert.ok(!text.includes('hunter2hunter2'));
    assert.ok(!text.includes('ghp_abcdefghijklmnopqrstuvwxyz0123456789'));
    assert.match(text, /REDACTED/);
  });

  it('marks report status as a baseline state, and suppressed findings with a suppression', () => {
    assert.equal(firstResult(finding({ status: 'new' }))?.baselineState, 'new');
    assert.equal(firstResult(finding({ status: 'existing' }))?.baselineState, 'unchanged');
    const suppressed = firstResult(finding({ status: 'suppressed', suppressed_reason: 'ids are GUIDs' }));
    assert.deepEqual(suppressed?.suppressions, [{ kind: 'external', status: 'accepted', justification: 'ids are GUIDs' }]);
    assert.ok(firstResult(finding({ status: 'speculative' }))?.properties.tags.includes('speculative'));
  });

  it('exports the database state per repository and status', () => {
    const store = new Store(':memory:');
    const entry = (status: string, fp: string) => ({
      status,
      first_seen: 't',
      last_seen: 't',
      ...(status === 'suppressed' ? { reason: 'not reachable' } : {}),
      finding: { ...finding({ fingerprint: fp }), repo: 'demo', commit: 'c', description: 'd', suggested_fix: 'f', verified: false },
    });
    const findings = {
      ['1'.repeat(32)]: entry('open', '1'.repeat(32)),
      ['2'.repeat(32)]: entry('speculative', '2'.repeat(32)),
      ['3'.repeat(32)]: entry('suppressed', '3'.repeat(32)),
      ['4'.repeat(32)]: entry('resolved', '4'.repeat(32)),
    } as unknown as FindingsState;
    store.writeRepoState('demo', { repo: 'demo', branch: 'main', last_commit: 'abc', findings } as never, { runId: null, at: 't' });
    const configs = [{ name: 'demo', provider: 'github', organization: 'acme', project: 'acme', repo: 'demo' }] as never;
    const fps = (status: 'open' | 'speculative' | 'all') =>
      sarifFromStore(store, { repos: ['demo'], status, configs }).runs[0]?.results.map((r) => r.partialFingerprints[SARIF_FINGERPRINT_KEY]?.[0]);
    assert.deepEqual(fps('open'), ['1']);
    assert.deepEqual(fps('speculative'), ['2']);
    assert.deepEqual(fps('all')?.sort(), ['1', '2', '3']);
    const run = sarifFromStore(store, { repos: ['demo'], status: 'open', configs }).runs[0];
    assert.deepEqual(run?.versionControlProvenance, [{ repositoryUri: 'https://github.com/acme/demo.git', revisionId: 'abc', branch: 'main' }]);
    store.close();
  });
});
