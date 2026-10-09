# dashboard Specification

## Purpose
The dashboard is the local web interface started by the `ui` command, where an auditor follows runs, triages findings, starts and cancels audits, and reads coverage and cost. It reads the state database and the run event logs, and its only writes are the suppression list in repos.yaml, auditor decisions and label corrections in the database, detached runs and cancel requests. Request guards and the page's content security policy are part of audit-security; what statuses, decisions and suppressions mean is part of finding-lifecycle.
## Requirements
### Requirement: Starting the dashboard
The CLI SHALL provide a `ui` command that serves the dashboard on `http://127.0.0.1:<port>/`, with `--port` defaulting to 4477 (an integer from 0 to 65535), `--config` naming repos.yaml, and opening the default browser unless `--no-open` is given.

#### Scenario: Default start
- **WHEN** the user runs `node dist/cli.js ui`
- **THEN** the dashboard listens on 127.0.0.1 port 4477
- **AND** the CLI prints the URL and opens it in the browser

#### Scenario: Custom port without a browser
- **WHEN** the user runs `node dist/cli.js ui --port 5000 --no-open`
- **THEN** the dashboard listens on 127.0.0.1 port 5000
- **AND** no browser is opened

#### Scenario: Port already in use
- **WHEN** the chosen port is already taken
- **THEN** the command fails with a message saying the port is in use and suggesting `--port`

### Requirement: Stopping the dashboard leaves runs alone
Stopping the dashboard with Ctrl+C MUST NOT affect a run in progress, including a run the dashboard started, because dashboard runs are detached processes.

#### Scenario: Ctrl+C during a run
- **WHEN** a run started from the dashboard is in progress
- **AND** the user stops `ui` with Ctrl+C
- **THEN** the server closes
- **AND** the run continues and finishes as it would have otherwise

### Requirement: Following the run in progress
The dashboard SHALL follow whichever run holds `state/.lock`, whoever started it, by reading the event log the lock points at (`reports/<date>/logs/run-<id>.events.jsonl`), and SHALL show the latest run's log when no run is active, switching when a new run starts or the active one ends.

#### Scenario: Run started by Task Scheduler
- **WHEN** a run started outside the dashboard holds the lock
- **THEN** the Runs page shows its progress live from its event log

#### Scenario: Run ends
- **WHEN** the active run's process ends, whether it finished or was killed
- **THEN** the dashboard marks the run as no longer active
- **AND** the pages refresh when the state database or repos.yaml change

### Requirement: Overview page
The Overview page SHALL show what needs attention: open findings with the critical and high count, findings new in the last run, speculative candidates awaiting confirmation, overall coverage, the latest run, the subscription windows, a Needs attention list of open critical and high findings with new ones first, a type by severity matrix and a repositories table that link to the findings they count.

#### Scenario: Matrix cell links to findings
- **WHEN** the auditor clicks a cell of the type by severity matrix
- **THEN** the Findings page opens filtered to the findings that cell counts

#### Scenario: Nothing critical or high
- **WHEN** no critical or high finding is open
- **THEN** Needs attention says nothing critical or high is open

### Requirement: Failed repositories flagged on the Overview
The Overview page SHALL flag at the top every repository whose last audit failed or was deferred and that has not succeeded since, with the date and the error.

#### Scenario: Repository failed yesterday
- **WHEN** a repository's last audit failed and no later audit of it succeeded
- **THEN** the Overview shows it at the top as failed with the date and the error

### Requirement: Findings status tabs
The Findings page SHALL offer the status tabs Open (default), New, Speculative, Suppressed, Resolved, Refuted, Duplicate, All and Discarded by verifier, each showing how many findings it would hold under the current non-status filters; New lists open findings first reported by the last run.

#### Scenario: Counts follow the filters
- **WHEN** the auditor filters by one repository
- **THEN** every tab's count shows only that repository's findings in that status

#### Scenario: Discarded by verifier
- **WHEN** the auditor opens Discarded by verifier
- **THEN** the page lists the candidates the verifier rejected in the last 7 days, with their reason and the specialists that proposed them, narrowed by the repository and search filters

### Requirement: Findings filters and sort
The Findings page SHALL narrow the list by:
- repository;
- severity;
- type, including findings with no type yet;
- category;
- lifecycle stage (`detected`, `validated`, `reported` or `fixed`, several at once);
- personal data;
- a text search over title, file, description, fingerprint and repository.

It SHALL sort by severity (default), by newest first seen, or by location.

#### Scenario: Search
- **WHEN** the auditor types part of a fingerprint in the search box
- **THEN** only findings whose title, file, description, fingerprint or repository contain it are listed

#### Scenario: Stage filter
- **WHEN** the auditor selects the stages `validated` and `fixed`
- **THEN** only findings at one of those stages are listed
- **AND** each status tab counts only findings at those stages

### Requirement: Findings view state in the URL
The Findings page MUST keep every filter, the status tab, the sort and the selected finding in the URL query (`status`, `repo`, `severity`, `category`, `kind`, `stage`, `pd`, `q`, `sort`, `id`, `view`), so a view can be bookmarked, shared with another auditor and walked back with the browser's back button. A `stage` value that is not a known stage MUST be ignored.

#### Scenario: Shared link
- **WHEN** an auditor opens a Findings URL another auditor sent
- **THEN** the same tab, filters, sort and selected finding are shown

#### Scenario: Unknown stage in the URL
- **WHEN** a Findings URL has `stage=validated,shipped`
- **THEN** the stage filter holds only `validated`

### Requirement: Finding detail
The selected finding SHALL open beside the list and show:
- its severity, category, status, file and line, type and personal-data mark;
- its lifecycle stage as a four-step timeline (detected, validated, reported, fixed) with the current step marked and the date each reached step was entered;
- the scenario, reproduction steps, why it is a bug, the suggested fix and the anchored code;
- its confidence, specialists, first and last seen, commit and fingerprint;
- any unconfirmed point, suppression reason, resolution or auditor decision;
- its history of statuses, each linked to the run that set it.

#### Scenario: Speculative candidate selected
- **WHEN** the auditor selects a speculative candidate
- **THEN** the detail shows what the verifier could not confirm alongside the evidence

#### Scenario: History
- **WHEN** a finding is selected
- **THEN** its history lists every status it has had, each linked to the run that set it

#### Scenario: Stage timeline
- **WHEN** the auditor selects a finding that was validated by an auditor and later resolved
- **THEN** the timeline marks `fixed` as current, shows the dates it entered `detected`, `validated` and `fixed`, and leaves `reported` as not reached

### Requirement: Keyboard navigation
The Findings page SHALL move to the next finding with `J` or Down arrow and the previous with `K` or Up arrow, focus the search box with `/`, and close the selected finding with `Esc`, ignoring these keys while typing in a field or while a dialog is open.

#### Scenario: Stepping through the list
- **WHEN** the auditor presses `J` with no field focused
- **THEN** the next finding in the filtered list is selected

#### Scenario: Typing in search
- **WHEN** the search box has focus and the auditor types `j`
- **THEN** the letter goes into the search and the selection does not move

### Requirement: Copy for a ticket
The finding detail SHALL offer Copy for a ticket, which copies the finding as Markdown to the clipboard.

#### Scenario: Copy
- **WHEN** the auditor clicks Copy for a ticket
- **THEN** the clipboard holds the finding as Markdown

### Requirement: Open in VS Code
The finding detail SHALL offer Open in VS Code, which opens the finding's file at its line in the local clone; the path MUST resolve inside `workspace/<repo>` of a configured repository, and VS Code MUST be started without a shell.

#### Scenario: File in the clone
- **WHEN** the auditor clicks Open in VS Code for a file present in the clone
- **THEN** VS Code opens that file at the finding's line

#### Scenario: Path leaving the clone
- **WHEN** the requested file is absolute or resolves outside `workspace/<repo>`
- **THEN** the request is refused with status 400

#### Scenario: File or editor missing
- **WHEN** the file is not in the local clone
- **THEN** the request is refused with status 404 asking to run an audit first
- **AND** when VS Code is not found the request is refused with status 501

### Requirement: Suppress a finding
The finding detail SHALL offer Suppress for open findings, requiring a reason of 3 to 300 characters (control characters and repeated whitespace collapsed to one line), which adds a `fingerprint` and `reason` entry under the repository's `suppressed` list in repos.yaml.

#### Scenario: Suppressing
- **WHEN** the auditor suppresses an open finding with a valid reason
- **THEN** repos.yaml gains the entry under that repository's `suppressed`
- **AND** the finding shows as suppressed and pending

#### Scenario: Refused suppression
- **WHEN** the reason is missing or outside 3 to 300 characters, the fingerprint is not 32 hex characters, the repository is unknown or the finding is not in the database
- **THEN** the request is refused with status 400
- **AND** an already suppressed fingerprint is refused with status 409

### Requirement: Unsuppress a finding
The finding detail SHALL offer Unsuppress for suppressed findings, after a confirmation, which removes the fingerprint's entry from the repository's `suppressed` list in repos.yaml.

#### Scenario: Unsuppressing
- **WHEN** the auditor confirms Unsuppress
- **THEN** the entry is removed from repos.yaml
- **AND** the finding shows its status from before the suppression, marked pending

#### Scenario: Not suppressed
- **WHEN** the fingerprint has no entry in the repository's `suppressed` list
- **THEN** the request is refused with status 404

### Requirement: Pending marker for suppression edits
The dashboard MUST treat repos.yaml as the source of truth for suppressions and mark a finding as pending while its status in repos.yaml differs from the database, until the next run updates the database.

#### Scenario: Before the next run
- **WHEN** a finding was suppressed from the dashboard and no run has happened since
- **THEN** it is listed as suppressed with a pending marker

### Requirement: Safe edits of repos.yaml
Every dashboard edit of repos.yaml MUST keep the file's comments and layout, MUST validate the edited file with the same parser a run uses and refuse the edit when it would be invalid, and MUST replace the file atomically.

#### Scenario: Comments preserved
- **WHEN** a suppression is added to a repos.yaml with comments
- **THEN** every comment is still in the file afterwards

#### Scenario: Invalid result
- **WHEN** the edit would leave repos.yaml invalid or the file does not parse
- **THEN** the edit is refused with status 500 and the file is unchanged

### Requirement: Editable type and personal data
The finding detail SHALL let the auditor change a finding's type (bug, vulnerability or chore) and its personal-data mark, recorded in the database with the auditor's account name and time.

#### Scenario: Correcting the type
- **WHEN** the auditor changes a finding's type to chore
- **THEN** the finding shows type chore and the correction is recorded with who made it

#### Scenario: Invalid label
- **WHEN** the request gives neither field, a type other than bug, vulnerability or chore, or a non-boolean personal-data value
- **THEN** it is refused with status 400

### Requirement: Export the current view
The Findings page SHALL offer Export of exactly the findings the current filters show, as a self-contained printable HTML report, a Markdown report, a SARIF 2.1.0 log, or a copy of their fingerprints, and SHALL disable Export when the view is empty.

#### Scenario: HTML export
- **WHEN** the auditor exports the printable report with a severity filter applied
- **THEN** the browser downloads an HTML file holding only the filtered findings

### Requirement: Finding text rendered as text
The dashboard MUST render every text that comes from a finding or a repository as text, never as HTML, because it quotes code from the audited repositories.

#### Scenario: Markup in a finding
- **WHEN** a finding's description contains `<script>` or other markup
- **THEN** the markup is displayed literally and nothing is executed

### Requirement: Repositories page
The Repositories page SHALL show coverage across repositories and, per repository, open findings by severity, new, speculative and suppressed counts, the last audit and its health, the full runs still needed at the pace of the last five full runs, and their cost in 5-hour and weekly windows, with a Count audits since control restricting coverage to a period.

#### Scenario: Count audits since
- **WHEN** the auditor sets Count audits since to the start of a sweep
- **THEN** coverage counts only the audits made since that instant

### Requirement: Repository page
Each repository SHALL have its own page with its type by severity matrix, configuration, coverage per analyzer and recent Claude runs, and a notice that verification is off whenever the verifier cannot run `test_command` there: when the repository has none, or when the platform has no Claude Code sandbox and the repository does not set `test_command_unsandboxed: true`.

#### Scenario: No test_command
- **WHEN** a repository has no `test_command`
- **THEN** its page says verification is off and the verifier confirms findings from the code alone

#### Scenario: test_command on native Windows
- **WHEN** a repository sets `test_command` without `test_command_unsandboxed` and the dashboard runs on native Windows
- **THEN** its page says verification is off because there is no sandbox, and names `test_command_unsandboxed: true` as the opt-in

#### Scenario: Unknown repository
- **WHEN** the auditor opens the page of a name not in repos.yaml
- **THEN** the page says there is no repository with that name

### Requirement: Runs page
The Runs page SHALL show the run in progress, or any past run replayed from its event log, with each repository's progress through its stages, the subagents grouped by type with their tokens and tool calls, an activity feed filterable to warnings and errors, and the tool calls blocked by policy.

#### Scenario: Replaying a past run
- **WHEN** the auditor picks a past run
- **THEN** its event log is replayed into the same panels

#### Scenario: Unknown run id
- **WHEN** a run id that is malformed or has no event log is requested
- **THEN** the dashboard answers with status 404

### Requirement: Usage page
The Usage page SHALL show one row per Claude run with its cost, filterable by repository, totals for the last 7 days with the cost per finding and per confirmed finding, the yield per analyzer, and precision per analyzer, specialists model and prompt version, as defined by usage-metrics.

#### Scenario: Filter by repository
- **WHEN** the auditor picks one repository
- **THEN** the rows and totals cover only that repository's Claude runs

### Requirement: New audit
The Runs page SHALL offer New audit, which summarises the run and then starts the `run` command as a detached process with the ticked repositories (none means all), mode incremental, full or speculative, an optional file cap from 1 to 150, an optional analyzer subset (none means each repository's configured ones) and, in full mode only, an optional sweep with a session limit from 10 to 99 percent (default 90).

#### Scenario: Starting an audit
- **WHEN** the auditor starts a full audit of one repository with the sweep ticked
- **THEN** the CLI runs detached as `run --mode full --repo <name> --until-covered --session-limit 90`

#### Scenario: Refused while locked
- **WHEN** another run holds `state/.lock`
- **THEN** New audit is refused with status 409 naming the run in progress

#### Scenario: Invalid options
- **WHEN** the request names an unknown repository, mode or analyzer, a file cap outside 1 to 150, a sweep outside full mode, or a session limit without a sweep or outside 10 to 99
- **THEN** it is refused with status 400 and no run starts

### Requirement: Cancel run
The Runs page SHALL offer Cancel run while a run holds the lock, which asks that run to stop; the run checks once a second, kills Claude's process tree, records the repository as `cancelled`, leaves its state untouched and exits with code 4.

#### Scenario: Cancelling
- **WHEN** the auditor confirms Cancel run
- **THEN** the run stops within seconds, the repository is recorded as cancelled and is audited again next time

#### Scenario: No run
- **WHEN** Cancel run or Force stop is requested with no run holding the lock
- **THEN** it is refused with status 409

### Requirement: Force stop
The Runs page SHALL offer Force stop when a cancelled run has not stopped 15 seconds after the cancel request, which kills the process tree of the run holding the lock.

#### Scenario: Run does not stop
- **WHEN** 15 seconds pass after Cancel run and the run is still active
- **THEN** a Force stop button appears and, once confirmed, kills the run's processes

### Requirement: Action log
The dashboard MUST append every action, with its request, whether it succeeded, and its result or error, redacted, to `reports/<date>/logs/dashboard-actions.jsonl`.

#### Scenario: Refused action logged
- **WHEN** a suppression is refused for a duplicate fingerprint
- **THEN** a line with the action, the request, `ok: false` and the error is appended to that day's `dashboard-actions.jsonl`

### Requirement: Deliberate limits of the dashboard
The dashboard MUST NOT change `test_command` or any repos.yaml key other than a repository's `suppressed` list, MUST NOT delete state, and MUST NOT write to Azure DevOps or any other remote.

#### Scenario: No configuration editing
- **WHEN** an auditor uses any dashboard action
- **THEN** repos.yaml changes at most in a repository's `suppressed` list
- **AND** no state is deleted and nothing is sent to Azure DevOps

### Requirement: Stage history endpoint
The dashboard SHALL serve a finding's stage history, oldest first, as a read-only request behind the same guards as every other dashboard request, and SHALL include each finding's current stage, the time it entered it and the source of that change in the findings it serves.

#### Scenario: Stage history requested
- **WHEN** the dashboard requests the stage history of a finding that was detected and then validated by reproduction
- **THEN** it receives two entries in order, the first with the source `initial` and the second with the source `reproduced`

### Requirement: Decide a finding
The finding detail SHALL offer Confirm and Refute for speculative candidates, Confirm for open findings at the `detected` stage and Refute for every open finding, each requiring a reason of 3 to 300 characters, recorded in the database with the auditor's account name and time, and SHALL offer Undo this decision on a decided finding. The actions SHALL be hidden on a finding that already has a decision, and their wording SHALL name a candidate or a finding according to its status.

#### Scenario: Confirming
- **WHEN** the auditor confirms a speculative candidate with a reason
- **THEN** it becomes an open finding showing who confirmed it, when and why

#### Scenario: Refuting an open finding
- **WHEN** the auditor refutes an open finding with a reason
- **THEN** it moves to the Refuted tab showing who refuted it, when and why, and offers Undo this decision

#### Scenario: Confirming an open finding
- **WHEN** the auditor confirms an open finding at `detected`
- **THEN** it stays in the Open tab, its stage timeline shows `validated`, and the detail shows who confirmed it, when and why

#### Scenario: Reproduced open finding
- **WHEN** the auditor selects an open finding at `validated`
- **THEN** the detail offers Refute and does not offer Confirm

#### Scenario: Deciding a non-speculative finding
- **WHEN** a decision is requested for a finding that is neither speculative nor open, or that already has a decision
- **THEN** it is refused with status 409
- **AND** a decision for an unknown finding, or an undo with no decision, is refused with status 404

