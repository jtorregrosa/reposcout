import type { FindingView, Overview, RepoView } from '@/lib/types';

let seq = 0;
// Distinct from the first character, like real fingerprints, so a search by prefix can tell them apart.
const hex = (n: number) => ((Math.imul(n, 2654435761) >>> 0).toString(16).padStart(8, '0') + n.toString(16).padStart(24, '0')).slice(0, 32);

export function finding(over: Partial<FindingView> = {}): FindingView {
  seq++;
  return {
    fingerprint: hex(seq),
    repo: 'api',
    commit: 'abcdef1234567890',
    file: `src/file-${seq}.ts`,
    line: 10,
    category: 'logic',
    severity: 'medium',
    title: `Finding ${seq}`,
    description: 'What is wrong.',
    scenario: 'How it breaks.',
    suggested_fix: 'How to fix it.',
    confidence: 'high',
    verified: false,
    snippet: 'const x = 1;',
    kind: 'bug',
    status: 'open',
    status_pending: false,
    new_last_run: false,
    first_seen: '2026-10-01T08:00:00.000Z',
    last_seen: '2026-10-08T08:00:00.000Z',
    resolved_at: null,
    resolution: null,
    review_note: null,
    suppressed_reason: null,
    decision: null,
    labels_override: null,
    stage: 'detected',
    stage_since: '2026-10-01T08:00:00.000Z',
    stage_source: 'initial',
    issue: null,
    ...over,
  };
}

export function repo(over: Partial<RepoView> = {}): RepoView {
  return {
    name: 'api',
    organization: 'org',
    project: 'proj',
    branch: 'main',
    models: { orchestrator: 'opus', specialists: 'sonnet', verifier: 'opus' },
    test_command: true,
    verification: 'on',
    last_commit: 'abcdef1234567890',
    last_run_at: '2026-10-08T08:00:00.000Z',
    last_full_run_at: '2026-10-07T08:00:00.000Z',
    analyzers: ['security', 'concurrency', 'error-handling', 'logic', 'performance'],
    last_read_coverage: null,
    coverage: { audited: 50, eligible: 100, per_run: 25, pace: null, counted_only: null, by_analyzer: {}, times: {}, oldest_times: [] },
    counts: {
      open: 0,
      speculative: 0,
      suppressed: 0,
      resolved: 0,
      refuted: 0,
      duplicate: 0,
      new_last_run: 0,
      to_validate: 0,
      by_severity: { critical: 0, high: 0, medium: 0, low: 0 },
    },
    jira: null,
    ...over,
  };
}

export function overview(over: Partial<Overview> = {}): Overview {
  return {
    generated_at: '2026-10-09T08:00:00.000Z',
    analyzers: ['security', 'concurrency', 'error-handling', 'logic', 'performance'],
    config_error: null,
    active: null,
    repos: [repo()],
    findings: [],
    discarded: [],
    failures: {},
    usage: [],
    cost_per_file: null,
    rate_limit: null,
    runs: [],
    precision: [],
    yields: [],
    run_results: [],
    jira: null,
    ...over,
  };
}

// One finding in every queue, across two repositories.
export function triageFixture() {
  const findings = [
    finding({ fingerprint: hex(0xa1), title: 'Speculative candidate', status: 'speculative', repo: 'api', severity: 'high' }),
    finding({ fingerprint: hex(0xa2), title: 'Detected finding', status: 'open', stage: 'detected', repo: 'api', severity: 'critical', new_last_run: true }),
    finding({
      fingerprint: hex(0xa3),
      title: 'Validated finding',
      status: 'open',
      stage: 'validated',
      repo: 'web',
      category: 'security',
      decision: { verdict: 'confirmed', reason: 'Checked by hand', decided_by: 'alice', decided_at: '2026-10-08T09:00:00.000Z', decided_on: 'open' },
    }),
    finding({ fingerprint: hex(0xa4), title: 'Resolved finding', status: 'resolved', stage: 'fixed', repo: 'web', severity: 'low' }),
    finding({ fingerprint: hex(0xa5), title: 'Suppressed finding', status: 'suppressed', repo: 'api', suppressed_reason: 'Trusted input' }),
  ];
  const repos = [
    repo({
      name: 'api',
      counts: { ...repo().counts, open: 1, speculative: 1, suppressed: 1, to_validate: 1, by_severity: { critical: 1, high: 0, medium: 0, low: 0 } },
    }),
    repo({ name: 'web', verification: 'no-test-command', test_command: false, counts: { ...repo().counts, open: 1, resolved: 1 } }),
  ];
  return overview({ findings, repos });
}
