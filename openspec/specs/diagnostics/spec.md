# diagnostics Specification

## Purpose
Defines the `doctor` command, which checks RepoScout's prerequisites and configuration before a run without cloning, fetching or auditing any repository and without calling Claude for an audit. Its boundary is reporting: it prints one line per check and an exit code, and changes no configuration.

## Requirements

### Requirement: Doctor touches no repository
The `doctor` command SHALL check prerequisites without cloning, fetching or auditing any repository and without starting a Claude session other than asking the `claude` executable for its version.

#### Scenario: Doctor on a configured installation
- **WHEN** `node dist/cli.js doctor` is run with repositories configured
- **THEN** no clone or fetch happens and `workspace/` is not touched

### Requirement: One line per check
The `doctor` command SHALL print one line per check in the form `<status> <check name>: <detail>`, where the status is `ok` for a passed check, `WARN` for a passed check worth reading and `FAIL` for a failed one, and every check runs even when an earlier one failed.

#### Scenario: A failure does not stop later checks
- **WHEN** the `claude` executable is not found but `repos.yaml` is valid
- **THEN** the output has a `FAIL` line for the claude CLI and still reports the repos.yaml, database and agents checks

### Requirement: Doctor exit code
The `doctor` command SHALL exit with code 0 when every check passed, warnings included, and with code 1 when any check failed.

#### Scenario: Only warnings
- **WHEN** every check passes and one reports `WARN`
- **THEN** `doctor` exits with code 0

#### Scenario: A failed check
- **WHEN** any check reports `FAIL`
- **THEN** `doctor` exits with code 1

### Requirement: Node version check
The `doctor` command SHALL check that Node.js is at least 22.12, reporting the running version, and fail that check on an older one.

#### Scenario: Old Node
- **WHEN** `doctor` runs on Node 22.11
- **THEN** the `node >= 22.12` check fails showing `22.11`

### Requirement: Data directory report
The `doctor` command SHALL report the data directory in use, marked `(REPOSCOUT_HOME)` when `REPOSCOUT_HOME` moved it out of the RepoScout directory.

#### Scenario: Moved data directory
- **WHEN** `REPOSCOUT_HOME` is set
- **THEN** the data directory line shows that path followed by `(REPOSCOUT_HOME)`

### Requirement: Environment check
The `doctor` command SHALL load `.env` from the data directory and fail the environment check when `ANTHROPIC_API_KEY` is set, reporting `ANTHROPIC_API_KEY not set` otherwise.

#### Scenario: API key set
- **WHEN** `ANTHROPIC_API_KEY` is set in the environment or `.env`
- **THEN** the environment check fails with the message that RepoScout runs on the Claude subscription only

### Requirement: Claude CLI check with override
The `doctor` command SHALL run the Claude executable with `--version` (timing out after 30 seconds) and report its version; when `REPOSCOUT_CLAUDE_BIN` is set it SHALL use that executable instead of `claude` from `PATH`, running a `.js` or `.mjs` path with the current Node, and name the override in the detail.

#### Scenario: Claude missing
- **WHEN** `REPOSCOUT_CLAUDE_BIN` is unset and `claude` is not on `PATH`
- **THEN** the claude CLI check fails with `claude not found on PATH`

#### Scenario: Override answers
- **WHEN** `REPOSCOUT_CLAUDE_BIN` points to a script that answers `--version`
- **THEN** the check passes showing the version followed by `(REPOSCOUT_CLAUDE_BIN: <path>)`

#### Scenario: Override does not answer
- **WHEN** `REPOSCOUT_CLAUDE_BIN` points to an executable that does not answer `--version` successfully
- **THEN** the check fails saying that `REPOSCOUT_CLAUDE_BIN (<path>) did not answer --version`

### Requirement: Configuration check
The `doctor` command SHALL load the configuration file given by `--config` (default `repos.yaml`, relative to the data directory) with the same validation as a run, reporting the number of repositories or the validation error.

#### Scenario: Valid configuration
- **WHEN** `repos.yaml` lists three valid repositories
- **THEN** the repos.yaml check reports `3 repositories`

#### Scenario: Invalid configuration
- **WHEN** `repos.yaml` has an invalid entry
- **THEN** the repos.yaml check fails with the same message a run would print
- **AND** no PAT, token or verification checks are made for repositories

### Requirement: Token checks
The `doctor` command SHALL check, once per distinct `pat_env` among Azure DevOps repositories, that the variable is set, without checking GitHub tokens, and SHALL check that `CLAUDE_CODE_OAUTH_TOKEN` is set when any repository uses `claude.auth: isolated`; it MUST NOT print any token value.

#### Scenario: Missing Azure DevOps PAT
- **WHEN** an Azure DevOps repository uses `REPOSCOUT_ADO_PAT` and it is unset
- **THEN** the `PAT in REPOSCOUT_ADO_PAT` check fails saying the variable is not set

#### Scenario: Missing OAuth token
- **WHEN** a repository uses `claude.auth: isolated` and `CLAUDE_CODE_OAUTH_TOKEN` is unset
- **THEN** that check fails with `missing; run claude setup-token and add it to .env`

### Requirement: Test command verification report
For each repository with a `test_command`, the `doctor` command SHALL report whether it runs in the Claude Code sandbox, and on a platform without one SHALL report a `WARN` saying either that verification is disabled and the command ignored, or, with `test_command_unsandboxed: true`, that it runs without a sandbox with the user's rights and network.

#### Scenario: Native Windows without opt-in
- **WHEN** `doctor` runs on native Windows and a repository sets `test_command` without `test_command_unsandboxed`
- **THEN** a `WARN` line for that repository says verification is disabled because Claude Code has no sandbox, and how to opt in

#### Scenario: Sandboxed platform
- **WHEN** `doctor` runs on Linux and a repository sets `test_command`
- **THEN** its line is `ok` with `test_command runs in the Claude Code sandbox`

### Requirement: Webhook report without secrets
The `doctor` command SHALL validate the `notifications` section and report the number of webhooks or `none configured`, then for each webhook report its name, format, minimum severity and whether failures are included, failing when its `url_env` variable is unset or not an http(s) URL; it MUST NOT print the URL.

#### Scenario: Webhook variable set
- **WHEN** a webhook's `url_env` holds an https URL
- **THEN** its line passes with `<url_env> set` and the URL does not appear in the output

#### Scenario: Webhook variable not a URL
- **WHEN** a webhook's `url_env` holds a value that is not an http(s) URL
- **THEN** its line fails with `<url_env> is set but is not an http(s) URL`

#### Scenario: Webhook variable unset
- **WHEN** a webhook's `url_env` variable is unset
- **THEN** its line fails with `<url_env> is not set`

### Requirement: Database check
The `doctor` command SHALL open `state/reposcout.db` in the data directory and report its path, schema version and number of repositories it holds, failing the check when it cannot be opened.

#### Scenario: Database reported
- **WHEN** `doctor` runs on an installation with state for two repositories
- **THEN** the database line shows the database path, its schema version and `2 repositories`

### Requirement: Agents check
The `doctor` command SHALL build the agent definitions from the agent prompts with the first repository's models and list the agent names, failing the check when they cannot be built.

#### Scenario: Agents listed
- **WHEN** the agent prompt files are present
- **THEN** the agents line lists the specialist and verifier agent names
