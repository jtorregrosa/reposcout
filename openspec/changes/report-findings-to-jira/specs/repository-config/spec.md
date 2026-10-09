## ADDED Requirements

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
