import { readdirSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { sandboxSupported } from '../security/sandbox.js';

export const toPosix = (p: string): string => resolve(p).replace(/\\/g, '/');

// Permission rules take absolute paths as //<path>; on Windows the drive becomes the first segment (//d/...).
// realpath first: a rule built from an 8.3 short name (JORGE~1.TOR) never matches the long path a tool reports,
// which silently disables the rule. Paths that do not exist yet keep their resolved form.
function canonical(p: string): string {
  const abs = resolve(p);
  try {
    return realpathSync.native(abs);
  } catch {
    const parent = dirname(abs);
    return parent === abs ? abs : join(canonical(parent), basename(abs));
  }
}

export function rulePath(p: string): string {
  const posix = canonical(p).replace(/\\/g, '/');
  const drive = /^([A-Za-z]):\//.exec(posix);
  return drive ? `//${(drive[1] as string).toLowerCase()}/${posix.slice(3)}` : `/${posix}`;
}

export interface SandboxSettings {
  enabled: true;
  failIfUnavailable: true;
  autoAllowBashIfSandboxed: false;
  allowUnsandboxedCommands: false;
  network: { allowedDomains: string[]; allowLocalBinding: false; strictAllowlist: true };
  filesystem: { allowWrite: string[]; denyWrite: string[] };
}

export interface ClaudeSettings {
  permissions: { defaultMode: 'dontAsk'; allow: string[]; deny: string[] };
  disableAllHooks: true;
  sandbox?: SandboxSettings;
}

// The git commands agents may run on the clone. Not diff: see OUTSIDE_PATH_FRAGMENTS.
export const GIT_SUBCOMMANDS = ['log', 'show'] as const;

// The code the CLI runs from; an agent must never be able to rewrite it.
const SOURCE_DIRS = ['.claude', 'state', 'src', 'dist', 'ui', 'node_modules'];

// `git diff` reads any file with --no-index, and falls back to it on its own when a path argument lies outside the
// work tree, even one the shell builds from $HOME, which Claude Code expands without asking. So agents get no
// `git diff` at all (the CLI writes the diff to diff_path instead), and log and show may not name a path that
// leaves the clone either. A rule matches the command
// text as written, quotes included, and its `*` crosses spaces. Rev ranges (a..b, a...b), HEAD~1 and
// clone-relative pathspecs after `--` contain none of these fragments.
const OUTSIDE_PATH_FRAGMENTS = [
  // Absolute: POSIX, Git Bash drives (/c/...) and /dev/null; then UNC and root-relative Windows paths.
  ' /',
  ' "/',
  " '/",
  ' \\',
  ' "\\',
  " '\\",
  // Drive paths, also inside quotes or after an option's `=`.
  ':/',
  ':\\',
  // Home, which the shell expands.
  ' ~',
  // Parent-relative.
  '../',
  '..\\',
  '".."',
  "'..'",
];

// Whether a rule reads `\*` as an escaped `*` is not documented, so a fragment with a backslash is written both
// ways: under either reading, one of the two matches a single backslash followed by anything.
const backslashVariants = (f: string): string[] => (f.includes('\\') ? [f, f.replace(/\\/g, '\\\\')] : [f]);

function gitPathDenials(clone: string): string[] {
  const git = `git -C ${clone}`;
  return [
    ...OUTSIDE_PATH_FRAGMENTS.flatMap(backslashVariants).map((f) => `Bash(${git}*${f}*)`),
    `Bash(${git}* ..)`,
    `Bash(${git}* .. *)`,
    // Brace expansion builds a path the rule never sees written out: {,/etc/passwd}.
    `Bash(${git}*{*,*}*)`,
    // On Windows `C:file` is a drive path to git, and only diff turns a path argument into a file read. The rule
    // ends in `**` because a trailing `:*` is shorthand for ` *`, which would deny every diff with an argument.
    `Bash(${git} diff*:**)`,
  ];
}

const sandboxPath = (p: string): string => canonical(p).replace(/\\/g, '/');

// The sandbox lets a command write to the working directory, which is the RepoScout root. Every entry there except
// the path down to the verification worktree is taken back, so a test cannot plant hooks, state or code.
function writeDenials(rootDir: string, verifyDir: string): string[] {
  const rel = relative(resolve(rootDir), resolve(verifyDir));
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return [];
  const denied: string[] = [];
  let dir = resolve(rootDir);
  for (const part of rel.split(sep)) {
    let entries: string[] = [];
    try {
      entries = readdirSync(dir);
    } catch {
      // A directory that does not exist yet holds nothing to protect.
    }
    for (const entry of entries) if (entry !== part) denied.push(sandboxPath(join(dir, entry)));
    dir = join(dir, part);
  }
  return denied;
}

// Claude Code's sandbox confines every Bash command, the test included: no network, and writes only in the worktree
// (and the temp directory, which it always allows). It must never fall back to running unsandboxed.
function sandboxFor(rootDir: string, verifyDir: string): SandboxSettings {
  return {
    enabled: true,
    failIfUnavailable: true,
    // Permission rules stay the gate: the sandbox limits what an allowed command can do, not what is allowed.
    autoAllowBashIfSandboxed: false,
    allowUnsandboxedCommands: false,
    network: { allowedDomains: [], allowLocalBinding: false, strictAllowlist: true },
    filesystem: { allowWrite: [sandboxPath(verifyDir)], denyWrite: writeDenials(rootDir, verifyDir) },
  };
}

// Reads are scoped to what the audit needs: an unscoped "Read" let a probe subagent read files anywhere on the
// disk (credentials, SSH keys), which a prompt injection in the audited code could turn into exfiltration.
export function buildSettings({
  rootDir,
  dataDir = rootDir,
  cloneDir,
  workDir,
  outputFile,
  verifyDir,
  testCommand,
  platform = process.platform,
}: {
  rootDir: string;
  // Where .env, state/ and .claude-home/ live when REPOSCOUT_HOME moves them out of the package.
  dataDir?: string;
  cloneDir: string;
  workDir: string;
  outputFile: string;
  verifyDir: string | null;
  testCommand: string | null | undefined;
  platform?: NodeJS.Platform;
}): ClaudeSettings {
  const clone = toPosix(cloneDir);
  const readable = [cloneDir, workDir, verifyDir].filter((d): d is string => !!d).map((d) => `${rulePath(d)}/**`);
  const home = rulePath(join(dataDir, '.claude-home'));
  // Claude Code saves an oversized tool result (a wide Grep) under tool-results/ and tells the agent to Read it.
  // Without this, a subagent loses every large search result and audits blind.
  const toolResults = `${home}/projects/*/*/tool-results/**`;
  const allow = [
    'Task',
    'Agent',
    `Edit(${rulePath(outputFile)})`,
    `Read(${toolResults})`,
    ...readable.flatMap((p) => [`Read(${p})`, `Grep(${p})`, `Glob(${p})`]),
  ];
  for (const sub of GIT_SUBCOMMANDS) allow.push(`Bash(git -C ${clone} ${sub} *)`);
  // The exact command only: a trailing `*` would let the verifier append arguments the test runner executes.
  const verify = verifyDir && testCommand ? verifyDir : null;
  if (verify) allow.push(`Edit(${rulePath(verify)}/**)`, `Bash(cd ${toPosix(verify)} && ${testCommand})`);
  const deny = [
    'WebFetch',
    'WebSearch',
    'NotebookEdit',
    `Edit(${rulePath(cloneDir)}/**)`,
    `Read(${rulePath(join(dataDir, '.env'))})`,
    `Read(${rulePath(join(dataDir, '.env'))}.*)`,
    // Everything in the private config dir except tool-results. Deny beats allow and `*` in a rule crosses `/`
    // (a probe showed `home/*` also hid tool-results), so each entry is named without wildcards above it.
    ...['.claude.json', '.credentials.json', '.last-cleanup', 'policy-limits.json', 'policy-limits.json.stamp.json'].map((f) => `Read(${home}/${f})`),
    ...['backups', 'plugins', 'session-env', 'sessions', 'shell-snapshots'].map((d) => `Read(${home}/${d}/**)`),
    ...[...new Set([rootDir, dataDir])].flatMap((r) => SOURCE_DIRS.map((d) => `Edit(${rulePath(join(r, d))}/**)`)),
    'Bash(*--output*)',
    'Bash(*--ext-diff*)',
    'Bash(*--textconv*)',
    'Bash(*--exec*)',
    'Bash(*--no-index*)',
    'Bash(* -c *)',
    'Bash(*>*)',
    'Bash(*|*)',
    'Bash(*;*)',
    'Bash(*`*)',
    'Bash(*$(*)',
    // Variable expansion pastes the environment into an allowed command. Claude Code already asks before most
    // expansions, which dontAsk turns into a denial, but it treats $HOME as safe and this rule does not stop it
    // either (checked against claude 2.1.294); that is why agents have no `git diff`.
    'Bash(*$*)',
    // No rule for tabs: Claude Code normalises whitespace before matching, so `*<tab>*` matched every command with
    // a space and denied all git (checked against claude 2.1.294). The path rules catch a tab for the same reason.
    ...gitPathDenials(clone),
    'Bash(git push*)',
    'Bash(git commit*)',
    'Bash(git -C * push*)',
    'Bash(git -C * commit*)',
    'Bash(git -C * config*)',
  ];
  const settings: ClaudeSettings = { permissions: { defaultMode: 'dontAsk', allow, deny }, disableAllHooks: true };
  // Without sandbox support (native Windows) the caller has already refused verification unless the repo opted in.
  if (verify && sandboxSupported(platform)) settings.sandbox = sandboxFor(rootDir, verify);
  return settings;
}
