#!/usr/bin/env node
// A stand-in for the `claude` CLI, started by RepoScout through REPOSCOUT_CLAUDE_BIN in the end-to-end tests.
// It answers --version, finds the manifest the CLI passes in the /audit prompt (or, on a resume, beside the
// --agents file), streams stream-json messages shaped like the real CLI's, and writes the raw findings.
//
// What it does is chosen by the JSON file in FAKE_CLAUDE_SCENARIO (FAKE_ variables reach it; REPOSCOUT_ ones are
// stripped from the session's environment):
//   { "default": Behaviour, "repos": { "<repo name>": Behaviour } }
// where Behaviour is
//   { "behaviour": "findings" | "no-output" | "usage-limit" | "hang" | "slow" | "fail",
//     "findings": [{ "file", "line", "snippet", "category", "severity"?, "title"? }],
//     "speculative": [...same, plus "unconfirmed"],
//     "five_hour": 0.1, "seven_day": 0.05, "delay_ms": 60000 }
// "no-output" ends its first session successfully without writing, and writes on the resume. Every call is
// appended to FAKE_CLAUDE_LOG as a JSON line, so a test can see what was started and when.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, writeSync } from 'node:fs';
import { dirname, join } from 'node:path';

const argv = process.argv.slice(2);
const log = (entry) => {
  if (process.env.FAKE_CLAUDE_LOG)
    appendFileSync(process.env.FAKE_CLAUDE_LOG, `${JSON.stringify({ at: new Date().toISOString(), pid: process.pid, ...entry })}\n`);
};

// writeSync before exit(): an asynchronous write to a pipe could be lost.
if (argv.includes('--version')) {
  log({ kind: 'version' });
  writeSync(1, '2.1.0 (Fake Claude Code)\n');
  process.exit(0);
}

const flag = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const prompt = flag('-p') ?? '';
const resumed = argv.includes('--resume');
const sessionId = flag('--resume') ?? flag('--session-id') ?? 'fake-session';
const agentsFile = flag('--agents');
// "/audit <clone> <range> <mode> <manifest>"; a resume prompt names only the output file, so the manifest is found
// in the work directory the CLI wrote the agents file to.
const words = prompt.trim().split(/\s+/);
const manifestPath = words[0] === '/audit' ? words[4] : agentsFile ? join(dirname(agentsFile), 'manifest.json') : undefined;
if (!manifestPath || !existsSync(manifestPath)) {
  writeSync(2, `fake-claude: no manifest in the prompt or beside --agents (${manifestPath})\n`);
  process.exit(2);
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const scenario = process.env.FAKE_CLAUDE_SCENARIO ? JSON.parse(readFileSync(process.env.FAKE_CLAUDE_SCENARIO, 'utf8')) : {};
const behaviour = { behaviour: 'findings', ...(scenario.default ?? {}), ...(scenario.repos?.[manifest.repo] ?? {}) };
log({ kind: resumed ? 'resume' : 'audit', repo: manifest.repo, mode: manifest.mode, behaviour: behaviour.behaviour, files: manifest.files.map((f) => f.path) });

const emit = (msg) => process.stdout.write(`${JSON.stringify({ session_id: sessionId, ...msg })}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let toolSeq = 0;
const toolId = () => `toolu_fake_${++toolSeq}`;

const rateLimit = (status = 'allowed') =>
  emit({
    type: 'rate_limit_event',
    rate_limit_info: {
      status,
      rateLimitType: 'five_hour',
      resetsAt: Math.floor(Date.now() / 1000) + 3 * 3600,
      unifiedWindows: { five_hour: { utilization: behaviour.five_hour ?? 0.1 }, seven_day: { utilization: behaviour.seven_day ?? 0.05 } },
    },
  });

const result = (extra) =>
  emit({
    type: 'result',
    subtype: 'success',
    is_error: false,
    duration_ms: 1234,
    num_turns: 6,
    total_cost_usd: 0.42,
    terminal_reason: 'completed',
    modelUsage: {
      'claude-sonnet-4-5': { inputTokens: 1200, outputTokens: 800, cacheReadInputTokens: 30000, cacheCreationInputTokens: 4000 },
      'claude-opus-4-1': { inputTokens: 300, outputTokens: 500, cacheReadInputTokens: 9000, cacheCreationInputTokens: 1000 },
    },
    subagent_stats: {
      completed: manifest.analyzers.length + 1,
      failed: 0,
      by_type: Object.fromEntries([...manifest.analyzers, 'verifier'].map((a) => [a, 1])),
    },
    permission_denials: [],
    ...extra,
  });

// One subagent: the Agent call, its task, a Read of each file with its result, and the completion notice.
function subagent(type, files) {
  const id = toolId();
  emit({
    type: 'assistant',
    parent_tool_use_id: null,
    message: { content: [{ type: 'tool_use', id, name: 'Agent', input: { subagent_type: type, description: `${type} audit` } }] },
  });
  emit({ type: 'system', subtype: 'task_started', task_id: `task_${id}`, tool_use_id: id, subagent_type: type, description: `${type} audit` });
  for (const file of files) {
    const read = toolId();
    emit({
      type: 'assistant',
      parent_tool_use_id: id,
      message: { content: [{ type: 'tool_use', id: read, name: 'Read', input: { file_path: `${manifest.clone_path}/${file}` } }] },
    });
    emit({ type: 'user', parent_tool_use_id: id, message: { content: [{ type: 'tool_result', tool_use_id: read }] } });
  }
  emit({
    type: 'system',
    subtype: 'task_notification',
    task_id: `task_${id}`,
    tool_use_id: id,
    status: 'completed',
    usage: { total_tokens: 5000, tool_uses: files.length, duration_ms: 900 },
  });
  emit({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id }] } });
}

const audited = new Set(manifest.files.map((f) => f.path));
const complete = (f, extra = {}) => ({
  severity: 'high',
  confidence: 'high',
  verified: true,
  title: `${f.category} defect in ${f.file}`,
  description: 'The code does something different from what it must do here.',
  scenario: 'A caller sends the input that reaches this line and gets the wrong result.',
  suggested_fix: 'Change the offending line so it handles that input correctly.',
  kind: 'bug',
  personal_data: false,
  specialists: [f.category],
  ...extra,
  ...f,
});

function writeOutput() {
  // Only files this run was given: an incremental run reports nothing about files it did not audit.
  const findings = (behaviour.findings ?? []).filter((f) => audited.has(f.file)).map((f) => complete(f));
  const speculative = (behaviour.speculative ?? []).filter((f) => audited.has(f.file)).map((f) => complete(f, { confidence: 'low', verified: false }));
  const output = {
    findings,
    speculative,
    discarded: [{ title: 'style nit', file: manifest.files[0]?.path, reason: 'style' }],
    known_findings_review: [],
    speculative_review: [],
    notes: 'written by the fake claude',
  };
  mkdirSync(dirname(manifest.output_path), { recursive: true });
  const id = toolId();
  emit({
    type: 'assistant',
    parent_tool_use_id: null,
    message: { content: [{ type: 'tool_use', id, name: 'Write', input: { file_path: manifest.output_path } }] },
  });
  writeFileSync(manifest.output_path, JSON.stringify(output, null, 2));
  emit({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id }] } });
  return output;
}

emit({
  type: 'system',
  subtype: 'init',
  model: 'claude-sonnet-4-5',
  agents: Object.keys(JSON.parse(readFileSync(agentsFile, 'utf8'))),
  tools: ['Read', 'Write'],
});
rateLimit();

switch (behaviour.behaviour) {
  case 'hang':
    // Never answers: the CLI's timeout must kill it.
    setInterval(() => {}, 60_000);
    break;
  case 'usage-limit':
    rateLimit('rejected');
    result({
      subtype: 'error_during_execution',
      is_error: true,
      api_error_status: 429,
      result: 'Claude AI usage limit reached. Your limit will reset at 5pm.',
    });
    // exitCode rather than exit(), so the piped output is flushed first.
    process.exitCode = 1;
    break;
  case 'fail':
    result({ subtype: 'error_max_turns', is_error: true, errors: ['reached the maximum number of turns'] });
    process.exitCode = 1;
    break;
  default: {
    if (behaviour.behaviour === 'slow') await sleep(behaviour.delay_ms ?? 60_000);
    if (!resumed) {
      const read = toolId();
      emit({
        type: 'assistant',
        parent_tool_use_id: null,
        message: { content: [{ type: 'tool_use', id: read, name: 'Read', input: { file_path: manifestPath } }] },
      });
      emit({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: read }] } });
      const files = manifest.files.map((f) => f.path);
      for (const analyzer of manifest.analyzers) subagent(analyzer, files);
    }
    if (behaviour.behaviour === 'no-output' && !resumed) {
      // What the real orchestrator does when it ends its turn believing specialists are still running.
      result({ num_turns: 3, result: 'Waiting for the remaining specialists to report.' });
      break;
    }
    subagent('verifier', []);
    const output = writeOutput();
    result({ result: `Kept ${output.findings.length} findings, ${output.speculative.length} speculative, ${output.discarded.length} discarded.` });
  }
}
