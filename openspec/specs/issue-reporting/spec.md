# issue-reporting Specification

## Purpose
Files findings as Jira Cloud issues on an auditor's request, so the people who own the code get a ticket in their own project. Each finding gets at most one issue, and the finding keeps the link to it.

## Requirements
### Requirement: Reporting needs a configured target
RepoScout SHALL report a finding only when the top-level `jira` section is configured, its email and token variables are set, and the finding's repository resolves to a target with a project and an issue type, from its own `jira` key merged with `defaults.jira`. Otherwise reporting SHALL be refused with a message naming what is missing.

#### Scenario: No token
- **WHEN** `jira` is configured but `REPOSCOUT_JIRA_TOKEN` is not set
- **THEN** reporting is refused with a message naming `REPOSCOUT_JIRA_TOKEN`, and nothing is sent to Jira

#### Scenario: Repository without a project
- **WHEN** a repository's target has an issue type but no project
- **THEN** reporting its findings is refused with a message saying the repository has no Jira project

### Requirement: Only validated open findings are reported
RepoScout SHALL create an issue only for a finding whose status is `open` and whose stage is `validated`, and MUST refuse, with status 409 and nothing sent, a finding at any other status or stage, or one that already has a linked issue.

#### Scenario: Detected finding
- **WHEN** a report is requested for an open finding at `detected`
- **THEN** it is refused with status 409 and no request reaches Jira

#### Scenario: Already reported
- **WHEN** a report is requested for a finding that already has a linked issue
- **THEN** it is refused with status 409 naming the existing issue key

### Requirement: Fields from Jira's create metadata
RepoScout SHALL build the fields of a report from Jira's create metadata for the target project and issue type. It SHALL include every field Jira marks required, the parent, labels, and every field the target sets a default for. For each field it SHALL give its name, type, whether it is required, and the allowed options when Jira lists them. A default for a field the metadata does not offer SHALL be reported as an error, never sent.

#### Scenario: Required custom field
- **WHEN** the target project requires a `Team` select field that the target sets no default for
- **THEN** the field is listed as required, with its allowed options and no value

#### Scenario: Default for an unknown field
- **WHEN** the target sets a default for `customfield_99999`, which the issue type does not offer
- **THEN** that default is reported as not available for this issue type, and creation is refused until it is removed or changed

### Requirement: Field values sent in Jira's shape
RepoScout SHALL send each field value in the shape Jira expects for its type. It SHALL refuse, naming the field, a value that does not fit the type or is not one of its allowed options. The types are:
- a select or a multi-select, by option value or id;
- a user, by account id;
- a sprint, by sprint id among the active and future sprints of the project's boards;
- a date, as `YYYY-MM-DD`;
- a number;
- text;
- labels without spaces.

#### Scenario: Select default by value
- **WHEN** the target sets `Severity: High` and `High` is an allowed option of that field
- **THEN** the issue is created with that option selected

#### Scenario: Value outside the options
- **WHEN** the auditor sends `Severity: Urgent` and `Urgent` is not an allowed option
- **THEN** the request is refused naming the `Severity` field, and no issue is created

### Requirement: Parent search
RepoScout SHALL find parents by key or by words of the summary among the not-done issues of the target project. These are the issues whose type sits one hierarchy level above the issue type being created. It SHALL accept a default parent only after confirming the issue exists and its type can be a parent there.

#### Scenario: Searching epics
- **WHEN** the target creates Bugs and the auditor types `checkout` in the parent search
- **THEN** the not-done epics of the project whose summary matches `checkout` are listed with their key and summary

#### Scenario: Default parent that cannot be a parent
- **WHEN** the target's default parent is a Bug
- **THEN** the form shows that the default parent cannot be a parent for this issue type and leaves the parent empty

### Requirement: Issue content built from the finding
RepoScout SHALL create the issue with:
- the finding's title as summary, cut to 255 characters;
- a description holding the repository, file, line and commit, the severity, category and type, the scenario, why it is a bug, the reproduction steps, the anchored code as a code block, the suggested fix and the fingerprint;
- the labels `reposcout` and `reposcout-<fingerprint>` alongside the configured labels.

Text from the finding MUST be sent as text, never as markup.

#### Scenario: Created issue
- **WHEN** a validated finding is reported
- **THEN** the issue's summary is the finding's title, its description holds every section listed, and its labels include `reposcout-<fingerprint>`

#### Scenario: Markup in a finding
- **WHEN** a finding's description contains Jira or HTML markup
- **THEN** the markup appears literally in the issue's description

### Requirement: One issue per finding
RepoScout MUST NOT create a second issue for a finding. Before creating one, it SHALL search the target project for an issue labelled `reposcout-<fingerprint>`. When it finds one, it SHALL link that issue instead of creating another.

#### Scenario: Earlier creation lost its link
- **WHEN** an issue labelled with a finding's fingerprint exists in Jira but the finding has no link
- **AND** the auditor reports the finding
- **THEN** that issue is linked to the finding and no new issue is created

### Requirement: Link recorded with the stage
When an issue is created or found for a finding, RepoScout SHALL record its key, its URL on the site and who reported it and when. It SHALL move the finding to `reported`, in one transaction. A failure to reach Jira or a refusal from Jira SHALL change nothing locally and SHALL return Jira's message, per field when Jira gives one.

#### Scenario: Reported
- **WHEN** an issue `API-42` is created for a finding
- **THEN** the finding shows `API-42` with its URL, its stage is `reported`, and its stage history names the auditor

#### Scenario: Jira refuses the request
- **WHEN** Jira answers 400 because a required field is empty
- **THEN** no link is recorded, the stage stays `validated`, and the error names the field

### Requirement: Unlinking an issue
RepoScout SHALL let an auditor unlink a finding's issue. Unlinking SHALL remove the link and return the finding from `reported` to `validated`, recorded in its stage history. It MUST NOT change or delete the issue in Jira. Unlinking a finding with no link SHALL be refused with status 404.

#### Scenario: Issue filed by mistake
- **WHEN** an auditor unlinks `API-42` from a finding
- **THEN** the finding has no issue, its stage is `validated`, and `API-42` is unchanged in Jira

### Requirement: Reports in a batch are independent
When several findings are reported together, RepoScout SHALL apply the same shared field values to each and create one issue per finding, one at a time, with each finding's own summary and description. A refusal or failure for one finding SHALL NOT stop the others, and the outcome of each SHALL be returned.

#### Scenario: One of three fails
- **WHEN** three findings are reported together and Jira refuses the second
- **THEN** the first and third get their issues and move to `reported`, and the second is reported as refused with Jira's message

### Requirement: Rate limits
When Jira answers 429, RepoScout SHALL wait for the time Jira gives in `Retry-After`, up to 10 seconds, and retry once. If Jira still refuses, it SHALL fail that request with a message saying Jira is rate limiting.

#### Scenario: Throttled once
- **WHEN** Jira answers 429 with `Retry-After: 2` and then accepts
- **THEN** the issue is created after the wait
