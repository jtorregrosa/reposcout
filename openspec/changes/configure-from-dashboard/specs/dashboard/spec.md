## ADDED Requirements

### Requirement: Effective configuration with its origin
The Configuration tab of a repository SHALL show every key a run uses for it with its effective value and its origin: the repository entry, `defaults`, derived from another key, or built-in. It SHALL show `excluded_paths` and `facts` as the inherited entries followed by the repository's own. A key the dashboard does not edit SHALL say why and that it is changed in repos.yaml.

#### Scenario: Value inherited from defaults
- **WHEN** `defaults.claude.models.verifier` is `opus` and the repository does not set it
- **THEN** the tab shows the verifier model `opus` with origin `defaults`

#### Scenario: Derived token variable
- **WHEN** a GitHub repository sets no `pat_env`
- **THEN** the tab shows `REPOSCOUT_GITHUB_TOKEN` with origin derived from `provider`

#### Scenario: Exclusions split by origin
- **WHEN** `defaults.excluded_paths` holds `docs/**` and the repository adds `scripts/**`
- **THEN** `docs/**` is listed as inherited and `scripts/**` as the repository's own

### Requirement: Edit repository configuration
The Configuration tab SHALL edit one key at a time among the editable keys, which are `branch`, `mode`, `analyzers`, the three file caps, `focus_paths`, `focus_areas`, the repository's own `excluded_paths` and `facts`, `claude.models.*`, `claude.fallback_model`, `claude.max_turns`, `claude.subagent_max_turns.*`, `claude.timeout_minutes` and the Jira target's `project`, `issue_type`, `parent` and `labels`. A refused edit SHALL show its message next to the field.

#### Scenario: Override a model
- **WHEN** the auditor sets the specialists model of `api` to `haiku`
- **THEN** repos.yaml's `api` entry gains `claude.models.specialists: haiku` and the tab shows it with origin repository

#### Scenario: Invalid value
- **WHEN** the auditor sets `max_files_per_run` to 500
- **THEN** the edit is refused with status 400, the field shows the cap's error and repos.yaml is unchanged

#### Scenario: Key not editable
- **WHEN** an action asks to set `test_command` or any key outside the editable keys
- **THEN** it is refused with status 400 and repos.yaml is not read or written

#### Scenario: Edit after a hand edit
- **WHEN** repos.yaml was edited by hand after the page loaded and the auditor then changes one key
- **THEN** only that key changes and the hand edit is kept

### Requirement: Reset to default
Each key a repository or `defaults` sets SHALL offer Reset to default, which removes the key from that scope, and removes any object it leaves empty, so the inherited or built-in value applies again.

#### Scenario: Reset an override
- **WHEN** `api` sets `claude.max_turns: 80` as its only `claude` key and the auditor resets it
- **THEN** the `api` entry no longer has a `claude` key and the tab shows the value from `defaults` or built-in

### Requirement: Warnings before risky edits
The dashboard SHALL ask for confirmation, saying why, before removing an analyzer (its findings are only resolved by runs that include it) and before saving `facts` (the auditors trust them without checking, so a wrong one silences real findings).

#### Scenario: Removing an analyzer
- **WHEN** the auditor unticks `performance` for `api`
- **THEN** a confirmation explains that open performance findings stay open until a run includes `performance` again, and nothing is written until it is confirmed

### Requirement: Add a repository
The Repositories page SHALL offer Add repository, a form for an `azure-devops` or `github` repository with `name`, `organization`, `project` (Azure DevOps only), `repo` and `branch`, and SHALL append the entry to repos.yaml with no other keys, so it inherits `defaults`. A name already in repos.yaml SHALL be refused with status 409.

#### Scenario: GitHub repository added
- **WHEN** the auditor adds `lib` with provider `github`, organization `acme` and repo `lib`
- **THEN** repos.yaml gains an entry for `lib` with those keys only, and `lib` is listed on the Repositories page

#### Scenario: Name taken
- **WHEN** the auditor adds a repository named `api` and `api` is already configured
- **THEN** the request is refused with status 409 and repos.yaml is unchanged

#### Scenario: Name of a removed repository
- **WHEN** `api` was removed earlier and is added again with the same name
- **THEN** its page shows the findings, runs and coverage it had before

### Requirement: Test connection
Add repository SHALL offer Test connection before saving, which checks with the credentials a run would use that the branch exists on the remote, and SHALL answer reachable, branch missing, not found or no access, token missing, or failed with the redacted git error, within 20 seconds. Saving SHALL NOT require a passing test.

#### Scenario: Branch missing
- **WHEN** the repository exists but has no branch `develop` and the auditor tests with branch `develop`
- **THEN** the result says the branch is missing

#### Scenario: Azure DevOps without a token
- **WHEN** the form names an Azure DevOps repository and neither `REPOSCOUT_ADO_PAT` nor `REPOSCOUT_ADO_BEARER` is set
- **THEN** the result says the token is missing and names `REPOSCOUT_ADO_PAT`, and no request is sent

### Requirement: Remove a repository
The repository page SHALL offer Remove repository, after a confirmation saying its history is kept, which deletes its entry from repos.yaml and leaves the state database untouched. Removing the only configured repository SHALL be refused with status 409.

#### Scenario: History kept
- **WHEN** the auditor removes `api`
- **THEN** repos.yaml no longer lists `api` and the state database still holds its findings and runs

#### Scenario: Last repository
- **WHEN** repos.yaml lists one repository and the auditor removes it
- **THEN** the request is refused with status 409 and repos.yaml is unchanged

### Requirement: Settings page
The dashboard SHALL have a Settings page with sections:
- Defaults: the configuration editor applied to `defaults`, showing next to each key how many repositories inherit it and how many override it;
- Jira: the site and credential variables read-only, and the default target editable;
- Notifications: each webhook's `format`, `min_severity` and `on_failure` editable, and its `name` and `url_env` read-only;
- Credentials.

#### Scenario: Inheritance count
- **WHEN** three repositories are configured and one sets its own `max_turns`
- **THEN** the Defaults section shows `max_turns` inherited by 2 and overridden by 1

#### Scenario: Webhook severity
- **WHEN** the auditor sets the `min_severity` of webhook `team` to `critical`
- **THEN** repos.yaml's `notifications.webhooks` entry `team` has `min_severity: critical`

### Requirement: Credential checks
The Credentials section SHALL show the checks `doctor` makes, each with its outcome and detail and never a secret value, run when the section opens and on Run checks, behind the session token. It SHALL say the environment is the one loaded when `ui` started and that `.env` edits need a restart of `ui`.

#### Scenario: Jira credential accepted
- **WHEN** the Jira credential is valid
- **THEN** the section shows the Jira check passing with the account's display name and no part of the token

#### Scenario: Without the token
- **WHEN** a request for the checks arrives without `X-RepoScout-Token`
- **THEN** it is refused with status 403 and nothing is sent to Jira

## MODIFIED Requirements

### Requirement: Navigation
The dashboard SHALL group its pages in the sidebar as Work (Overview, Findings, Repositories) and Operate (Runs, Insights), with Settings at the foot of the sidebar, mark Findings with its Triage count and Runs with a live marker while a run holds the lock, and show breadcrumbs in the header for nested pages. A page that fails to load SHALL show its error inside the shell with the sidebar still usable.

#### Scenario: Triage badge
- **WHEN** 12 findings are in the Triage queue
- **THEN** the Findings entry in the sidebar shows 12

#### Scenario: Breadcrumbs on a repository
- **WHEN** the auditor opens the page of repository `api`
- **THEN** the header shows Repositories › api, with Repositories linking back to the list

#### Scenario: Page fails to load
- **WHEN** the overview request fails while the auditor is on Insights
- **THEN** the error shows in the page area and the sidebar still navigates

#### Scenario: Settings reachable
- **WHEN** the auditor clicks Settings in the sidebar
- **THEN** the Settings page opens with its Defaults section

### Requirement: Repository page
Each repository SHALL have its own page that leads with its stage pipeline, Audit this repository, Validate detected findings and Review findings, and whose menu offers Remove repository. Its tabs SHALL be:
- Findings: one matrix switchable between category and type;
- Coverage: per analyzer;
- Runs: recent Claude runs;
- Configuration: the effective configuration and its editor.

The page SHALL say that verification is off when the verifier cannot run `test_command`: the repository has none, or the platform has no Claude Code sandbox and the repository does not set `test_command_unsandboxed: true`.

#### Scenario: No test_command
- **WHEN** a repository has no `test_command`
- **THEN** its page says verification is off and the verifier confirms findings from the code alone

#### Scenario: test_command on native Windows
- **WHEN** a repository sets `test_command` without `test_command_unsandboxed` and the dashboard runs on native Windows
- **THEN** its page says verification is off because there is no sandbox, and names `test_command_unsandboxed: true` as the opt-in

#### Scenario: Unknown repository
- **WHEN** the auditor opens the page of a name not in repos.yaml
- **THEN** the page says there is no repository with that name

#### Scenario: Tab in the URL
- **WHEN** the auditor opens the Coverage tab and reloads the page
- **THEN** the Coverage tab is still selected

### Requirement: Deliberate limits of the dashboard
In repos.yaml the dashboard MUST write only a repository's `suppressed` list, the editable keys of a repository or `defaults`, a webhook's `format`, `min_severity` and `on_failure`, a new repository entry and the removal of one, and MUST NOT delete state. It MUST NOT write to Azure DevOps, GitHub or any remote other than the configured Jira site. It SHALL write there only to create an issue for a finding on an auditor's action, and MUST NOT edit, transition or delete an existing issue.

#### Scenario: No configuration editing
- **WHEN** an auditor uses any dashboard action
- **THEN** repos.yaml changes at most in those keys and entries
- **AND** no state is deleted and nothing is sent to Azure DevOps

#### Scenario: Unlinking leaves Jira alone
- **WHEN** an auditor unlinks an issue
- **THEN** no request that changes anything is sent to Jira
