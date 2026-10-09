## MODIFIED Requirements

### Requirement: New audit
The Runs page SHALL offer New audit, which summarises the run and then starts the `run` command as a detached process with the ticked repositories (none means all), mode incremental, full, speculative or validate, an optional cap from 1 to 150 on files, candidates or findings, an optional analyzer subset outside validate (none means each repository's configured ones) and, in full mode only, an optional sweep with a session limit from 10 to 99 percent (default 90).

#### Scenario: Starting an audit
- **WHEN** the auditor starts a full audit of one repository with the sweep ticked
- **THEN** the CLI runs detached as `run --mode full --repo <name> --until-covered --session-limit 90`

#### Scenario: Starting a validation pass
- **WHEN** the auditor picks Validate, ticks one repository with verification on and sets 5 findings
- **THEN** the CLI runs detached as `run --mode validate --repo <name> --max-files 5`

#### Scenario: Repository with verification off
- **WHEN** the auditor picks Validate
- **THEN** each repository with verification off cannot be ticked and says whether it lacks a `test_command` or a sandbox

#### Scenario: Refused while locked
- **WHEN** another run holds `state/.lock`
- **THEN** New audit is refused with status 409 naming the run in progress

#### Scenario: Invalid options
- **WHEN** the request names an unknown repository, mode or analyzer, a cap outside 1 to 150, a sweep outside full mode, a session limit without a sweep or outside 10 to 99, analyzers with validate, or validate with no selected repository whose verification is on
- **THEN** it is refused with status 400 and no run starts

### Requirement: Finding detail
The selected finding SHALL open beside the list and show:
- its severity, category, status, file and line, type and personal-data mark;
- its lifecycle stage as a four-step timeline (detected, validated, reported, fixed) with the current step marked and the date each reached step was entered;
- the scenario, reproduction steps, why it is a bug, the suggested fix and the anchored code;
- its confidence, specialists, first and last seen, commit and fingerprint;
- any unconfirmed point, suppression reason, resolution or auditor decision;
- its validation attempts, each with its date, outcome and reason;
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

#### Scenario: Unsuccessful attempts
- **WHEN** the auditor selects an open finding at `detected` that two validation passes could not reproduce
- **THEN** the detail lists both attempts with their outcomes and reasons, and says validation passes no longer try it

## ADDED Requirements

### Requirement: Validate detected findings from the Repository page
The Repository page SHALL offer Validate detected findings when the repository's verification is on and it has open findings at `detected`. The button SHALL say how many findings a pass would try, then start `run --mode validate --repo <name>` as New audit does, and SHALL be disabled while a run holds the lock.

#### Scenario: Starting from the repository
- **WHEN** the auditor confirms Validate detected findings on a repository with 4 open findings at `detected`
- **THEN** the CLI runs detached as `run --mode validate --repo <name>`

#### Scenario: Verification off
- **WHEN** the repository has no `test_command`, or no sandbox and no opt-in
- **THEN** the button is not shown and the Verification is off notice explains why

### Requirement: Validation outcomes on the Runs page
The Runs page SHALL show a validation pass with the mode `validate` and, for each repository, how many findings it tried, reproduced, did not reproduce and found not testable, or why it was skipped or deferred.

#### Scenario: Following a validation pass
- **WHEN** a validation pass on one repository tries 5 findings, reproduces 2 and finds 1 not testable
- **THEN** the repository's line shows 5 tried, 2 reproduced, 2 not reproduced and 1 not testable

### Requirement: Validation attempts endpoint
The dashboard SHALL serve a finding's validation attempts, oldest first, each with its time, run id, outcome and reason, as a read-only request behind the same guards as every other dashboard request.

#### Scenario: Attempts requested
- **WHEN** the dashboard requests the attempts of a finding tried once without success and then reproduced
- **THEN** it receives two entries in order, the first `not_reproduced` with its reason and the second `reproduced`
