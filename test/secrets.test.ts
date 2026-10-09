import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'vitest';
import { authHeaderFor } from '../src/git/git.js';
import { loadEnv } from '../src/security/env.js';
import { redact } from '../src/security/secrets.js';

const gone = (text: string, secret: string) => {
  const out = redact(text);
  assert.ok(!out.includes(secret), `${secret} survived in: ${out}`);
  assert.ok(out.includes('[REDACTED'), out);
};

describe('token patterns', () => {
  it('redact provider tokens by their formats', () => {
    for (const token of [
      'github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456',
      'glpat-xY9_abcdefghijKLMNOPqrst',
      `npm_${'aB3d'.repeat(9)}`,
      `sk_live_${'4eC39HqLyjWDarjtT1zdp7dc'}`,
      `rk_live_${'51HxYzAbCdEfGhIjKlMnOpQr'}`,
      'ya29.a0AfH6SMBx-abcdefghijklmnopqrstuvwxyz_0123',
      `xoxe.xoxp-${'1-Mi0yLTEyMzQ1Njc4OTAxMg'}`,
      `xoxe-${'1-My0xLTEyMzQ1Njc4OTAxMi0xMjM0'}`,
      'ghp_abcdefghijklmnopqrstuvwxyz0123456789',
    ]) {
      gone(`token in a log line: ${token} end`, token);
    }
  });

  it('redact Azure DevOps PATs in the classic and the 84-character formats', () => {
    const classic = 'abcdefghijklmnopqrstuvwxyz234567abcdefghijklmnopqrst';
    assert.equal(classic.length, 52);
    gone(`pat ${classic}`, classic);
    const current = `${'x7Kq'.repeat(13)}JQQJ99${'b'.repeat(18)}AZDO${'Zz12'}`;
    assert.equal(current.length, 84);
    gone(`pat ${current}`, current);
  });

  it('redact values of keys named like a PAT', () => {
    assert.equal(redact('ADO_PAT=abcdef123456'), 'ADO_PAT=[REDACTED]');
    assert.equal(redact('"adoPat": "abcdef123456"'), '"adoPat": "[REDACTED]"');
    assert.equal(redact("const pat = 'abcdef123456';"), "const pat = '[REDACTED]';");
    assert.equal(redact('github_pat: abcdef123456'), 'github_pat: [REDACTED]');
  });

  it('leave git SHAs, fingerprints and ordinary code alone', () => {
    for (const text of [
      'commit e83c5163316f89bfbde7d9ab23ca2e25604af290',
      '"fingerprint": "0123456789abcdef0123456789abcdef"',
      'fingerprint: deadbeefcafebabe0123456789abcdef in src/a.cs',
      'sha256 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
      'compat: "es2020-module"',
      'const path = "/usr/local/bin";',
      'const pattern = buildPattern(input);',
      'npm_install_dependencies(); sk_live is a prefix',
      `${'a1'.repeat(42)} is a long id`,
      'https://dev.azure.com/org/project/_git/repo',
    ]) {
      assert.equal(redact(text), text);
    }
  });
});

describe('registered secrets', () => {
  const added: string[] = [];
  afterEach(() => {
    for (const k of added.splice(0)) delete process.env[k];
  });

  it('include every non-trivial value of .env, whatever its name', () => {
    const root = mkdtempSync(join(tmpdir(), 'reposcout-env-'));
    writeFileSync(join(root, '.env'), 'RS_TEST_WEBHOOK=hook-value-0a1b2c3d\nRS_TEST_FLAG=1\n');
    added.push('RS_TEST_WEBHOOK', 'RS_TEST_FLAG');
    loadEnv(root);
    assert.equal(redact('posted to hook-value-0a1b2c3d'), 'posted to [REDACTED]');
    assert.equal(redact('retries 1'), 'retries 1');
  });

  it('include the encoded basic-auth value git sends', () => {
    const header = authHeaderFor({ pat: 'pat-for-basic-auth-test', user: 'x-access-token' });
    const encoded = header.replace('Authorization: Basic ', '');
    assert.equal(redact(`git trace: ${encoded}`), 'git trace: [REDACTED]');
  });
});
