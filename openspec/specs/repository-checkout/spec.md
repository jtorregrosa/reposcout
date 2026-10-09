# repository-checkout Specification

## Purpose
Repository checkout fetches the branch head of each audited repository into a read-only local clone under `workspace/<name>`, with bounded git timeouts, hardened git configuration, untrusted Claude configuration kept out of the working tree, and credentials passed only through the environment. It ends when the clone sits at the fetched head; what is selected from it belongs to file-selection.

## Requirements

### Requirement: Shallow fetch into the workspace
For each repository RepoScout SHALL fetch only the configured branch at depth 1, without tags, into `workspace/<name>`, initialising the clone on first use, then check out the fetched head detached and remove every untracked and ignored file.

#### Scenario: First run
- **WHEN** a repository is audited and `workspace/<name>` has no clone
- **THEN** the CLI initialises one, fetches the branch head at depth 1 and checks it out detached

#### Scenario: Leftover files
- **WHEN** the existing clone holds untracked or ignored files from an earlier run
- **THEN** they are removed before the audit

### Requirement: Provider-specific remote URLs
RepoScout SHALL fetch from `https://dev.azure.com/<organization>/<project>/_git/<repo>` for `azure-devops`, from `https://github.com/<organization>/<repo>.git` for `github`, and from the file URL of `path` for `local`, with each URL component percent-encoded.

#### Scenario: GitHub repository
- **WHEN** a repository has `provider: github`, `organization: acme` and `repo: api`
- **THEN** it is fetched from `https://github.com/acme/api.git`

### Requirement: Git timeouts
RepoScout SHALL stop a git clone, fetch, pull or ls-remote after 15 minutes and any other git command after 2 minutes, and SHALL fail that repository with an error that git timed out, even where the command's failure would otherwise be tolerated.

#### Scenario: Hung remote
- **WHEN** a fetch has not finished after 15 minutes
- **THEN** git is stopped and the repository fails with "git fetch timed out after 15 min and was stopped"
- **AND** the run continues with the next repository

### Requirement: Low-speed abort
RepoScout SHALL configure git to abort an HTTP transfer slower than 1000 bytes per second for 120 seconds.

#### Scenario: Stalled transfer
- **WHEN** a fetch transfers less than 1 KB/s for 2 minutes
- **THEN** git aborts it and the repository fails

### Requirement: Read-only clone hardening
RepoScout SHALL set the clone's push URL to one that cannot work, point `core.hooksPath` at an empty directory, disable the credential helper and fsmonitor, skip LFS downloads, disable submodule recursion and terminal prompts, so no git command run for the audit can push, run repository hooks, prompt or fetch submodules.

#### Scenario: Push attempt
- **WHEN** any git push is attempted from `workspace/<name>`
- **THEN** it fails because the push URL is not a working remote

#### Scenario: Repository ships hooks
- **WHEN** the audited repository contains git hooks
- **THEN** none of them run during fetch or checkout

### Requirement: Untrusted Claude configuration never checked out
RepoScout MUST keep the repository's `.claude/` directory, `CLAUDE.local.md` and `.mcp.json` out of the working tree of every clone.

#### Scenario: Repository with its own Claude config
- **WHEN** the audited repository contains `.claude/settings.json`, `CLAUDE.local.md` and `.mcp.json`
- **THEN** none of them exist in `workspace/<name>` after checkout

### Requirement: Credentials only through environment headers
RepoScout SHALL pass repository credentials to git only as an `Authorization` header set through `GIT_CONFIG_*` environment variables, never in argv, a URL or `.git/config`, and SHALL register the token and its encoded header form for redaction.

#### Scenario: Clone config after a fetch
- **WHEN** a private repository has been fetched with a PAT
- **THEN** neither the remote URL nor `.git/config` of the clone contains the PAT

### Requirement: Azure DevOps credentials
For `azure-devops` RepoScout SHALL send `Authorization: Bearer <token>` when `REPOSCOUT_ADO_BEARER` is set, and otherwise a Basic header built from the PAT in the variable named by `pat_env` (default `REPOSCOUT_ADO_PAT`), failing the repository when that variable is unset.

#### Scenario: Pipeline bearer
- **WHEN** `REPOSCOUT_ADO_BEARER` is set
- **THEN** the fetch authenticates with that bearer token and no PAT is required

#### Scenario: Missing PAT
- **WHEN** neither `REPOSCOUT_ADO_BEARER` nor the `pat_env` variable is set
- **THEN** the repository fails with an error that the PAT variable is not set

### Requirement: GitHub credentials
For `github` RepoScout SHALL send a Basic header with user `x-access-token` and the token in the variable named by `pat_env` (default `REPOSCOUT_GITHUB_TOKEN`) when it is set, and SHALL fetch without credentials when it is not.

#### Scenario: Public GitHub repository
- **WHEN** a `github` repository is audited and `REPOSCOUT_GITHUB_TOKEN` is unset
- **THEN** the fetch proceeds without an `Authorization` header

### Requirement: Earlier audited commit fetched on demand
In incremental mode, when an analyzer's last audited commit is missing from the shallow clone, RepoScout SHALL fetch that commit at depth 1, and when it is no longer reachable SHALL log a warning and audit the repository in full mode instead.

#### Scenario: Force-pushed branch
- **WHEN** the last audited commit no longer exists on the remote
- **THEN** a warning says it is no longer reachable and the repository is audited in full mode
