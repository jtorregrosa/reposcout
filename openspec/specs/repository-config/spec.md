# repository-config Specification

## Purpose
Defines how RepoScout reads `repos.yaml` and `.env` from its data directory: which keys exist, their defaults and limits, how `defaults` combine with each repository entry, and what happens when the file is invalid. It covers configuration only; what a run does with each value belongs to the run, selection, security and notification capabilities.

## Requirements

### Requirement: Data directory
RepoScout SHALL read `repos.yaml` and `.env` and keep `state/`, `reports/`, `workspace/`, `.claude-home/` and `exports/` in the RepoScout directory, unless `REPOSCOUT_HOME` names another directory, in which case all of them live there while the code, the skill and the agent prompts still come from the RepoScout directory.

#### Scenario: Default data directory
- **WHEN** `REPOSCOUT_HOME` is not set
- **THEN** the CLI reads `repos.yaml` and `.env` from the RepoScout directory

#### Scenario: Data directory moved
- **WHEN** `REPOSCOUT_HOME` is set to a directory
- **THEN** `repos.yaml`, `.env`, `state/`, `reports/`, `workspace/`, `.claude-home/` and `exports/` are read and written under that directory
- **AND** `--config` is resolved relative to that directory

### Requirement: Configuration file location
The `run`, `doctor`, `ui`, `backfill-*` and `export sarif` commands SHALL accept `--config <path>`, defaulting to `repos.yaml` and resolved relative to the data directory, and loading SHALL fail with a message telling the user to copy `repos.example.yaml` when the file does not exist.

#### Scenario: Missing repos.yaml
- **WHEN** `node dist/cli.js run` is invoked and the configuration file does not exist
- **THEN** the CLI prints an error saying the file was not found and to copy `repos.example.yaml` to `repos.yaml`
- **AND** it exits with code 1 without auditing anything

### Requirement: Invalid configuration aborts the command
RepoScout SHALL validate every repository entry and the `notifications` section when loading `repos.yaml`, and SHALL stop at the first invalid value with a message naming the file, the repository and the offending key path, exiting with code 1 before any repository is cloned or the lock is taken.

#### Scenario: Unknown provider
- **WHEN** a repository entry sets `provider: gitlab`
- **THEN** the CLI fails with a message that the repository has an unknown "provider" and to use azure-devops or github
- **AND** the exit code is 1 and no repository is audited

#### Scenario: Empty repository list
- **WHEN** `repos.yaml` has no `repos` key or an empty `repos` list
- **THEN** loading fails with the message that "repos" must be a non-empty list

### Requirement: Defaults merged with per-repository overrides
RepoScout SHALL apply the top-level `defaults` object to every entry under `repos`, with each entry's own values overriding the defaults key by key, nested objects such as `claude` merged recursively and lists replaced, except `excluded_paths` and `facts`.

#### Scenario: Nested override
- **WHEN** `defaults.claude.models.verifier` is `opus` and one entry sets `claude.models.specialists: haiku`
- **THEN** that repository uses `haiku` for specialists and keeps `opus` for the verifier

#### Scenario: List override
- **WHEN** `defaults.focus_paths` lists one glob and an entry sets its own `focus_paths`
- **THEN** the entry's list replaces the default list

### Requirement: Excluded paths and facts add to the defaults
RepoScout SHALL build a repository's `excluded_paths` as the defaults' list followed by the entry's list, and its `facts` as the defaults' facts followed by the entry's facts, instead of letting the entry replace them.

#### Scenario: Exclusions accumulate
- **WHEN** `defaults.excluded_paths` is `["**/*.min.js"]` and an entry sets `excluded_paths: ["docs/**"]`
- **THEN** the repository excludes both `**/*.min.js` and `docs/**`

#### Scenario: Facts accumulate
- **WHEN** `defaults.facts` has one statement and an entry adds another
- **THEN** the repository's facts hold both statements, the defaults' first

### Requirement: Repository identity
Each repository entry SHALL identify its location with `organization`, `project`, `repo` and `branch`, where `name` defaults to `repo`, `branch` defaults to `main`, `organization`, `project`, `repo` and `name` accept only letters, digits, `.`, `_`, `-` and spaces, and `branch` accepts only letters, digits, `.`, `_`, `/` and `-`.

#### Scenario: Name defaults to repo
- **WHEN** an entry sets `repo: polvorapp` and no `name`
- **THEN** the repository is named `polvorapp` for its clone, state and report files

#### Scenario: Invalid identifier
- **WHEN** an entry sets `organization: "org;rm"`
- **THEN** loading fails with the message that the repository has an invalid or missing "organization"

### Requirement: Providers
The `provider` key SHALL accept `azure-devops` (the default), `github` or `local`; for `github`, `organization` is the owner and `project` defaults to it, and the clone URL is `https://github.com/<organization>/<repo>.git`, while `azure-devops` clones from `https://dev.azure.com/<organization>/<project>/_git/<repo>`.

#### Scenario: GitHub without project
- **WHEN** an entry sets `provider: github` and `organization: owner` with no `project`
- **THEN** the entry is valid and its project is `owner`

#### Scenario: Azure DevOps by default
- **WHEN** an entry sets no `provider`
- **THEN** it is treated as `azure-devops`

### Requirement: Local provider is gated
RepoScout MUST refuse `provider: local` unless the environment variable `REPOSCOUT_ALLOW_LOCAL_PROVIDER` is exactly `1`, and with it set MUST require `path`, resolved relative to the directory of `repos.yaml`; `repo`, `organization` and `project` then default to the name or the path's last segment, `local` and `local`. Only this provider lets git use the file protocol.

#### Scenario: Local refused without opt-in
- **WHEN** an entry sets `provider: local` and `REPOSCOUT_ALLOW_LOCAL_PROVIDER` is not `1`
- **THEN** loading fails with a message saying the provider is only for tests and evaluation and to set `REPOSCOUT_ALLOW_LOCAL_PROVIDER=1`

#### Scenario: Local without path
- **WHEN** `REPOSCOUT_ALLOW_LOCAL_PROVIDER=1` and an entry sets `provider: local` without `path`
- **THEN** loading fails with a message that the provider "local" has no "path"

### Requirement: Access token variables
Each repository SHALL read its read-only token from the environment variable named by `pat_env`, which defaults to `REPOSCOUT_GITHUB_TOKEN` for `github` and `REPOSCOUT_ADO_PAT` otherwise; an Azure DevOps repository fails when that variable is unset unless `REPOSCOUT_ADO_BEARER` is set, while a GitHub repository without a token clones anonymously.

#### Scenario: Custom PAT variable
- **WHEN** an Azure DevOps entry sets `pat_env: TEAM_X_PAT`
- **THEN** RepoScout reads the PAT from `TEAM_X_PAT`

#### Scenario: Missing Azure DevOps PAT
- **WHEN** an Azure DevOps repository is audited, its `pat_env` variable is unset and `REPOSCOUT_ADO_BEARER` is unset
- **THEN** that repository fails with a message that the PAT variable is not set

#### Scenario: Public GitHub repository
- **WHEN** a GitHub repository's `pat_env` variable is unset
- **THEN** the repository is cloned without credentials

### Requirement: Environment file
RepoScout SHALL load `.env` from the data directory when it exists, treat every value in it as a secret to redact, and MUST refuse to run with a message to unset it when `ANTHROPIC_API_KEY` is set after loading.

#### Scenario: API key present
- **WHEN** `ANTHROPIC_API_KEY` is set in the environment or in `.env`
- **THEN** `run` fails with the message that RepoScout runs on the Claude subscription only and the key must be unset

#### Scenario: Values redacted
- **WHEN** `.env` holds a value that later appears in a log line or finding
- **THEN** the value is redacted there

### Requirement: Analyzers
The `analyzers` key SHALL take a non-empty list, or a comma-separated string, of `security`, `concurrency`, `error-handling`, `logic` and `performance`, defaulting to all five, and SHALL reject any other name; the verifier always runs regardless of this list.

#### Scenario: Unknown analyzer
- **WHEN** an entry sets `analyzers: [security, style]`
- **THEN** loading fails with a message naming the unknown analyzer "style" and the valid names

#### Scenario: Empty analyzer list
- **WHEN** an entry sets `analyzers: []`
- **THEN** loading fails with a message that analyzers must name at least one analyzer

### Requirement: Focus areas and focus paths
The `focus_areas` key SHALL take a list of free-text priorities passed to the auditors, and `focus_paths` a list of globs whose matching non-test files rank first when the file cap applies; both default to empty lists.

#### Scenario: Focus path ranks first
- **WHEN** `focus_paths` is `["src/auth/**"]` and more files are eligible than the cap allows in an incremental run
- **THEN** source files under `src/auth/` are selected before other source files

### Requirement: Owner facts limits
The `facts` key SHALL be a list of at most 30 non-empty statements, each at most 500 characters after trimming, defaulting to an empty list, and loading SHALL fail when it is not a list, holds an empty entry, an entry over 500 characters, or more than 30 entries after merging with the defaults.

#### Scenario: Fact too long
- **WHEN** an entry has a fact of 501 characters
- **THEN** loading fails with the message that each entry in facts must be at most 500 characters

#### Scenario: Facts not a list
- **WHEN** an entry sets `facts: a federation is small`
- **THEN** loading fails with the message that facts must be a list of sentences

### Requirement: Excluded paths and always-excluded paths
The `excluded_paths` key SHALL take globs of files never audited, and RepoScout SHALL always exclude `.git/`, any `.claude/` directory, `CLAUDE.local.md` and `.mcp.json` from selection, and never check out `.claude/`, `CLAUDE.local.md` or `.mcp.json`, whatever the configuration says.

#### Scenario: Repository ships its own Claude settings
- **WHEN** an audited repository contains `.claude/settings.json` and `.mcp.json`
- **THEN** neither is checked out in the clone nor sent to the auditors

### Requirement: Test command shape
The `test_command` key SHALL be optional and, when set, MUST be one plain command containing none of `;`, `&`, `|`, `>`, `<`, backtick, `$` or a line break; `test_command_unsandboxed` SHALL be a boolean defaulting to `false`.

#### Scenario: Shell operator rejected
- **WHEN** an entry sets `test_command: "npm test && rm -rf /"`
- **THEN** loading fails with the message that test_command must be one plain command with no shell operators

#### Scenario: Non-boolean opt-in
- **WHEN** an entry sets `test_command_unsandboxed: "yes"`
- **THEN** loading fails with the message that test_command_unsandboxed must be true or false

### Requirement: File caps and the 150 ceiling
`max_files_per_run` (default 40) and `max_files_full_run` (default: `max_files_per_run`) SHALL be integers from 1 to 150, and the `--max-files` flag SHALL obey the same range; `max_file_bytes` SHALL be a positive integer defaulting to 200000, above which a file is never audited.

#### Scenario: Cap above the ceiling
- **WHEN** an entry sets `max_files_full_run: 500`
- **THEN** loading fails with a message that it must be an integer from 1 to 150 because larger runs risk the subscription limit mid-run

#### Scenario: Full cap falls back
- **WHEN** an entry sets `max_files_per_run: 60` and no `max_files_full_run`
- **THEN** a full run of that repository selects at most 60 files

### Requirement: Default mode per repository
RepoScout SHALL accept an optional per-repository `mode` of `incremental`, `full` or `speculative` as that repository's default mode, which a `--mode` flag overrides; without either, a repository runs incrementally.

#### Scenario: Flag overrides the entry
- **WHEN** an entry sets `mode: full` and the run is started with `--mode incremental`
- **THEN** that repository runs in incremental mode

### Requirement: Claude models
`claude.models.orchestrator`, `.specialists` and `.verifier` SHALL accept the aliases `haiku`, `sonnet`, `opus` or `fable`, or a full model id of the form `claude-<lowercase letters, digits and dashes>`, defaulting to `sonnet`, `sonnet` and `opus`; `claude.fallback_model` SHALL accept the same values and be optional.

#### Scenario: Unknown model
- **WHEN** an entry sets `claude.models.verifier: gpt-4`
- **THEN** loading fails with the message that it uses unknown model "gpt-4"

### Requirement: Claude limits
`claude.max_turns` SHALL be a positive integer defaulting to 60 that bounds the orchestrator only, `claude.timeout_minutes` a positive number defaulting to 45 that bounds the whole Claude session including its one resume, and `claude.subagent_max_turns` an object accepting only positive integers for `specialists` and `verifier`, with no subagent limit when unset.

#### Scenario: Unknown subagent limit key
- **WHEN** an entry sets `claude.subagent_max_turns.orchestrator: 10`
- **THEN** loading fails with the message that claude.subagent_max_turns takes positive integers for specialists or verifier

#### Scenario: Session timeout
- **WHEN** a repository's Claude session runs longer than `claude.timeout_minutes`
- **THEN** that repository fails as timed out

### Requirement: Claude authentication mode
`claude.auth` SHALL be `isolated` (the default) or `login`, overridable for one run with `--auth`; with `isolated`, Claude runs with its configuration directory at `.claude-home/` in the data directory and MUST have `CLAUDE_CODE_OAUTH_TOKEN` set, and with `login` it uses the interactive login and receives no `CLAUDE_CODE_OAUTH_TOKEN`.

#### Scenario: Isolated without token
- **WHEN** a repository uses `claude.auth: isolated` and `CLAUDE_CODE_OAUTH_TOKEN` is not set
- **THEN** its audit fails with a message to run `claude setup-token` and add the token to `.env`, or to set `claude.auth: login`

#### Scenario: Override for one run
- **WHEN** `run --auth login` is used with a repository configured as `isolated`
- **THEN** that run uses the interactive login

### Requirement: Suppressed list shape
The `suppressed` key SHALL be a list, defaulting to empty, whose entries each have a `fingerprint` of exactly 32 lowercase hex characters and a non-empty `reason`, and loading SHALL fail otherwise.

#### Scenario: Missing reason
- **WHEN** a `suppressed` entry has a fingerprint but an empty reason
- **THEN** loading fails with the message that the repository has a suppressed entry without a 32-hex fingerprint and a reason

### Requirement: Notifications section shape
The top-level `notifications` section SHALL accept only `webhooks`, a list defaulting to empty, whose entries accept only `name` (letters, digits, `.`, `_`, `-`), `url_env` (matching `REPOSCOUT_[A-Z0-9_]+`), `format` (`teams`, `slack` or `generic`), `min_severity` (`critical`, `high`, `medium` or `low`, default `high`) and `on_failure` (boolean, default `true`); the URL itself MUST NOT appear in the file.

#### Scenario: URL in the file
- **WHEN** a webhook entry has a `url` key
- **THEN** loading fails, because unknown keys are rejected

#### Scenario: Variable outside the REPOSCOUT_ prefix
- **WHEN** a webhook sets `url_env: TEAMS_URL`
- **THEN** loading fails with a message that `url_env` must be named `REPOSCOUT_<something>`

#### Scenario: No notifications section
- **WHEN** `repos.yaml` has no `notifications` key
- **THEN** no webhook is configured and nothing is sent

### Requirement: Jira section shape
The top-level `jira` section SHALL accept only these keys, and the email and token themselves MUST NOT appear in the file:
- `site`: required, `https://<name>.atlassian.net`;
- `email_env`: matching `REPOSCOUT_[A-Z0-9_]+`, default `REPOSCOUT_JIRA_EMAIL`;
- `token_env`: matching `REPOSCOUT_[A-Z0-9_]+`, default `REPOSCOUT_JIRA_TOKEN`.

#### Scenario: Site outside Jira Cloud
- **WHEN** `jira.site` is `http://jira.example.com`
- **THEN** loading fails with a message that the site must be `https://<name>.atlassian.net`

#### Scenario: Token in the file
- **WHEN** the `jira` section has a `token` key
- **THEN** loading fails, because unknown keys are rejected

### Requirement: Jira target per repository
A repository's `jira` key, set in `defaults` or in its entry, SHALL accept only:
- `project`: a Jira project key;
- `issue_type`: a name;
- `parent`: an issue key;
- `labels`: a list of strings without spaces;
- `fields`: a map from a field id or name to a default value.

It SHALL merge with `defaults.jira` key by key, `fields` field by field, with `labels` replaced. A `jira` key without a top-level `jira` section SHALL fail loading.

#### Scenario: Shared defaults with a project per repository
- **WHEN** `defaults.jira` sets `issue_type: Bug` and `fields: {Team: Security}`, and an entry sets `project: API` and `fields: {Severity: High}`
- **THEN** that repository reports Bugs to `API` with `Team` and `Severity` both defaulted

#### Scenario: Target without a site
- **WHEN** an entry sets `jira.project` and there is no top-level `jira` section
- **THEN** loading fails with a message that reporting to Jira needs the top-level `jira.site`
