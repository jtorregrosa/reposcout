import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { type IncomingHttpHeaders, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { createStreamTracker } from '../src/claude/stream.js';
import { startServer } from '../src/dashboard/server.js';
import { createEventSink } from '../src/telemetry/events.js';

describe('createEventSink', () => {
  it('never lets event data overwrite the event type', async () => {
    const { readFileSync } = await import('node:fs');
    const file = join(mkdtempSync(join(tmpdir(), 'reposcout-ev-')), 'e.jsonl');
    createEventSink(file).emit('rate_limit', {
      type: 'five_hour',
      status: 'allowed',
    });
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).type, 'rate_limit');
  });
});

describe('createStreamTracker', () => {
  it('turns subagent stream messages into lifecycle events', () => {
    const events = [];
    const t = createStreamTracker({
      emit: (type, data) => events.push({ type, ...data }),
      repo: 'r',
    });
    t.handle({
      type: 'system',
      subtype: 'task_started',
      task_id: 't1',
      tool_use_id: 'u1',
      subagent_type: 'security',
      description: 'Audit auth',
    });
    t.handle({
      type: 'system',
      subtype: 'task_progress',
      task_id: 't1',
      tool_use_id: 'u1',
      description: 'Reading src/a.cs',
      usage: { total_tokens: 1200, tool_uses: 3, duration_ms: 4000 },
      last_tool_name: 'Read',
    });
    t.handle({
      type: 'system',
      subtype: 'task_notification',
      task_id: 't1',
      tool_use_id: 'u1',
      status: 'completed',
    });
    assert.deepEqual(
      events.map((e) => e.type),
      ['agent_started', 'agent_progress', 'agent_finished'],
    );
    assert.equal(events[1].agent, 'security');
    assert.equal(events[1].tokens, 1200);
    assert.equal(events[2].agent, 'security');
  });

  it('records the subscription windows and emits only when they change', () => {
    const events = [];
    const t = createStreamTracker({
      emit: (type, data) => events.push({ type, ...data }),
      repo: 'r',
    });
    const msg = {
      type: 'rate_limit_event',
      rate_limit_info: {
        status: 'allowed',
        rateLimitType: 'five_hour',
        resetsAt: 1,
        unifiedWindows: {
          five_hour: { utilization: 0.1 },
          seven_day: { utilization: 0.2 },
        },
      },
    };
    t.handle(msg);
    t.handle(msg);
    assert.equal(events.length, 1);
    assert.equal(t.rateLimit.five_hour, 0.1);
    assert.equal(t.rateLimit.seven_day, 0.2);
  });

  it('keeps the first reading of the run beside the latest, so the run can be costed', () => {
    const t = createStreamTracker({ emit: () => {}, repo: 'r' });
    const at = (u) => ({
      type: 'rate_limit_event',
      rate_limit_info: {
        status: 'allowed',
        resetsAt: 1,
        unifiedWindows: {
          five_hour: { utilization: u },
          seven_day: { utilization: 0.2 },
        },
      },
    });
    t.handle(at(0.1));
    t.handle(at(0.15));
    assert.equal(t.firstRateLimit.five_hour, 0.1);
    assert.equal(t.rateLimit.five_hour, 0.15);
  });

  it('announces the session once and sums turns over every orchestrator wake-up', () => {
    const events = [];
    const t = createStreamTracker({
      emit: (type, data) => events.push({ type, ...data }),
      repo: 'r',
    });
    t.handle({ type: 'system', subtype: 'init', model: 'm' });
    t.handle({ type: 'result', subtype: 'success', num_turns: 7 });
    t.handle({ type: 'system', subtype: 'init', model: 'm' });
    t.handle({ type: 'result', subtype: 'success', num_turns: 2 });
    assert.equal(events.filter((e) => e.type === 'claude_started').length, 1);
    assert.equal(t.turns, 9);
  });

  it('reports which subagent a blocked call came from and what it tried to run', () => {
    const events = [];
    const t = createStreamTracker({
      emit: (type, data) => events.push({ type, ...data }),
      repo: 'r',
    });
    t.handle({
      type: 'system',
      subtype: 'task_started',
      task_id: 't1',
      tool_use_id: 'agent1',
      subagent_type: 'security',
    });
    t.handle({
      type: 'assistant',
      parent_tool_use_id: 'agent1',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'call9',
            name: 'Bash',
            input: { command: 'git -C /c log | head -5' },
          },
        ],
      },
    });
    t.handle({
      type: 'system',
      subtype: 'permission_denied',
      tool_name: 'Bash',
      tool_use_id: 'call9',
      decision_reason_type: 'rule',
    });
    assert.deepEqual(events.at(-1), {
      type: 'permission_denied',
      repo: 'r',
      tool: 'Bash',
      reason: 'rule',
      agent: 'security',
      command: 'git -C /c log | head -5',
    });
  });

  it('collects the files each specialist type opened with Read', () => {
    const t = createStreamTracker({ emit: () => {}, repo: 'r' });
    t.handle({
      type: 'system',
      subtype: 'task_started',
      task_id: 't1',
      tool_use_id: 'a1',
      subagent_type: 'logic',
    });
    t.handle({
      type: 'assistant',
      parent_tool_use_id: 'a1',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'c1',
            name: 'Read',
            input: { file_path: 'D:/w/src/a.cs' },
          },
          { type: 'tool_use', id: 'c2', name: 'Grep', input: { pattern: 'x' } },
        ],
      },
    });
    assert.deepEqual([...t.reads.get('logic')], ['D:/w/src/a.cs']);
  });

  it('does not mistake a background shell command for a subagent', () => {
    const events = [];
    const t = createStreamTracker({
      emit: (type, data) => events.push({ type, ...data }),
      repo: 'r',
    });
    t.handle({
      type: 'system',
      subtype: 'task_started',
      task_id: 'b1',
      tool_use_id: 'u9',
      description: 'sleep 45; echo waiting',
    });
    t.handle({
      type: 'system',
      subtype: 'task_notification',
      task_id: 'b1',
      tool_use_id: 'u9',
      status: 'completed',
    });
    assert.deepEqual(
      events.map((e) => e.type),
      ['background_task'],
    );
  });

  it('keeps the final usage a subagent reports when it finishes', () => {
    const events = [];
    const t = createStreamTracker({
      emit: (type, data) => events.push({ type, ...data }),
      repo: 'r',
    });
    t.handle({
      type: 'system',
      subtype: 'task_started',
      task_id: 't1',
      tool_use_id: 'u1',
      subagent_type: 'logic',
    });
    t.handle({
      type: 'system',
      subtype: 'task_notification',
      task_id: 't1',
      tool_use_id: 'u1',
      status: 'completed',
      usage: { total_tokens: 9000, tool_uses: 6, duration_ms: 13000 },
    });
    assert.deepEqual(events.at(-1), {
      type: 'agent_finished',
      repo: 'r',
      task_id: 't1',
      agent: 'logic',
      status: 'completed',
      tokens: 9000,
      tool_uses: 6,
      duration_ms: 13000,
    });
  });

  it('ignores the orchestrator delegating to a subagent but reports its other tools', () => {
    const events = [];
    const t = createStreamTracker({
      emit: (type, data) => events.push({ type, ...data }),
      repo: 'r',
    });
    t.handle({
      type: 'assistant',
      parent_tool_use_id: null,
      message: {
        content: [
          { type: 'tool_use', name: 'Agent', input: {} },
          {
            type: 'tool_use',
            name: 'Write',
            input: { file_path: '/x/raw.json' },
          },
        ],
      },
    });
    assert.deepEqual(events, [
      {
        type: 'orchestrator_tool',
        repo: 'r',
        tool: 'Write',
        target: '/x/raw.json',
      },
    ]);
  });
});

interface Reply {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
}

function get(
  port: number,
  path: string,
  { host = `127.0.0.1:${port}`, method = 'GET', headers = {}, body }: { host?: string; method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<Reply> {
  return new Promise((resolvePromise, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method, headers: { host, ...headers } }, (res) => {
      let data = '';
      res.on('data', (d) => (data += d));
      res.on('end', () =>
        resolvePromise({
          status: res.statusCode,
          headers: res.headers,
          body: data,
        }),
      );
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

describe('dashboard server', () => {
  let root: string;
  let server: Server;
  let port: number;
  const eventsFile = () => join(root, 'reports', '2026-10-07', 'logs', 'run-2026-10-07T05-00-00-000Z.events.jsonl');

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'reposcout-ui-'));
    mkdirSync(join(root, 'state'), { recursive: true });
    mkdirSync(join(root, 'reports', '2026-10-07', 'logs'), { recursive: true });
    writeFileSync(
      join(root, 'repos.yaml'),
      'defaults:\n  organization: org\n  claude:\n    models: { orchestrator: sonnet, specialists: sonnet, verifier: opus }\nrepos:\n  - { name: demo, project: p, repo: demo }\n',
    );
    writeFileSync(
      join(root, 'state', 'demo.json'),
      JSON.stringify({
        last_commit: 'abc',
        last_run_at: 't2',
        eligible_files: 10,
        file_audits: { 'a.cs': 't2' },
        findings: {
          fp1: {
            status: 'open',
            first_seen: 't2',
            last_seen: 't2',
            finding: {
              file: 'a.cs',
              line: 1,
              severity: 'high',
              category: 'logic',
              title: 'x',
            },
          },
          fp2: {
            status: 'resolved',
            first_seen: 't1',
            last_seen: 't1',
            resolved_at: 't2',
            finding: {
              file: 'a.cs',
              line: 2,
              severity: 'low',
              category: 'logic',
              title: 'y',
            },
          },
        },
      }),
    );
    writeFileSync(eventsFile(), `${JSON.stringify({ ts: 't', type: 'run_started', repos: ['demo'] })}\n`);
    for (const [run, title] of [
      ['run-A', 'from run A'],
      ['run-B', 'from run B'],
    ]) {
      mkdirSync(join(root, 'reports', '2026-10-07', 'runs', run), {
        recursive: true,
      });
      writeFileSync(
        join(root, 'reports', '2026-10-07', 'runs', run, 'demo.json'),
        JSON.stringify({
          schema: 'reposcout/report@1',
          commit: 'abc',
          discarded: [{ title, file: 'a.cs', reason: 'speculative' }],
        }),
      );
    }
    const uiDir = join(root, 'web-dist');
    mkdirSync(join(uiDir, 'assets'), { recursive: true });
    writeFileSync(join(uiDir, 'index.html'), '<!doctype html><div id="root"></div>');
    writeFileSync(join(uiDir, 'assets', 'index-abc123.js'), 'console.log(1)');
    writeFileSync(join(root, 'secret.txt'), 'outside the build');
    server = await startServer({
      root,
      uiDir,
      configPath: join(root, 'repos.yaml'),
      port: 0,
      pollMs: 50,
    });
    port = (server.address() as AddressInfo).port;
  });

  afterAll(() => server.close());

  it('rejects requests whose Host is not the loopback address', async () => {
    const res = await get(port, '/api/overview', {
      host: 'attacker.example:80',
    });
    assert.equal(res.status, 403);
  });

  it('accepts no method other than GET and POST', async () => {
    assert.equal((await get(port, '/api/overview', { method: 'DELETE' })).status, 405);
    assert.equal((await get(port, '/api/overview', { method: 'POST' })).status, 404);
  });

  describe('actions', () => {
    const origin = () => `http://127.0.0.1:${port}`;
    const token = async () => JSON.parse((await get(port, '/api/session')).body).token;
    // /api/actions/cancel with no run in progress answers 409 only once every check has passed.
    const cancel = async (headers, body = '{}') => get(port, '/api/actions/cancel', { method: 'POST', headers, body });

    it('rejects a request with no Origin, or from another origin', async () => {
      const t = await token();
      assert.equal(
        (
          await cancel({
            'content-type': 'application/json',
            'x-reposcout-token': t,
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await cancel({
            origin: 'http://evil.example',
            'content-type': 'application/json',
            'x-reposcout-token': t,
          })
        ).status,
        403,
      );
    });

    it('rejects a missing or wrong session token', async () => {
      assert.equal((await cancel({ origin: origin(), 'content-type': 'application/json' })).status, 403);
      assert.equal(
        (
          await cancel({
            origin: origin(),
            'content-type': 'application/json',
            'x-reposcout-token': 'f'.repeat(64),
          })
        ).status,
        403,
      );
    });

    it('rejects a cross-site fetch and a form-encoded body', async () => {
      const t = await token();
      assert.equal(
        (
          await cancel({
            origin: origin(),
            'sec-fetch-site': 'cross-site',
            'content-type': 'application/json',
            'x-reposcout-token': t,
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await cancel(
            {
              origin: origin(),
              'content-type': 'application/x-www-form-urlencoded',
              'x-reposcout-token': t,
            },
            'a=1',
          )
        ).status,
        415,
      );
    });

    it('rejects an oversized body', async () => {
      const t = await token();
      const res = await cancel(
        {
          origin: origin(),
          'content-type': 'application/json',
          'x-reposcout-token': t,
        },
        JSON.stringify({ pad: 'x'.repeat(20000) }),
      );
      assert.equal(res.status, 413);
    });

    it('refuses a field the action does not know instead of dropping it', async () => {
      const t = await token();
      const res = await cancel(
        {
          origin: origin(),
          'content-type': 'application/json',
          'x-reposcout-token': t,
        },
        JSON.stringify({ until_covered: true }),
      );
      assert.equal(res.status, 400);
      assert.match(res.body, /unknown field until_covered/);
    });

    it('runs the action once every check passes', async () => {
      const t = await token();
      const res = await cancel({
        origin: origin(),
        'content-type': 'application/json',
        'x-reposcout-token': t,
      });
      assert.equal(res.status, 409);
      assert.match(res.body, /no run in progress/);
    });
  });

  it('serves the page with a strict content security policy', async () => {
    const res = await get(port, '/');
    assert.equal(res.status, 200);
    assert.match(String(res.headers['content-security-policy']), /script-src 'self';/);
    assert.equal(res.headers['cache-control'], 'no-store');
  });

  it('answers a client-side route with the app, so a shared link opens the right page', async () => {
    const res = await get(port, '/findings?status=new&id=abc');
    assert.equal(res.status, 200);
    assert.match(res.body, /id="root"/);
  });

  it('serves fingerprinted assets as immutable and refuses missing ones', async () => {
    const asset = await get(port, '/assets/index-abc123.js');
    assert.equal(asset.status, 200);
    assert.match(String(asset.headers['content-type']), /javascript/);
    assert.match(String(asset.headers['cache-control']), /immutable/);
    assert.equal((await get(port, '/assets/missing.js')).status, 404);
  });

  it('never serves a file outside the build directory', async () => {
    for (const path of ['/../secret.txt', '/%2e%2e/secret.txt', '/..%2fsecret.txt', '/assets/..%2f..%2fsecret.txt']) {
      const res = await get(port, path);
      assert.ok(!res.body.includes('outside the build'), path);
    }
  });

  it('answers an unknown API path with a JSON 404, not the app', async () => {
    const res = await get(port, '/api/nope');
    assert.equal(res.status, 404);
    assert.match(res.body, /not found/);
  });

  it('aggregates repositories and findings from state', async () => {
    const ov = JSON.parse((await get(port, '/api/overview')).body);
    assert.equal(ov.repos[0].name, 'demo');
    assert.equal(ov.repos[0].counts.open, 1);
    assert.equal(ov.repos[0].counts.new_last_run, 1);
    assert.equal(ov.repos[0].coverage.audited, 1);
    assert.equal(ov.repos[0].coverage.eligible, 10);
    assert.equal(ov.repos[0].coverage.by_analyzer.security, 1);
    assert.deepEqual(ov.repos[0].coverage.times.logic, ['t2']);
    assert.deepEqual(ov.repos[0].coverage.oldest_times, ['t2']);
    assert.deepEqual(ov.discarded.map((d) => d.title).sort(), ['from run A', 'from run B']);
    assert.equal(ov.findings.length, 2);
    assert.equal(ov.runs[0].run_id, 'run-2026-10-07T05-00-00-000Z');
  });

  it('refuses run ids that are not run ids', async () => {
    assert.equal((await get(port, `/api/runs/${encodeURIComponent('../../state/demo')}/events`)).status, 404);
    assert.equal((await get(port, '/api/runs/run-2026-10-07T05-00-00-000Z/events')).status, 200);
  });

  it('streams events appended after the client connected', async () => {
    const received = await new Promise<string>((resolvePromise, reject) => {
      const req = request(
        {
          host: '127.0.0.1',
          port,
          path: '/api/live',
          headers: { host: `127.0.0.1:${port}` },
        },
        (res) => {
          let buf = '';
          res.on('data', (d) => {
            buf += d;
            if (buf.includes('"type":"repo_started"')) {
              req.destroy();
              resolvePromise(buf);
            }
          });
        },
      );
      req.on('error', (e: NodeJS.ErrnoException) => (e.code === 'ECONNRESET' ? null : reject(e)));
      req.end();
      setTimeout(() => appendFileSync(eventsFile(), `${JSON.stringify({ ts: 't', type: 'repo_started', repo: 'demo' })}\n`), 150);
      setTimeout(() => reject(new Error('no live event within 3s')), 3000);
    });
    assert.match(received, /event: run\n/);
    assert.match(received, /"type":"run_started"/);
    assert.match(received, /"type":"repo_started"/);
  });
});
