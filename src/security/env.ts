import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { registerSecret } from './secrets.js';

export function loadEnvFile(rootDir: string): void {
  const envFile = join(rootDir, '.env');
  if (existsSync(envFile)) {
    process.loadEnvFile(envFile);
    // .env holds credentials by convention, whatever their names, so every value in it is redacted wherever it shows.
    for (const value of Object.values(parseEnv(readFileSync(envFile, 'utf8')))) registerSecret(value);
  }
}

export function loadEnv(rootDir: string): void {
  loadEnvFile(rootDir);
  if (process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is set. RepoScout runs on the Claude subscription only; unset it and retry.');
  }
  registerSecret(process.env.CLAUDE_CODE_OAUTH_TOKEN);
}

export function readPat(envName: string): string {
  const pat = process.env[envName];
  if (!pat) throw new Error(`Environment variable ${envName} (read-only PAT) is not set.`);
  registerSecret(pat);
  return pat;
}

// A public GitHub repository clones without a token, so a missing one is not an error there.
export function readOptionalPat(envName: string): string | null {
  const pat = process.env[envName];
  if (!pat) return null;
  registerSecret(pat);
  return pat;
}

// A credential RepoScout uses itself, such as the Jira token: registered for redaction as soon as it is read.
export function readSecretEnv(envName: string): string | null {
  const value = process.env[envName];
  if (!value) return null;
  registerSecret(value);
  return value;
}
