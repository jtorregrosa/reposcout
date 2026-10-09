import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'vitest';
import { knownFalsePositives, MAX_KNOWN_FALSE_POSITIVES } from '../src/audit/manifest.js';
import { promptVersion } from '../src/audit/prompts.js';
import { analyzerYield, candidateCount, creditedAnalyzers, normalizeDiscards, parseReply, writeReplies } from '../src/audit/specialists.js';
import { createStreamTracker } from '../src/claude/stream.js';
import { precisionCells } from '../src/dashboard/metrics.js';
import { renderSummary } from '../src/report/summary.js';
import type { RepoReport, RunUsage } from '../src/report/types.js';
import type { RepoState } from '../src/state/types.js';
import { Store } from '../src/store/index.js';
import { asEntry, state } from './fixtures.js';

const entry = (status: string, over: object = {}) =>
  asEntry({
    status,
    first_seen: '2026-10-01T00:00:00.000Z',
    last_seen: '2026-10-01T00:00:00.000Z',
    finding: { file: 'src/a.cs', line: 3, category: 'security', severity: 'high', title: 'A finding', snippet: 'var x = 1;' },
    ...over,
  });

describe('known false positives', () => {
  it('lists suppressed findings with the reason from repos.yaml and refuted candidates with why', () => {
    const { findings } = state({
      s1: entry('suppressed', { reason: 'old reason' }),
      r1: entry('refuted', { refuted_at: '2026-10-05T00:00:00.000Z', resolution: 'Refuted: the id is a GUID' }),
      o1: entry('open'),
      p1: entry('speculative'),
    });
    const list = knownFalsePositives(findings, new Map([['s1', 'GUIDs from our identity provider']]), ['security']);
    assert.deepEqual(
      list.map((f) => [f.dismissed_as, f.reason]),
      [
        ['refuted', 'Refuted: the id is a GUID'],
        ['suppressed', 'GUIDs from our identity provider'],
      ],
    );
    assert.deepEqual(Object.keys(list[0] ?? {}).sort(), ['category', 'dismissed_as', 'file', 'reason', 'snippet', 'title']);
  });

  it('counts a suppression added in repos.yaml before the run catches up', () => {
    const { findings } = state({ o1: entry('open') });
    assert.equal(knownFalsePositives(findings, new Map([['o1', 'reviewed']]), ['security'])[0]?.dismissed_as, 'suppressed');
  });

  it('keeps only the analyzers that run, the most recent first, at most 20, short and redacted', () => {
    const many = Object.fromEntries(
      Array.from({ length: 25 }, (_, i) => [
        `r${i}`,
        entry('refuted', { refuted_at: `2026-10-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`, resolution: `reason ${i}` }),
      ]),
    );
    const { findings } = state({
      ...many,
      logic: entry('refuted', { refuted_at: '2026-12-01T00:00:00.000Z', finding: { file: 'b', category: 'logic', title: 'L', snippet: 's' } }),
      secret: entry('suppressed', {
        last_seen: '2026-11-01T00:00:00.000Z',
        finding: { file: 'c', category: 'security', title: 'Key', snippet: `password = "hunter2hunter2" ${'x'.repeat(500)}` },
      }),
    });
    const list = knownFalsePositives(findings, new Map(), ['security']);
    assert.equal(list.length, MAX_KNOWN_FALSE_POSITIVES);
    assert.ok(list.every((f) => f.category === 'security'));
    assert.equal(list[0]?.title, 'Key');
    assert.ok(!list[0]?.snippet.includes('hunter2'));
    assert.ok((list[0]?.snippet.length ?? 0) <= 300);
    assert.equal(list[1]?.reason, 'reason 24');
  });
});

describe('prompt version', () => {
  const prompts = (skill: string, agent: string) => {
    const root = mkdtempSync(join(tmpdir(), 'reposcout-prompts-'));
    mkdirSync(join(root, '.claude', 'skills', 'audit'), { recursive: true });
    mkdirSync(join(root, '.claude', 'agents'), { recursive: true });
    writeFileSync(join(root, '.claude', 'skills', 'audit', 'SKILL.md'), skill);
    writeFileSync(join(root, '.claude', 'agents', 'verifier.md'), agent);
    return root;
  };

  it('is 12 hex characters that change with any prompt and not with line endings', () => {
    const a = promptVersion(prompts('skill\n', 'verifier\n'));
    assert.match(a, /^[0-9a-f]{12}$/);
    assert.equal(promptVersion(prompts('skill\r\n', 'verifier\r\n')), a);
    assert.notEqual(promptVersion(prompts('skill\n', 'verifier, edited\n')), a);
  });
});

describe('specialist replies', () => {
  it('reads a reply as JSON when it is, also fenced or after a sentence', () => {
    assert.equal(candidateCount(parseReply('[{"a":1},{"a":2}]')), 2);
    assert.equal(candidateCount(parseReply('Here are my findings:\n```json\n[{"a":1}]\n```')), 1);
    assert.equal(candidateCount(parseReply('I found these: [{"a":1}, {"a":2}, {"a":3}] and nothing else.')), 3);
    assert.equal(candidateCount(parseReply('[]')), 0);
    assert.equal(parseReply('No findings, the files were empty.'), null);
    assert.equal(candidateCount(parseReply('{"findings": [1, 2]}')), 2);
  });

  it('writes each reply under specialists/, numbered per type, redacted', () => {
    const workDir = mkdtempSync(join(tmpdir(), 'reposcout-replies-'));
    const captured = writeReplies(workDir, [
      { agent: 'security', text: '[{"title":"token","snippet":"api_key = \\"abcdef123456\\""}]' },
      { agent: 'security', text: 'I could not finish: password = hunter2hunter2' },
      { agent: 'logic', text: '[]' },
    ]);
    assert.deepEqual(readdirSync(join(workDir, 'specialists')).sort(), ['logic-1.json', 'security-1.json', 'security-2.txt']);
    assert.deepEqual(
      captured.map((c) => c.candidates),
      [1, null, 0],
    );
    assert.ok(!readFileSync(join(workDir, 'specialists', 'security-1.json'), 'utf8').includes('abcdef123456'));
    assert.ok(!readFileSync(join(workDir, 'specialists', 'security-2.txt'), 'utf8').includes('hunter2'));
  });

  it('writes nothing when no reply was captured', () => {
    const workDir = mkdtempSync(join(tmpdir(), 'reposcout-replies-'));
    assert.deepEqual(writeReplies(workDir, []), []);
    assert.ok(!existsSync(join(workDir, 'specialists')));
  });
});

describe('analyzer yield', () => {
  const usage = (over: Partial<RunUsage> = {}): RunUsage => ({
    duration_ms: 1,
    wall_ms: 1,
    num_turns: 1,
    cost_usd_equivalent: 2,
    models: { 'claude-sonnet': { input: 900, output: 100 } },
    subagents: { security: 1, logic: 2 },
    subagent_runs: 3,
    permission_denials: 0,
    window_cost: null,
    subagent_tokens: { security: 250, logic: 500 },
    ...over,
  });

  it('credits the specialists the verifier names, or the category when it names none', () => {
    assert.deepEqual(creditedAnalyzers(['security', 'the logic specialist'], 'performance'), ['security', 'logic']);
    assert.deepEqual(creditedAnalyzers(undefined, 'performance'), ['performance']);
    assert.deepEqual(creditedAnalyzers(['orchestrator']), []);
  });

  it('counts candidates, outcomes, tokens and cost per analyzer', () => {
    const rows = analyzerYield({
      analyzers: ['security', 'logic'],
      captured: [
        { agent: 'security', file: 'a', candidates: 3 },
        { agent: 'logic', file: 'b', candidates: 2 },
        { agent: 'logic', file: 'c', candidates: null },
        { agent: 'verifier', file: 'd', candidates: null },
      ],
      kept: [
        { category: 'security', specialists: ['security', 'logic'] },
        { category: 'logic', specialists: undefined },
      ],
      speculative: [{ category: 'security', specialists: ['security'] }],
      discarded: [{ title: 't', specialists: ['security'] }, { title: 'no credit' }],
      usage: usage(),
    });
    assert.deepEqual(rows, [
      { analyzer: 'security', instances: 1, candidates: 3, kept: 1, speculative: 1, discarded: 1, tokens: 250, cost_usd: 0.5 },
      // One unreadable reply makes the count unknown rather than low.
      { analyzer: 'logic', instances: 2, candidates: null, kept: 2, speculative: 0, discarded: 0, tokens: 500, cost_usd: 1 },
    ]);
  });

  // A real run keeps its specialists in the background, and their replies never reach the stream.
  it('falls back to the orchestrator count and the launched instances when no reply was captured', () => {
    const [security, logic] = analyzerYield({
      analyzers: ['security', 'logic'],
      captured: [],
      kept: [],
      speculative: [],
      discarded: [],
      usage: usage({ subagents: { security: 2, logic: 1 } }),
      reported: { security: 4, logic: 'many' },
    });
    assert.equal(security?.instances, 2);
    assert.equal(security?.candidates, 4);
    assert.equal(logic?.instances, 1);
    assert.equal(logic?.candidates, null);
  });

  it('leaves tokens and cost unknown when the run did not report them', () => {
    const [row] = analyzerYield({
      analyzers: ['security'],
      captured: [],
      kept: [],
      speculative: [],
      discarded: [],
      usage: usage({ subagent_tokens: null, cost_usd_equivalent: null }),
    });
    assert.equal(row?.tokens, null);
    assert.equal(row?.cost_usd, null);
    assert.equal(row?.candidates, null);
  });

  it('keeps the discards that are objects, with the specialists as strings', () => {
    assert.deepEqual(normalizeDiscards([{ title: 't', reason: 'style', specialists: ['logic', 2] }, 'junk', null, ['x']]), [
      { title: 't', reason: 'style', specialists: ['logic', '2'] },
    ]);
    assert.deepEqual(normalizeDiscards(undefined), []);
  });
});

describe('subagent replies in the stream', () => {
  const tracker = () => createStreamTracker({ emit: () => {}, repo: 'r' });
  const agentCall = (id: string, type: string) => ({
    type: 'assistant',
    parent_tool_use_id: null,
    message: { content: [{ type: 'tool_use', id, name: 'Agent', input: { subagent_type: type, prompt: 'p' } }] },
  });

  it('takes a foreground reply from the Agent tool result, with its tokens', () => {
    const t = tracker();
    t.handle(agentCall('v1', 'verifier'));
    t.handle({
      type: 'user',
      tool_use_result: { status: 'completed', totalTokens: 4200 },
      message: { content: [{ type: 'tool_result', tool_use_id: 'v1', content: [{ type: 'text', text: '{"findings":[]}' }] }] },
    });
    assert.deepEqual(t.replies, [{ agent: 'verifier', text: '{"findings":[]}' }]);
    assert.deepEqual(t.tokensByAgent, { verifier: 4200 });
  });

  it('skips a background launch acknowledgement and takes the reply from its task notification', () => {
    const t = tracker();
    t.handle(agentCall('s1', 'security'));
    t.handle({ type: 'system', subtype: 'task_started', task_id: 'task-9', tool_use_id: 's1', subagent_type: 'security' });
    t.handle({
      type: 'user',
      tool_use_result: { isAsync: true, status: 'async_launched' },
      message: { content: [{ type: 'tool_result', tool_use_id: 's1', content: 'Async agent launched successfully.' }] },
    });
    assert.deepEqual(t.replies, []);
    t.handle({ type: 'system', subtype: 'task_notification', task_id: 'task-9', tool_use_id: 's1', status: 'completed', usage: { total_tokens: 900 } });
    t.handle({
      type: 'user',
      message: {
        content:
          '<task-notification>\n<task-id>task-9</task-id>\n<status>completed</status>\n<summary>done</summary>\n<result>[{"title":"x"}]</result>\n</task-notification>',
      },
    });
    assert.deepEqual(t.replies, [{ agent: 'security', text: '[{"title":"x"}]' }]);
    assert.deepEqual(t.tokensByAgent, { security: 900 });
  });

  it('ignores notifications quoted inside a subagent and replies to calls it did not see', () => {
    const t = tracker();
    t.handle(agentCall('s1', 'logic'));
    t.handle({
      type: 'user',
      parent_tool_use_id: 's1',
      message: { content: '<task-notification><tool-use-id>s1</tool-use-id><result>[1,2,3]</result></task-notification>' },
    });
    t.handle({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'other', content: '[1]' }] } });
    assert.deepEqual(t.replies, []);
  });
});

describe('precision', () => {
  const fact = (fingerprint: string, status: string, over: object = {}) => ({
    repo: 'demo',
    fingerprint,
    status: status as never,
    category: 'security',
    ever_open: false,
    prompt_version: 'p1',
    model: 'sonnet',
    ...over,
  });

  it('keeps what reached open and was not suppressed, and dismisses what was suppressed or refuted', () => {
    const cells = precisionCells(
      [
        fact('open', 'open', { ever_open: true }),
        fact('resolved', 'resolved', { ever_open: true }),
        fact('suppressed', 'suppressed', { ever_open: true }),
        fact('pending', 'open', { ever_open: true }),
        fact('withdrawn', 'suppressed', { ever_open: true }),
        fact('refuted', 'refuted'),
        fact('waiting', 'speculative'),
      ],
      new Map([['demo', new Set(['suppressed', 'pending'])]]),
    );
    assert.deepEqual(cells, [{ repo: 'demo', category: 'security', model: 'sonnet', prompt_version: 'p1', kept: 3, suppressed: 2, refuted: 1 }]);
  });

  it('falls back to the stored status for a repository no longer in repos.yaml', () => {
    const cells = precisionCells([fact('a', 'suppressed', { repo: 'gone' })], new Map());
    assert.equal(cells[0]?.suppressed, 1);
  });
});

const repoState = (findings: RepoState['findings']): RepoState => ({ repo: 'demo', branch: 'main', last_commit: 'abc', findings });

describe('the store', () => {
  it('attributes each finding to the prompts and model of the run that first recorded it', () => {
    const store = new Store(':memory:');
    store.saveReport({ run_id: 'run-1', repo: 'demo', generated_at: 't1', prompt_version: 'aaa', specialist_model: 'sonnet' } as RepoReport, 'd');
    store.saveReport({ run_id: 'run-2', repo: 'demo', generated_at: 't2', prompt_version: 'bbb', specialist_model: 'opus' } as RepoReport, 'd');
    store.writeRepoState('demo', repoState({ a: entry('speculative') }), { runId: 'run-1', at: 't1' });
    store.writeRepoState('demo', repoState({ a: entry('open'), b: entry('open') }), { runId: 'run-2', at: 't2' });
    const facts = store.precisionFacts().sort((x, y) => x.fingerprint.localeCompare(y.fingerprint));
    assert.deepEqual(
      facts.map((f) => [f.fingerprint, f.ever_open, f.prompt_version, f.model]),
      [
        ['a', true, 'aaa', 'sonnet'],
        ['b', true, 'bbb', 'opus'],
      ],
    );
  });

  it('keeps one yield row per run, repository and analyzer', () => {
    const store = new Store(':memory:');
    const row = { analyzer: 'security' as const, instances: 1, candidates: 4, kept: 1, speculative: 1, discarded: 2, tokens: 100, cost_usd: 0.25 };
    const run = { runId: 'run-1', repo: 'demo', at: 't1', mode: 'full', promptVersion: 'aaa', model: 'sonnet' };
    store.saveYield(run, [row]);
    store.saveYield(run, [{ ...row, kept: 2 }]);
    assert.deepEqual(store.yields(), [{ ...row, kept: 2, run_id: 'run-1', repo: 'demo', at: 't1', mode: 'full', prompt_version: 'aaa', model: 'sonnet' }]);
  });

  it('counts what each run reported for the first time', () => {
    const store = new Store(':memory:');
    store.saveReport(
      {
        run_id: 'run-1',
        repo: 'demo',
        generated_at: 't1',
        findings: [{ status: 'new' }, { status: 'existing' }, { status: 'new' }],
        speculative_new: [{}],
      } as unknown as RepoReport,
      'd',
    );
    assert.deepEqual(store.runResults(), [{ run_id: 'run-1', repo: 'demo', generated_at: 't1', new_findings: 2, new_speculative: 1 }]);
  });
});

describe('the summary', () => {
  it('says when verification was off, and who proposed each discard', () => {
    const report = {
      schema: 'reposcout/report@1',
      run_id: 'run-1',
      repo: 'demo',
      branch: 'main',
      commit: 'c'.repeat(40),
      previous_commit: null,
      mode: 'full',
      analyzers: ['security'],
      generated_at: 't',
      audited_files: [],
      omitted_files_count: 0,
      findings: [],
      resolved: [],
      open_total: 0,
      speculative_new: [],
      refuted: [],
      suppressed_count: 0,
      read_coverage: { selected: 0, read: 0, unread: [] },
      discarded: [{ title: 'Looks like SQLi', file: 'a.cs', reason: 'known-false-positive', specialists: ['security'] }],
      rejected: [],
      usage: {},
      verification: { enabled: false, reason: 'no test_command configured' },
    } as unknown as RepoReport;
    const md = renderSummary('2026-10-08', [report], {});
    assert.match(md, /Verification is off\*\* \(no test_command configured\)/);
    assert.match(md, /\| known-false-positive \| `a\.cs` \| Looks like SQLi \| security \|/);
    assert.doesNotMatch(renderSummary('2026-10-08', [{ ...report, verification: { enabled: true, reason: null } }], {}), /Verification is off/);
  });
});
