## ADDED Requirements

### Requirement: Report to Jira
The finding detail SHALL offer Report to Jira for a validated open finding with no issue. It SHALL open a form prefilled from the repository's target, with the project, issue type, parent, summary, labels, the custom fields with defaults, and every field Jira requires. Each field SHALL get a control matching its type and allowed options. Creating SHALL be disabled until every required field has a value, and Jira's errors SHALL be shown next to their fields.

#### Scenario: Prefilled form
- **WHEN** the auditor opens Report to Jira on a finding of a repository whose target sets project `API`, a parent and a `Severity` default
- **THEN** the form shows project `API`, that parent, the finding's title as summary and `Severity` already selected

#### Scenario: Required field left empty
- **WHEN** Jira requires a `Team` field and the auditor has not chosen one
- **THEN** Create issue is disabled and `Team` is marked required

#### Scenario: Reporting not configured
- **WHEN** no `jira` section is configured, or the repository has no target
- **THEN** Report to Jira is not offered, and the detail says what to configure to enable it

### Requirement: Issue link on findings
A finding with a linked issue SHALL show the issue key, linking to the issue in Jira, in its detail header, in its row of the Findings list, and in the HTML and Markdown exports. The detail SHALL offer Open in Jira and Unlink issue, and Unlink issue SHALL ask for confirmation and say that the issue in Jira is left as it is.

#### Scenario: Reported finding in the list
- **WHEN** a finding in the Reported queue has issue `API-42`
- **THEN** its row shows `API-42`, linking to the issue

#### Scenario: Unlinking
- **WHEN** the auditor confirms Unlink issue
- **THEN** the finding returns to the To report queue with no issue

### Requirement: Jira lookups
The dashboard server SHALL answer the form's lookups from Jira:
- the create metadata of a project and issue type;
- the parent search;
- assignable users by name;
- the sprints of the project's boards.

Every lookup SHALL require the session token, as actions do. A lookup that fails SHALL answer with Jira's message and status, never with the credential.

#### Scenario: Lookup without the token
- **WHEN** a lookup request arrives without `X-RepoScout-Token`
- **THEN** it is refused with status 403 and nothing is sent to Jira

## MODIFIED Requirements

### Requirement: Next step actions
The finding detail SHALL lead with the actions that move the finding forward from its queue, each shown only where the existing rules allow it:
- Triage: Confirm and Not a bug.
- To report: Report to Jira when reporting is configured, otherwise Copy for a ticket.
- Reported: Open in Jira.
- Closed: Unsuppress for a suppressed finding.

Open in VS Code SHALL stay visible for every finding, and Copy for a ticket, copying the location or the fingerprint, and Unlink issue SHALL be offered from a More menu.

#### Scenario: Speculative candidate
- **WHEN** the auditor selects an undecided speculative candidate
- **THEN** the next step offers Confirm and Not a bug

#### Scenario: Validated finding
- **WHEN** the auditor selects an open finding at `validated` in a repository with a Jira target
- **THEN** the next step offers Report to Jira and Not a bug, and does not offer Confirm

#### Scenario: Validated finding without a target
- **WHEN** the auditor selects an open finding at `validated` in a repository with no Jira target
- **THEN** the next step offers Copy for a ticket and Not a bug

#### Scenario: Reported finding
- **WHEN** the auditor selects a finding at `reported` with issue `API-42`
- **THEN** the next step offers Open in Jira, and the More menu offers Unlink issue

#### Scenario: Resolved finding
- **WHEN** the auditor selects a resolved finding
- **THEN** no next step action is offered and Open in VS Code is still available

### Requirement: Bulk actions on findings
The Findings list SHALL let the auditor select findings by checkbox, by `Space` on the selected row and by shift-click for a range. With a selection, a bar SHALL offer:
- Export selection;
- Copy for tickets;
- Not a bug: applies one verdict and reason through the existing decide or suppress action, once per finding, and offers a verdict only when every selected finding allows it;
- Report to Jira: offered when every selected finding is validated, open, has no issue and resolves to the same project and issue type. It opens one form for the shared fields and creates one issue per finding.

Both Not a bug and Report to Jira SHALL report which findings succeeded and which were refused.

#### Scenario: Refuting several candidates
- **WHEN** the auditor selects three speculative candidates and refutes them with one reason
- **THEN** each is refuted with that reason and recorded in its history, and the bar reports 3 refuted

#### Scenario: Mixed selection
- **WHEN** the selection holds a speculative candidate and an open finding an auditor confirmed
- **THEN** Not a bug offers neither Refute nor Suppress and says why

#### Scenario: Partial failure
- **WHEN** one of four suppressions is refused because the fingerprint is already suppressed
- **THEN** the other three are suppressed and the result names the refused one with its reason

#### Scenario: Selection and filters
- **WHEN** the auditor changes the queue or a filter
- **THEN** findings no longer listed leave the selection

#### Scenario: Reporting several findings
- **WHEN** the auditor selects three validated findings of the same repository and reports them with one parent
- **THEN** three issues are created under that parent, each with its finding's summary and description, and the bar reports 3 reported

#### Scenario: Targets differ
- **WHEN** the selection holds findings of two repositories whose targets use different projects
- **THEN** Report to Jira is not offered, and the bar says why

### Requirement: Export the current view
The Findings page SHALL offer Export of exactly the findings the current filters show, as a self-contained printable HTML report, a Markdown report, a SARIF 2.1.0 log, or a copy of their fingerprints, and SHALL disable Export when the view is empty. The HTML and Markdown reports SHALL show each finding's issue key and link when it has one.

#### Scenario: HTML export
- **WHEN** the auditor exports the printable report with a severity filter applied
- **THEN** the browser downloads an HTML file holding only the filtered findings

#### Scenario: Reported finding exported
- **WHEN** the export holds a finding with issue `API-42`
- **THEN** the Markdown and HTML reports show `API-42` with its link

### Requirement: Deliberate limits of the dashboard
The dashboard MUST NOT change `test_command` or any repos.yaml key other than a repository's `suppressed` list, and MUST NOT delete state. It MUST NOT write to Azure DevOps, GitHub or any remote other than the configured Jira site. It SHALL write there only to create an issue for a finding on an auditor's action, and MUST NOT edit, transition or delete an existing issue.

#### Scenario: No configuration editing
- **WHEN** an auditor uses any dashboard action
- **THEN** repos.yaml changes at most in a repository's `suppressed` list
- **AND** no state is deleted and nothing is sent to Azure DevOps

#### Scenario: Unlinking leaves Jira alone
- **WHEN** an auditor unlinks an issue
- **THEN** no request that changes anything is sent to Jira
