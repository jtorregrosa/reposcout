# audit-security Specification

## Purpose
This capability states the security invariants RepoScout keeps while it audits untrusted repositories with Claude Code and serves its local dashboard: what Claude may read, write and execute, how credentials are kept out of disk, argv, tool processes and output, how repository content is kept from steering the audit, and which requests the dashboard accepts. Clone hardening itself belongs to repository-checkout and redaction of finding text to finding-intake; this capability only references them.

## Requirements

### Requirement: Read-only clones
RepoScout MUST keep audited repositories read-only: clones are hardened as described in repository-checkout (unusable push URL, no hooks, no credential helper, no LFS download, no submodules), and Claude MUST be denied Edit on anything under `workspace/<repo>`, as well as `git push`, `git commit` and `git -C <path> config`.

#### Scenario: Agent tries to edit the clone
- **WHEN** any agent attempts to edit a file under `workspace/<repo>`
- **THEN** the call is denied by policy and the file is unchanged

#### Scenario: Agent tries to commit or push
- **WHEN** an agent runs `git -C <clone> commit` or `git -C <clone> push`
- **THEN** the call is denied by policy

### Requirement: Specialists have no shell
The five specialist agents (security, concurrency, error-handling, logic, performance) MUST have only the Read, Grep and Glob tools.

#### Scenario: Specialist tool set
- **WHEN** an audit starts its specialists
- **THEN** each specialist can use Read, Grep and Glob and no Bash, Write or Edit

### Requirement: Restricted Bash for verifier and orchestrator
The verifier and the orchestrator MUST be limited in Bash to `git -C <clone> log` and `git -C <clone> show` with arguments, and to the configured `test_command` run exactly as written from the verification worktree; every other command MUST be denied without asking.

#### Scenario: Allowed git command
- **WHEN** the verifier runs `git -C <clone> log -n 5 -- src/app.ts`
- **THEN** the command is allowed

#### Scenario: Other commands
- **WHEN** an agent runs any other command, such as `curl` or `git -C <clone> diff`
- **THEN** it is denied by policy

### Requirement: Denied shell constructs
RepoScout MUST deny any Bash command containing a pipe, redirection (`>`), `;`, a backtick, `$(` or any `$`, a ` -c ` flag, `--output`, `--ext-diff`, `--textconv`, `--exec` or `--no-index`, and any git argument that is absolute, home-relative (`~`), parent-relative (`../`, `..`), a drive path or a brace expansion.

#### Scenario: Variable expansion
- **WHEN** an agent runs `git -C <clone> show HEAD:$HOME/.ssh/id_rsa`
- **THEN** the command is denied

#### Scenario: Path leaving the clone
- **WHEN** an agent runs `git -C <clone> show HEAD -- ../other/file`
- **THEN** the command is denied

### Requirement: No git diff for agents
RepoScout MUST NOT allow agents to run `git diff`, because it can read files outside the repository; the CLI SHALL instead write the diff to the file the manifest names in `diff_path`.

#### Scenario: Agent needs the diff
- **WHEN** the verifier needs the changes under audit
- **THEN** it reads the diff from `diff_path` inside the audit's `.work/` directory
- **AND** a `git -C <clone> diff` call is denied

### Requirement: Test command runs exactly as configured
The verifier MAY run `test_command` only exactly as configured, with no added arguments, only from the verification worktree `workspace/.verify/<repo>`, and that worktree MUST be removed when the audit's Claude session ends, whatever its outcome.

#### Scenario: Appended arguments
- **WHEN** the verifier runs the configured test command with an extra argument
- **THEN** the command is denied

#### Scenario: Worktree cleanup
- **WHEN** an audit with a usable `test_command` ends, successfully or not
- **THEN** `workspace/.verify/<repo>` no longer exists

### Requirement: Sandboxed test execution
On macOS, Linux and WSL2, when the repository has a `test_command`, every Bash command of that audit MUST run in Claude Code's sandbox with no network, writes only to the verification worktree and the temp directory, and `failIfUnavailable` set, so Claude refuses to start rather than run unsandboxed.

#### Scenario: Sandbox unavailable on Linux
- **WHEN** an audit with a `test_command` starts on Linux without a working sandbox
- **THEN** Claude refuses to start and the repository fails instead of running the test unsandboxed

#### Scenario: Test tries the network
- **WHEN** the test run inside the sandbox opens a network connection
- **THEN** the connection is blocked

### Requirement: No unsandboxed tests on native Windows by default
On native Windows, which has no Claude Code sandbox, RepoScout MUST ignore `test_command`, turning verification off with a warning in the log and in `doctor`, unless the repository sets `test_command_unsandboxed: true`, in which case the command runs with the user's rights and network and a warning says so.

#### Scenario: Windows without opt-in
- **WHEN** a repository with `test_command` and no `test_command_unsandboxed` is audited on native Windows
- **THEN** verification is off for that audit and a warning says why

#### Scenario: Windows with opt-in
- **WHEN** the repository sets `test_command_unsandboxed: true`
- **THEN** the verifier may run the test command unsandboxed and the log warns that it does

### Requirement: Scoped reads
Read, Grep and Glob MUST be allowed only inside the clone, that audit's `.work/` directory, the verification worktree, and the tool-results directory of the private Claude config directory; reads of `.env` and of the credentials, sessions and other files of `.claude-home/` MUST be denied.

#### Scenario: Read outside the scope
- **WHEN** a subagent reads a file outside those directories, such as a key under the user's home
- **THEN** the read is denied by policy

#### Scenario: Reading .env
- **WHEN** an agent reads `.env` in the data directory
- **THEN** the read is denied

### Requirement: Scoped writes
Claude MUST be able to write only the raw findings file in the audit's `.work/` directory and, when verification is on, files inside the verification worktree; edits of the RepoScout code and data directories (`.claude`, `state`, `src`, `dist`, `ui`, `node_modules`) MUST be denied, and the CLI alone writes reports and state.

#### Scenario: Writing state
- **WHEN** an agent tries to edit a file under `state/`
- **THEN** the call is denied

### Requirement: No web or notebook tools
Claude MUST be denied WebFetch, WebSearch and NotebookEdit, and all hooks MUST be disabled in every audit session.

#### Scenario: Web fetch
- **WHEN** an agent attempts WebFetch
- **THEN** the call is denied

### Requirement: PAT never on disk or argv
RepoScout MUST pass the repository token to git only as an `Authorization` header through `GIT_CONFIG_*` environment variables, never on the command line, in `.git/config` or in a URL.

#### Scenario: Clone with a PAT
- **WHEN** RepoScout fetches a private Azure DevOps repository
- **THEN** neither the process arguments nor the clone's git config nor its remote URL contain the PAT

### Requirement: Credentials stripped from Claude's environment
RepoScout MUST remove every `REPOSCOUT_*` variable, `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` and every `GIT_CONFIG_*` variable from Claude's environment, and with `claude.auth: login` also `CLAUDE_CODE_OAUTH_TOKEN`.

#### Scenario: PAT not visible to Claude
- **WHEN** an audit session starts with `REPOSCOUT_ADO_PAT` set
- **THEN** the Claude process environment has no `REPOSCOUT_ADO_PAT`

### Requirement: No Claude token in tool processes
RepoScout MUST set `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1` for Claude, so that `CLAUDE_CODE_OAUTH_TOKEN` and other credentials Claude Code recognises are stripped from every Bash child process, git and the test command included.

#### Scenario: Test prints its environment
- **WHEN** the test command lists its environment
- **THEN** `CLAUDE_CODE_OAUTH_TOKEN` is absent

### Requirement: Subscription only
The CLI MUST refuse to run when `ANTHROPIC_API_KEY` is set, after loading `.env`, with an error telling the user to unset it.

#### Scenario: API key set
- **WHEN** `ANTHROPIC_API_KEY` is set in the environment or in `.env`
- **THEN** the command fails with a message that RepoScout runs on the Claude subscription only

### Requirement: Isolated Claude authentication
With `claude.auth: isolated` (the default) RepoScout MUST run Claude with `CLAUDE_CONFIG_DIR` set to the private `.claude-home/` directory and authenticate it with `CLAUDE_CODE_OAUTH_TOKEN`, and MUST fail the audit with a message pointing to `claude setup-token` when that token is not set.

#### Scenario: Token missing
- **WHEN** `claude.auth` is `isolated` and `CLAUDE_CODE_OAUTH_TOKEN` is not set
- **THEN** the audit fails with a message to run `claude setup-token` or set `claude.auth: login`

### Requirement: Isolated Claude configuration
Every audit session MUST start Claude with `--setting-sources project`, `--strict-mcp-config`, permission mode `dontAsk`, the per-run settings and agents files RepoScout generates, CLAUDE.md auto-loading disabled, and the session transcript and its tool results deleted when the audit ends.

#### Scenario: User MCP servers
- **WHEN** the user has MCP servers configured in their personal Claude settings
- **THEN** none of them is available in the audit session

#### Scenario: Transcript cleanup
- **WHEN** an audit's Claude session ends
- **THEN** its transcript and tool results are removed from the Claude config directory

### Requirement: Repository content is untrusted
RepoScout MUST never check out a repository's `.claude/` directory, `CLAUDE.local.md` or `.mcp.json`, MUST disable CLAUDE.md auto-loading, and every agent prompt MUST state that repository text is data and never instructions.

#### Scenario: Repository ships a .claude directory
- **WHEN** an audited repository contains `.claude/settings.json` and `.mcp.json`
- **THEN** neither file is present in `workspace/<repo>` and neither is loaded by the audit session

### Requirement: Secret redaction in logs and reports
RepoScout MUST redact from every log line, report, work file it writes and dashboard action log every value of `.env` of 8 characters or more, the PAT and its base64 `Basic` header form, the bearer token, `CLAUDE_CODE_OAUTH_TOKEN`, and known secret patterns; redaction of finding text follows finding-intake.

#### Scenario: Basic header in git output
- **WHEN** git stderr echoes the `Authorization: Basic <base64>` header
- **THEN** the logged text shows `[REDACTED]` in place of the encoded value

#### Scenario: Value from .env
- **WHEN** a log line contains the value of any `.env` variable of 8 characters or more
- **THEN** that value appears as `[REDACTED]`

### Requirement: Dashboard listens on loopback only
The dashboard MUST listen on `127.0.0.1` only and MUST answer every request whose `Host` is not `127.0.0.1:<port>` or `localhost:<port>` with status 403, defeating DNS rebinding.

#### Scenario: Rebound host name
- **WHEN** a request reaches the dashboard with `Host: attacker.example:4477`
- **THEN** it is answered with status 403

### Requirement: Dashboard cross-site guards
The dashboard MUST refuse with status 403 any request whose `Sec-Fetch-Site` is present and neither `same-origin` nor `none`, and any action (POST to `/api/actions/<name>`) whose `Origin` is not exactly `http://127.0.0.1:<port>` or `http://localhost:<port>`; it MUST answer methods other than GET and POST with 405.

#### Scenario: Cross-site POST
- **WHEN** a page on another site posts to `/api/actions/run`
- **THEN** the request is refused with status 403 and no run starts

### Requirement: Dashboard session token
The dashboard MUST create a random token when `ui` starts, serve it only at `GET /api/session`, and refuse with status 403 any action whose `X-RepoScout-Token` header does not equal it.

#### Scenario: Missing token
- **WHEN** an action arrives with the right Origin but no `X-RepoScout-Token`
- **THEN** it is refused with status 403

### Requirement: Dashboard request bodies
Every dashboard action MUST have a `Content-Type` of `application/json` (else 415), a body of at most 16 KB (else 413) that is a JSON object with only the fields that action accepts (else 400), and every value checked against repos.yaml and the database: known repositories, fixed modes, bounded numbers, 32-hex fingerprints and paths inside the clone.

#### Scenario: Oversized body
- **WHEN** an action body exceeds 16 KB
- **THEN** it is refused with status 413

#### Scenario: Unknown field
- **WHEN** an action body carries a field the action does not accept
- **THEN** it is refused with status 400 naming the field

### Requirement: Dashboard response headers
The dashboard MUST send with every response a Content Security Policy allowing scripts, connections, fonts and images only from itself (images and fonts also as `data:`), styles from itself and inline, no framing, no base URI and no form actions, together with `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` and `Cross-Origin-Resource-Policy: same-origin`, and MUST never serve a file outside the dashboard build directory.

#### Scenario: Page load
- **WHEN** the browser loads the dashboard page
- **THEN** the response carries `script-src 'self'` and `frame-ancestors 'none'` in its Content Security Policy

#### Scenario: Path traversal
- **WHEN** a request asks for a path that resolves outside the build directory
- **THEN** no file outside it is served

### Requirement: Jira credential handling
RepoScout SHALL read the Jira email and API token only from the environment variables `jira.email_env` and `jira.token_env` name, register both as secrets to redact, and send them only in the `Authorization` header of requests to the configured site. They MUST NOT reach the browser, a log, the action log, a report or Claude's environment.

#### Scenario: Action log after a report
- **WHEN** an auditor reports a finding and the action is logged
- **THEN** the line in `dashboard-actions.jsonl` holds the request and the issue key, and neither the token nor the email

#### Scenario: Token in a Jira error
- **WHEN** Jira's error message quotes the request's credentials
- **THEN** the message shown in the dashboard has them redacted

### Requirement: Jira requests only to the configured site
RepoScout MUST send Jira requests only over HTTPS to the configured `site`, build their paths itself, and refuse to follow a redirect to another origin. Values from the dashboard, such as a project key, a parent key or a search text, MUST reach Jira only as encoded path segments, query values or JSON body fields.

#### Scenario: Redirect to another host
- **WHEN** Jira answers a request with a redirect to another host
- **THEN** the redirect is not followed and the request fails

#### Scenario: Crafted project key
- **WHEN** a lookup asks for the project `../../rest/api/3/user`
- **THEN** it is refused with status 400 and nothing is sent to Jira
