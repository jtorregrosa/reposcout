## ADDED Requirements

### Requirement: Dashboard never writes execution or credential keys
The dashboard MUST NOT write `test_command`, `test_command_unsandboxed`, `path`, `claude.auth`, any key ending in `_env`, `jira.site`, `jira.fields`, a webhook's `name` or `url_env`, or an existing repository's `name`, `provider`, `organization`, `project` or `repo`. A new entry MUST use `provider` `azure-devops` or `github` and carry none of these keys except its identity and location. The dashboard MUST NOT read, show or write `.env`.

#### Scenario: New entry with a test command
- **WHEN** an Add repository request carries `test_command` or `pat_env`
- **THEN** it is refused with status 400 naming the key and repos.yaml is unchanged

#### Scenario: New local repository
- **WHEN** an Add repository request sets `provider: local`, even with `REPOSCOUT_ALLOW_LOCAL_PROVIDER=1`
- **THEN** it is refused with status 400

#### Scenario: Moving an existing repository
- **WHEN** an edit asks to change the `organization` of a configured repository
- **THEN** it is refused with status 400 and repos.yaml is unchanged

### Requirement: Test connection credentials
Test connection MUST send the repository token only to the provider's fixed host (`dev.azure.com` or `github.com`), only as an `Authorization` header through `GIT_CONFIG_*` environment variables as a clone does, never on argv or in a URL, and MUST redact the token from any error it returns. It MUST only list remote refs and write nothing to disk.

#### Scenario: Token kept off the command line
- **WHEN** Test connection checks a private Azure DevOps repository
- **THEN** the git process's arguments and the remote URL do not contain the PAT

#### Scenario: Token in a git error
- **WHEN** git's error output quotes the token
- **THEN** the result shown in the dashboard has it redacted
