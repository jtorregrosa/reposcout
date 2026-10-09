import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// A short hash of the prompts a run loads: the /audit skill and every agent file. It changes with any edit to
// them, so precision and yield can be compared before and after a prompt change. Line endings are normalised, so
// a Windows and a Linux checkout of the same prompts agree.
export function promptVersion(rootDir: string): string {
  const hash = createHash('sha256');
  const agentsDir = join(rootDir, '.claude', 'agents');
  const files = [
    join(rootDir, '.claude', 'skills', 'audit', 'SKILL.md'),
    ...(existsSync(agentsDir)
      ? readdirSync(agentsDir)
          .filter((f) => f.endsWith('.md'))
          .sort()
          .map((f) => join(agentsDir, f))
      : []),
  ];
  for (const file of files) {
    if (!existsSync(file)) continue;
    hash.update(`${file.slice(rootDir.length).replace(/\\/g, '/')}\0`);
    hash.update(readFileSync(file, 'utf8').replace(/\r\n/g, '\n'));
    hash.update('\0');
  }
  return hash.digest('hex').slice(0, 12);
}
