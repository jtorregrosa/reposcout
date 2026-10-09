## ADDED Requirements

### Requirement: Navigation
The dashboard SHALL group its pages in the sidebar as Work (Overview, Findings, Repositories) and Operate (Runs, Insights), mark Findings with its Triage count and Runs with a live marker while a run holds the lock, and show breadcrumbs in the header for nested pages. A page that fails to load SHALL show its error inside the shell with the sidebar still usable.

#### Scenario: Triage badge
- **WHEN** 12 findings are in the Triage queue
- **THEN** the Findings entry in the sidebar shows 12

#### Scenario: Breadcrumbs on a repository
- **WHEN** the auditor opens the page of repository `api`
- **THEN** the header shows Repositories › api, with Repositories linking back to the list

#### Scenario: Page fails to load
- **WHEN** the overview request fails while the auditor is on Insights
- **THEN** the error shows in the page area and the sidebar still navigates

### Requirement: Run indicator
While a run holds the lock, the header SHALL show a run indicator naming the repository being audited, which opens a popover with each repository's progress, the elapsed time, a link to the Runs page and Cancel run.

#### Scenario: Checking a run from Findings
- **WHEN** a run is in progress and the auditor opens the run indicator on the Findings page
- **THEN** the popover lists each repository of the run with its stage and offers Cancel run without leaving the page

### Requirement: Command palette
The dashboard SHALL open a command palette with `Ctrl+K` or `⌘K` from any page. It SHALL let the auditor jump to any page, to any configured repository, and to any finding by title or fingerprint; start New audit; and switch the theme. Typing SHALL narrow the entries, and `Enter` SHALL run the highlighted one.

#### Scenario: Jumping to a finding
- **WHEN** the auditor presses `Ctrl+K`, types the first 8 characters of a fingerprint and presses `Enter`
- **THEN** the Findings page opens on the All queue with that finding selected

#### Scenario: Palette while typing
- **WHEN** the search box of the Findings page has focus and the auditor presses `Ctrl+K`
- **THEN** the palette opens

### Requirement: Keyboard shortcut list
The dashboard SHALL open a list of every keyboard shortcut, grouped by page, when the auditor presses `?` outside a field, and from the command palette.

#### Scenario: Asking for shortcuts
- **WHEN** the auditor presses `?` on the Findings page with no field focused
- **THEN** a dialog lists the global, Findings list and finding detail shortcuts

### Requirement: Overview stage pipeline
The Overview page SHALL lead with the four stages of a finding. Each stage SHALL show its counts and one action, and open its Findings queue:
- Detect: open findings and those new in the last run, with New audit.
- Validate: the Triage count with its speculative share, with Validate detected findings and Review speculative candidates.
- Report: the To report count, with Export.
- Fix: shown as not available yet, with no link.

#### Scenario: Opening a stage
- **WHEN** the auditor clicks the Validate stage
- **THEN** the Findings page opens on the Triage queue

#### Scenario: Stage not built yet
- **WHEN** the Overview is shown
- **THEN** the Fix stage says it is not available yet and is not a link

### Requirement: Validate and review from Triage
The Triage queue SHALL offer Validate detected findings when its scope holds open findings at `detected` in repositories with verification on, and Review speculative candidates when it holds speculative candidates. Each SHALL say how many findings a pass would try, in which repositories, and that it spends subscription usage, then start `run` as New audit does. Both SHALL be disabled while a run holds the lock.

#### Scenario: Validating one repository's triage
- **WHEN** Triage is filtered to repository `api`, which has verification on and 4 open findings at `detected`, and the auditor confirms Validate detected findings
- **THEN** the CLI runs detached as `run --mode validate --repo api`

#### Scenario: Reviewing speculative candidates
- **WHEN** Triage holds speculative candidates of two repositories and the auditor confirms Review speculative candidates
- **THEN** the CLI runs detached as `run --mode speculative` with both repositories

#### Scenario: Run in progress
- **WHEN** a run holds the lock
- **THEN** both actions are disabled and say a run is in progress

### Requirement: Bulk actions on findings
The Findings list SHALL let the auditor select findings by checkbox, by `Space` on the selected row and by shift-click for a range. With a selection, a bar SHALL offer Export selection, Copy for tickets and Not a bug. Not a bug SHALL apply one verdict and reason through the existing decide or suppress action, once per finding, offering a verdict only when every selected finding allows it, and SHALL report which succeeded and which were refused.

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

### Requirement: Insights page
The Insights page at `/insights` SHALL show:
- a headline of the cost per finding and per confirmed finding over the last 7 days;
- one row per Claude run with its cost, filterable by repository;
- 7-day totals;
- the yield per analyzer;
- precision per analyzer, specialists model and prompt version, as defined by usage-metrics;
- coverage across repositories with a Count audits since control.

`/usage` SHALL redirect to `/insights`.

#### Scenario: Filter by repository
- **WHEN** the auditor picks one repository
- **THEN** the rows, totals and headline cover only that repository's Claude runs

#### Scenario: Old link
- **WHEN** an auditor opens `/usage`
- **THEN** the Insights page opens at `/insights`

### Requirement: Findings work queues
The Findings page SHALL group findings into the queues Triage (default), To report, Reported, Closed and All, each showing how many findings it would hold under the current filters. Triage holds speculative candidates and open findings at `detected`; To report holds open findings at `validated`; Reported holds open findings at `reported`; Closed holds every other finding. Every finding SHALL fall in exactly one of the first four queues.

#### Scenario: Default queue
- **WHEN** the auditor opens the Findings page with no query
- **THEN** the Triage queue is selected and lists the speculative candidates and the open findings at `detected`

#### Scenario: Confirmed finding moves on
- **WHEN** the auditor confirms an open finding at `detected`
- **THEN** it leaves Triage and appears in To report, and both queue counts change by one

#### Scenario: Counts follow the filters
- **WHEN** the auditor filters by one repository
- **THEN** every queue's count shows only that repository's findings in that queue

#### Scenario: Closed findings
- **WHEN** a finding is resolved, suppressed, refuted or duplicate
- **THEN** it is listed in Closed and in no other queue but All

### Requirement: Discarded candidates reachable from Findings
The Findings page SHALL offer, beside the queues and apart from them, a link to the candidates the verifier discarded in the last 7 days with its count, listing each with its reason and the specialists that proposed it, narrowed by the repository and search filters.

#### Scenario: Discarded by verifier
- **WHEN** the auditor follows the Discarded by verifier link
- **THEN** the page lists the candidates the verifier rejected in the last 7 days, with their reason and proposing specialists, and no queue is selected

### Requirement: Next step actions
The finding detail SHALL lead with the actions that move the finding forward from its queue: Confirm and Not a bug in Triage, Copy for a ticket in To report and Reported, and Unsuppress for a suppressed finding in Closed, each shown only where the existing rules allow it. Open in VS Code SHALL stay visible for every finding, and copying the location or the fingerprint SHALL be offered from a More menu.

#### Scenario: Speculative candidate
- **WHEN** the auditor selects an undecided speculative candidate
- **THEN** the next step offers Confirm and Not a bug

#### Scenario: Validated finding
- **WHEN** the auditor selects an open finding at `validated`
- **THEN** the next step offers Copy for a ticket and Not a bug, and does not offer Confirm

#### Scenario: Resolved finding
- **WHEN** the auditor selects a resolved finding
- **THEN** no next step action is offered and Open in VS Code is still available

### Requirement: Not a bug dialog
The finding detail SHALL offer one Not a bug action whose dialog lets the auditor choose between Refute, recorded in the database as an auditor decision, and Suppress, written to repos.yaml for every later run, each available only where the decide and suppress rules allow it, with one reason of 3 to 300 characters for either. The dialog SHALL say which choice holds across runs and how each is undone.

#### Scenario: Open finding with no decision
- **WHEN** the auditor opens Not a bug on an undecided open finding
- **THEN** both Refute and Suppress are offered, with Refute selected

#### Scenario: Speculative candidate
- **WHEN** the auditor opens Not a bug on a speculative candidate
- **THEN** only Refute is offered

#### Scenario: Confirmed finding
- **WHEN** the auditor opens Not a bug on an open finding an auditor already confirmed
- **THEN** only Suppress is offered

#### Scenario: Reason too short
- **WHEN** the reason has fewer than 3 characters
- **THEN** the dialog does not submit and says why

### Requirement: Finding detail tabs
The finding detail SHALL keep its header, decision, suppression, resolution and duplicate notices above three tabs: Overview, Evidence and History. The selected tab SHALL stay selected while the auditor moves to another finding.

#### Scenario: Moving through the list on Evidence
- **WHEN** the Evidence tab is selected and the auditor presses `J`
- **THEN** the next finding opens on its Evidence tab

## MODIFIED Requirements

### Requirement: Overview page
Below the stage pipeline, the Overview page SHALL show:
- the latest run and the subscription windows;
- a Needs attention list of open critical and high findings, new ones first;
- one matrix of open findings by severity, switchable between category and type.

Every count SHALL link to the findings it counts. Coverage per repository SHALL be left to the Repositories page.

#### Scenario: Matrix cell links to findings
- **WHEN** the auditor clicks a cell of the matrix shown by type
- **THEN** the Findings page opens filtered to the open findings that cell counts

#### Scenario: Switching the matrix axis
- **WHEN** the auditor switches the matrix to Category
- **THEN** its rows become the five analyzers and its counts still add up to the open findings

#### Scenario: Nothing critical or high
- **WHEN** no critical or high finding is open
- **THEN** Needs attention says nothing critical or high is open

### Requirement: Repositories page
The Repositories page SHALL list each repository with:
- its Triage and To report counts and its open findings by severity, each linking to those findings;
- its coverage and the full runs still needed at the pace of the last five full runs;
- its last audit and health.

A Count audits since control SHALL restrict coverage to a period. A row menu SHALL offer Audit this repository and, where verification is on and findings are at `detected`, Validate detected findings.

#### Scenario: Count audits since
- **WHEN** the auditor sets Count audits since to the start of a sweep
- **THEN** coverage counts only the audits made since that instant

#### Scenario: Auditing from the list
- **WHEN** the auditor picks Audit this repository in the row of `api`
- **THEN** New audit opens with only `api` ticked

#### Scenario: Triage count
- **WHEN** the auditor clicks the Triage count of `api`
- **THEN** the Findings page opens on the Triage queue filtered to `api`

### Requirement: Repository page
Each repository SHALL have its own page that leads with its stage pipeline, Audit this repository, Validate detected findings and Review findings. Its tabs SHALL be:
- Findings: one matrix switchable between category and type;
- Coverage: per analyzer;
- Runs: recent Claude runs;
- Configuration.

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

### Requirement: Runs page
The Runs page SHALL list the run in progress and past runs beside the selected run, each with its date, mode, status and duration. The selected run SHALL show, live or replayed from its event log:
- each repository's progress through its stages;
- the subagents grouped by type, with their tokens and tool calls;
- an activity feed filterable to warnings and errors;
- the tool calls blocked by policy.

The selected run SHALL be kept in the URL.

#### Scenario: Replaying a past run
- **WHEN** the auditor picks a past run from the list
- **THEN** its event log is replayed into the same panels and the URL names that run

#### Scenario: Unknown run id
- **WHEN** a run id that is malformed or has no event log is requested
- **THEN** the dashboard answers with status 404

### Requirement: New audit
The dashboard SHALL offer New audit on the Runs page, the Overview, the Repository page, a Repositories row and the command palette, preset to its context. It summarises the run, then starts `run` detached with the ticked repositories (none means all) and one of these modes:
- Changes since the last audit (incremental);
- Whole repository (full);
- Settle speculative candidates (speculative);
- Reproduce detected findings with a test (validate).

It takes an optional cap from 1 to 150, analyzers outside validate, and in full mode a sweep with a session limit from 10 to 99 percent (default 90).

#### Scenario: Starting an audit
- **WHEN** the auditor starts a full audit of one repository with the sweep ticked
- **THEN** the CLI runs detached as `run --mode full --repo <name> --until-covered --session-limit 90`

#### Scenario: Preset from a repository
- **WHEN** the auditor opens New audit from the page of repository `api`
- **THEN** only `api` is ticked and the mode is Changes since the last audit

#### Scenario: Starting a validation pass
- **WHEN** the auditor picks Reproduce detected findings with a test, ticks one repository with verification on and sets 5 findings
- **THEN** the CLI runs detached as `run --mode validate --repo <name> --max-files 5`

#### Scenario: Repository with verification off
- **WHEN** the auditor picks Reproduce detected findings with a test
- **THEN** each repository with verification off cannot be ticked and says whether it lacks a `test_command` or a sandbox

#### Scenario: Refused while locked
- **WHEN** another run holds `state/.lock`
- **THEN** New audit is refused with status 409 naming the run in progress

#### Scenario: Invalid options
- **WHEN** the request names an unknown repository, mode or analyzer, a cap outside 1 to 150, a sweep outside full mode, a session limit without a sweep or outside 10 to 99, analyzers with validate, or validate with no selected repository whose verification is on
- **THEN** it is refused with status 400 and no run starts

### Requirement: Validate detected findings from the Repository page
The Repository page and the repository's row on the Repositories page SHALL offer Validate detected findings when the repository's verification is on and it has open findings at `detected`. The action SHALL say how many findings a pass would try and that it spends subscription usage, then start `run --mode validate --repo <name>` as New audit does, and SHALL be disabled while a run holds the lock.

#### Scenario: Starting from the repository
- **WHEN** the auditor confirms Validate detected findings on a repository with 4 open findings at `detected`
- **THEN** the CLI runs detached as `run --mode validate --repo <name>`

#### Scenario: Verification off
- **WHEN** the repository has no `test_command`, or no sandbox and no opt-in
- **THEN** the action is not shown and the Verification is off notice explains why

### Requirement: Findings filters and sort
The Findings page SHALL narrow the list by:
- repository;
- severity;
- type, including findings with no type yet;
- category;
- lifecycle stage (`detected`, `validated`, `reported` or `fixed`, several at once);
- status (`open`, `speculative`, `suppressed`, `resolved`, `refuted` or `duplicate`, several at once);
- new in the last run;
- personal data;
- a text search over title, file, description, fingerprint and repository.

Search, repository, severity and sort SHALL be always visible; the other filters SHALL sit in one Filters menu, and every active filter SHALL show as a chip that removes it. It SHALL sort by severity (default), by newest first seen, or by location.

#### Scenario: Search
- **WHEN** the auditor types part of a fingerprint in the search box
- **THEN** only findings whose title, file, description, fingerprint or repository contain it are listed

#### Scenario: Stage filter
- **WHEN** the auditor selects the stages `validated` and `fixed`
- **THEN** only findings at one of those stages are listed
- **AND** each queue counts only findings at those stages

#### Scenario: Removing a filter from its chip
- **WHEN** the category filter `security` is active and the auditor removes its chip
- **THEN** the category filter is cleared and the list and counts widen accordingly

#### Scenario: New in the last run
- **WHEN** the auditor turns on New in the last run
- **THEN** only open findings first reported by the last run of their repository are listed

### Requirement: Findings view state in the URL
The Findings page MUST keep the queue, every filter, the sort, the selected finding and its detail tab in the URL query (`queue`, `status`, `new`, `repo`, `severity`, `category`, `kind`, `stage`, `pd`, `q`, `sort`, `id`, `tab`, `view`), so a view can be bookmarked, shared and walked back with the back button. Values it does not know MUST be ignored. A `status` with no `queue` MUST open the All queue filtered to that status; `status=new` MUST turn on New in the last run; `status=all` MUST open All.

#### Scenario: Shared link
- **WHEN** an auditor opens a Findings URL another auditor sent
- **THEN** the same queue, filters, sort, selected finding and detail tab are shown

#### Scenario: Unknown stage in the URL
- **WHEN** a Findings URL has `stage=validated,shipped`
- **THEN** the stage filter holds only `validated`

#### Scenario: Link from before the queues
- **WHEN** an auditor opens `/findings?status=resolved&repo=api`
- **THEN** the All queue is selected with the status filter `resolved` and the repository `api`

#### Scenario: Old New tab link
- **WHEN** an auditor opens `/findings?status=new`
- **THEN** the All queue is selected with New in the last run on, listing the same findings the New tab listed

### Requirement: Finding detail
The selected finding SHALL open beside the list and show in its header its severity, category, status, title, file and line, type and personal-data mark, and a compact progress bar of its lifecycle stage, then any unconfirmed point, suppression reason, resolution or auditor decision. Its tabs SHALL show:
- Overview: the scenario, reproduction steps, why it is a bug, the suggested fix and the anchored code;
- Evidence: its validation attempts with date, outcome and reason, the reproduction test, the last speculative review, its confidence and specialists;
- History: its stage as a four-step timeline (detected, validated, reported, fixed) with the current step and the date each reached step was entered, its status history with each status linked to the run that set it, first and last seen, commit and fingerprint.

#### Scenario: Speculative candidate selected
- **WHEN** the auditor selects a speculative candidate
- **THEN** the header shows what the verifier could not confirm and the Evidence tab shows the evidence

#### Scenario: History
- **WHEN** a finding is selected and the auditor opens History
- **THEN** it lists every status the finding has had, each linked to the run that set it

#### Scenario: Stage timeline
- **WHEN** the auditor opens History for a finding that was validated by an auditor and later resolved
- **THEN** the timeline marks `fixed` as current, shows the dates it entered `detected`, `validated` and `fixed`, and leaves `reported` as not reached

#### Scenario: Unsuccessful attempts
- **WHEN** the auditor opens Evidence for an open finding at `detected` that two validation passes could not reproduce
- **THEN** it lists both attempts with their outcomes and reasons, and says validation passes no longer try it

### Requirement: Keyboard navigation
The Findings page SHALL move to the next finding with `J` or Down arrow and the previous with `K` or Up arrow, toggle the selected finding in the bulk selection with `Space`, focus the search box with `/`, close the selected finding with `Esc`, open Confirm with `C`, open Not a bug with `X` and open the finding in VS Code with `O`. An action key SHALL do nothing when the action is not offered for the selected finding. Every key SHALL be ignored while typing in a field, while a dialog is open or with a modifier key held.

#### Scenario: Stepping through the list
- **WHEN** the auditor presses `J` with no field focused
- **THEN** the next finding in the filtered list is selected

#### Scenario: Typing in search
- **WHEN** the search box has focus and the auditor types `j`
- **THEN** the letter goes into the search and the selection does not move

#### Scenario: Not a bug from the keyboard
- **WHEN** an open finding is selected and the auditor presses `X`
- **THEN** the Not a bug dialog opens for it

#### Scenario: Action not offered
- **WHEN** a resolved finding is selected and the auditor presses `C`
- **THEN** nothing happens

### Requirement: Suppress a finding
The finding detail SHALL offer Suppress for open findings through the Not a bug dialog, requiring a reason of 3 to 300 characters (control characters and repeated whitespace collapsed to one line), which adds a `fingerprint` and `reason` entry under the repository's `suppressed` list in repos.yaml.

#### Scenario: Suppressing
- **WHEN** the auditor suppresses an open finding with a valid reason
- **THEN** repos.yaml gains the entry under that repository's `suppressed`
- **AND** the finding shows as suppressed and pending

#### Scenario: Refused suppression
- **WHEN** the reason is missing or outside 3 to 300 characters, the fingerprint is not 32 hex characters, the repository is unknown or the finding is not in the database
- **THEN** the request is refused with status 400
- **AND** an already suppressed fingerprint is refused with status 409

### Requirement: Decide a finding
The finding detail SHALL offer Confirm for speculative candidates and for open findings at `detected`, and Refute, through the Not a bug dialog, for speculative candidates and every open finding. Each requires a reason of 3 to 300 characters and is recorded in the database with the auditor's account name and time. It SHALL offer Undo this decision on a decided finding. Both actions SHALL be withheld on a finding that already has a decision, and their wording SHALL name a candidate or a finding according to its status.

#### Scenario: Confirming
- **WHEN** the auditor confirms a speculative candidate with a reason
- **THEN** it becomes an open finding showing who confirmed it, when and why

#### Scenario: Refuting an open finding
- **WHEN** the auditor refutes an open finding with a reason
- **THEN** it moves to the Closed queue with the status refuted, showing who refuted it, when and why, and offers Undo this decision

#### Scenario: Confirming an open finding
- **WHEN** the auditor confirms an open finding at `detected`
- **THEN** it stays open and moves to the To report queue, its stage shows `validated`, and the detail shows who confirmed it, when and why

#### Scenario: Reproduced open finding
- **WHEN** the auditor selects an open finding at `validated`
- **THEN** the detail offers Refute through Not a bug and does not offer Confirm

#### Scenario: Deciding a non-speculative finding
- **WHEN** a decision is requested for a finding that is neither speculative nor open, or that already has a decision
- **THEN** it is refused with status 409
- **AND** a decision for an unknown finding, or an undo with no decision, is refused with status 404

## REMOVED Requirements

### Requirement: Findings status tabs
**Reason**: The work queues group findings by what they ask of the auditor, and the raw status becomes a filter.
**Migration**: Links with `status=` keep working and open the All queue filtered to that status, and `status=new` turns on New in the last run. Discarded by verifier moves from a tab to a link beside the queues, keeping `view=discarded`.

### Requirement: Usage page
**Reason**: The page becomes Insights, which adds a cost-per-finding headline and coverage across repositories.
**Migration**: Open `/insights`; `/usage` redirects there.
