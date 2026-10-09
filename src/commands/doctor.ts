import { resolve } from 'node:path';
import { buildAgents } from '../claude/agents.js';
import { claudeVersion } from '../claude/session.js';
import { loadConfig, loadNotifications, type RepoConfig, type WebhookConfig } from '../config/config.js';
import { ExitCode, errorMessage } from '../errors.js';
import { layout, PACKAGE_DIR, ROOT } from '../paths.js';
import { loadEnv, readPat } from '../security/env.js';
import { verificationFor } from '../security/sandbox.js';
import { registerSecret } from '../security/secrets.js';
import { openStore } from '../store/index.js';

const MIN_NODE: [number, number] = [22, 12];

interface Check {
  name: string;
  ok: boolean;
  // Worth reading, but not a reason to fail.
  warn?: boolean;
  detail: string;
}

export function doctorCommand({ config }: { config: string }): ExitCode {
  const checks: Check[] = [];
  const check = (name: string, fn: () => string) => {
    try {
      checks.push({ name, ok: true, detail: fn() });
    } catch (e) {
      checks.push({ name, ok: false, detail: errorMessage(e) });
    }
  };
  check(`node >= ${MIN_NODE.join('.')}`, () => {
    const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
    if (major < MIN_NODE[0] || (major === MIN_NODE[0] && minor < MIN_NODE[1])) throw new Error(process.versions.node);
    return process.versions.node;
  });
  check('data directory', () => (ROOT === PACKAGE_DIR ? ROOT : `${ROOT} (REPOSCOUT_HOME)`));
  check('environment', () => {
    loadEnv(ROOT);
    return 'ANTHROPIC_API_KEY not set';
  });
  check('claude CLI', () => {
    const bin = process.env.REPOSCOUT_CLAUDE_BIN;
    const version = claudeVersion();
    if (!version) throw new Error(bin ? `REPOSCOUT_CLAUDE_BIN (${bin}) did not answer --version` : 'claude not found on PATH');
    return bin ? `${version} (REPOSCOUT_CLAUDE_BIN: ${bin})` : version;
  });
  let repos: RepoConfig[] = [];
  check('repos.yaml', () => {
    repos = loadConfig(resolve(ROOT, config));
    return `${repos.length} repositories`;
  });
  // GitHub tokens are optional (public repositories), so only Azure DevOps PATs are required here.
  for (const name of new Set(repos.filter((r) => r.provider === 'azure-devops').map((r) => r.pat_env))) {
    check(`PAT in ${name}`, () => {
      readPat(name);
      return 'set';
    });
  }
  if (repos.some((r) => r.claude.auth === 'isolated')) {
    check('CLAUDE_CODE_OAUTH_TOKEN (claude.auth: isolated)', () => {
      if (!process.env.CLAUDE_CODE_OAUTH_TOKEN) throw new Error('missing; run `claude setup-token` and add it to .env');
      return 'set';
    });
  }
  for (const repo of repos.filter((r) => r.test_command)) {
    const v = verificationFor(repo);
    checks.push({ name: `verification for ${repo.name}`, ok: true, warn: !!v.warning, detail: v.warning ?? 'test_command runs in the Claude Code sandbox' });
  }
  // Whether each webhook's URL variable is set and looks like a URL; the value itself is never printed.
  let webhooks: WebhookConfig[] = [];
  check('notifications', () => {
    webhooks = loadNotifications(resolve(ROOT, config));
    return webhooks.length ? `${webhooks.length} webhooks` : 'none configured';
  });
  for (const w of webhooks) {
    check(`webhook ${w.name} (${w.format}, ${w.min_severity} and above${w.on_failure ? ', failures' : ''})`, () => {
      const url = process.env[w.url_env]?.trim();
      if (!url) throw new Error(`${w.url_env} is not set`);
      registerSecret(url);
      if (!URL.canParse(url) || !/^https?:$/.test(new URL(url).protocol)) throw new Error(`${w.url_env} is set but is not an http(s) URL`);
      return `${w.url_env} set`;
    });
  }
  check('database', () => {
    const store = openStore(layout());
    return `${layout().dbFile} · schema ${store.schemaVersion} · ${store.repoNames().length} repositories`;
  });
  check('agents', () => Object.keys(buildAgents({ rootDir: PACKAGE_DIR, models: repos[0]?.claude.models ?? {} })).join(', '));
  for (const c of checks) console.log(`${c.ok ? (c.warn ? 'WARN' : 'ok  ') : 'FAIL'} ${c.name}: ${c.detail}`);
  return checks.every((c) => c.ok) ? ExitCode.Ok : ExitCode.Failed;
}
