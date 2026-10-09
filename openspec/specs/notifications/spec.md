# notifications Specification

## Purpose
Defines how RepoScout announces the end of a run to the webhooks configured under the top-level `notifications` section of `repos.yaml`: what a message carries, when one is sent, the Teams, Slack and generic formats, and how delivery failures are contained. Notifications are best effort and never alter a run's state, reports or exit code; the schema of the `notifications` section and the rest of `repos.yaml` belongs to repository-config.

## Requirements

### Requirement: Webhook URL held only in a REPOSCOUT_ variable
A webhook's `url_env` MUST match `REPOSCOUT_` followed by upper-case letters, digits or underscores, so the URL is removed from Claude's environment like the PAT, and the URL itself MUST NOT appear in `repos.yaml`.

#### Scenario: Variable Claude would inherit
- **WHEN** a webhook sets `url_env: TEAMS_URL`
- **THEN** loading the configuration fails with an error that names `REPOSCOUT_`

### Requirement: One message per webhook after the last repository
After the last repository of a run, and after `summary.md` is written, RepoScout SHALL send at most one message to each configured webhook, covering every repository of the run and every pass of a sweep.

#### Scenario: Run over three repositories
- **WHEN** a run audits three repositories with one webhook configured
- **THEN** that webhook receives one message after the third repository, not one per repository

### Requirement: New findings at or above the threshold
A message SHALL list, per repository, the findings the run reported with status `new` (each once, even when several sweep passes reported it) whose severity is at or above the webhook's `min_severity`, ordered most severe first, each with severity, type, category, title, file, line and fingerprint, and the repository's branch and latest commit.

#### Scenario: Below the threshold
- **WHEN** a run reports a new medium finding and the webhook's `min_severity` is `high`
- **THEN** that finding is not in the webhook's message

#### Scenario: Existing findings excluded
- **WHEN** a run sees an open finding again with status `existing`
- **THEN** no message lists it

### Requirement: Failed and deferred repositories
When a webhook's `on_failure` is true, its message SHALL list each repository of the run that failed or was deferred, with that status and its redacted error clipped to 300 characters; when `on_failure` is false it SHALL list none. Cancelled repositories are not listed.

#### Scenario: Failure reported
- **WHEN** a repository fails and the webhook has `on_failure` true
- **THEN** the message lists that repository as `failed` with its error

### Requirement: No code or descriptions in messages
A message MUST NOT carry code, snippets, descriptions, scenarios or suggested fixes; titles MUST be redacted, collapsed to one line and clipped to 200 characters.

#### Scenario: Generic payload content
- **WHEN** a generic webhook receives a finding
- **THEN** the payload holds its severity, type, category, title, repo, file, line and fingerprint and no description, scenario or snippet

### Requirement: Nothing sent when nothing to report
RepoScout MUST NOT send a message to a webhook when, after its `min_severity` and `on_failure` filters, no finding and no failure remain; it logs that there was nothing to report.

#### Scenario: Quiet run
- **WHEN** a run reports no new finding at or above the threshold and every repository succeeds
- **THEN** no request is made to the webhook

### Requirement: Message formats
RepoScout SHALL send `teams` as an Adaptive Card message for a Teams Workflows webhook with finding text in plain text runs, `slack` as an incoming-webhook message with a fallback `text` and blocks whose finding text is escaped so it cannot form links or mentions, and `generic` as JSON with `source` `reposcout`, `run_id`, `date`, `min_severity`, `summary`, `repos` and `failures`.

#### Scenario: Slack escaping
- **WHEN** a finding title contains `<!channel>` and `&`
- **THEN** the Slack blocks carry it as `&lt;!channel&gt;` and `&amp;`

### Requirement: Teams and Slack list the 25 most severe
Teams and Slack messages SHALL list at most 25 findings, the most severe first, and state how many more findings were left out; a Slack message SHALL have at most 50 blocks.

#### Scenario: Thirty findings
- **WHEN** a Teams webhook's view holds 30 findings
- **THEN** its card lists 25 and says "…and 5 more findings; see the dashboard."

### Requirement: Delivery timeout and retry
Each webhook request SHALL be a JSON POST that times out after 10 seconds, and SHALL be retried once, after a short delay, on a 5xx response or a network error including a timeout; a 4xx response MUST NOT be retried.

#### Scenario: Transient server error
- **WHEN** the first attempt returns 503 and the second 200
- **THEN** the webhook is logged as notified after 2 attempts

#### Scenario: Client error
- **WHEN** the webhook answers 400
- **THEN** RepoScout makes no second attempt and logs the failure

### Requirement: Notification failures change nothing else
A webhook that fails, whose variable is unset, or whose URL is not http or https SHALL be skipped with a warning in the log, and MUST NOT change the state, the reports, the other webhooks' delivery or the run's exit code.

#### Scenario: Unset variable
- **WHEN** a webhook's `url_env` variable is not set
- **THEN** the log names the variable, no request is made, and the run's exit code is unaffected

### Requirement: Webhook URL never logged
RepoScout MUST redact the webhook URL from every log line, including error messages that quote it.

#### Scenario: Invalid URL error
- **WHEN** a request fails with an error message that contains the URL
- **THEN** the logged warning does not contain the URL

### Requirement: Prepare-only sends nothing
A `run --prepare-only` MUST NOT send any notification.

#### Scenario: Prepare-only run
- **WHEN** `run --prepare-only` runs with webhooks configured
- **THEN** no webhook receives a request
