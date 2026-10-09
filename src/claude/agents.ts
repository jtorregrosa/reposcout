import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { ANALYZERS, type Analyzer, isAnalyzer } from '../config/analyzers.js';
import type { ClaudeConfig } from '../config/config.js';

export interface AgentDefinition {
  description: string;
  prompt: string;
  tools: string[] | undefined;
  model: string | undefined;
  maxTurns?: number;
}

type Role = 'specialists' | 'verifier';

function readAgent(file: string) {
  const text = readFileSync(file, 'utf8');
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(text);
  if (!m) throw new Error(`${file}: missing frontmatter`);
  const meta = (parse(m[1] as string) ?? {}) as { name?: string; description?: string; tools?: string | string[]; model?: string };
  const tools =
    typeof meta.tools === 'string'
      ? meta.tools
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean)
      : meta.tools;
  return { name: String(meta.name), description: String(meta.description ?? ''), tools, model: meta.model, prompt: (m[2] as string).trim() };
}

// The .md files stay the source of truth; only the model is swapped for the one configured in repos.yaml.
// Only the selected specialists are passed in, so the orchestrator cannot dispatch one that was left out.
export function buildAgents({
  rootDir,
  models,
  maxTurns = {},
  analyzers = ANALYZERS,
}: {
  rootDir: string;
  models: Partial<ClaudeConfig['models']>;
  maxTurns?: Partial<Record<Role, number>>;
  analyzers?: readonly Analyzer[];
}): Record<string, AgentDefinition> {
  const dir = join(rootDir, '.claude', 'agents');
  const agents: Record<string, AgentDefinition> = {};
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.md'))) {
    const a = readAgent(join(dir, file));
    if (isAnalyzer(a.name) && !analyzers.includes(a.name)) continue;
    const role: Role | null = a.name === 'verifier' ? 'verifier' : isAnalyzer(a.name) ? 'specialists' : null;
    const agent: AgentDefinition = { description: a.description, prompt: a.prompt, tools: a.tools, model: (role && models[role]) || a.model };
    // --max-turns bounds only the orchestrator; without this a runaway subagent stops only at the timeout.
    const turns = role ? maxTurns[role] : undefined;
    if (turns) agent.maxTurns = turns;
    agents[a.name] = agent;
  }
  for (const required of [...analyzers, 'verifier']) {
    if (!agents[required]) throw new Error(`.claude/agents/${required}.md is missing`);
  }
  return agents;
}
