# backfill Specification

## Purpose
Defines the `backfill-kind` and `backfill-repro` commands, which fill in the type and personal-data mark, or the reproduction steps, of findings recorded before the verifier produced them. It covers which findings are filled, in what order and in what batches, how the commands stay within the subscription budget, resume and report progress, and their flags and exit codes; the meaning of the type and of auditor label corrections is defined in finding-lifecycle.

## Requirements

### Requirement: What each backfill fills
`backfill-kind` SHALL give each selected finding that has no type a type (`bug`, `vulnerability` or `chore`) and a personal-data mark, and `backfill-repro` SHALL give each selected finding that has no reproduction steps its preconditions, steps, expected and actual result; neither SHALL change a finding's status or any other field.

#### Scenario: Labelling findings without a type
- **WHEN** `backfill-kind` runs and an open finding has no type
- **THEN** the finding gets a type and a personal-data mark and keeps its status

#### Scenario: Writing missing steps
- **WHEN** `backfill-repro` runs and an open finding has no reproduction steps
- **THEN** the finding gets reproduction steps and keeps its status

### Requirement: Statuses selected
The backfill commands SHALL fill findings in the statuses given by `--status`, a comma-separated list of `open`, `speculative`, `suppressed`, `resolved`, `refuted` and `duplicate`, defaulting to `open,speculative`, and MUST reject an unknown status.

#### Scenario: Default statuses
- **WHEN** `backfill-repro` runs without `--status`
- **THEN** only open and speculative findings without steps are considered

#### Scenario: Unknown status
- **WHEN** `--status open,closed` is given
- **THEN** the command fails with an error naming the allowed statuses

### Requirement: Most severe first
The backfill commands SHALL process the findings missing the field from the most severe (critical, high, medium, low) to the least, open before speculative at equal severity, across every selected repository.

#### Scenario: Mixed severities
- **WHEN** a critical and a low finding both lack steps
- **THEN** the critical one is sent to Claude in an earlier or the same batch as the low one

### Requirement: Batches of one Claude session
The backfill commands SHALL send findings in batches that stay within one repository, each batch to one Claude session that reads the repository's local clone, with at most `--batch-size` findings per batch (an integer from 1 to 30; default 30 for `backfill-kind` and 12 for `backfill-repro`), and SHALL store only well-formed results for findings that were in that batch.

#### Scenario: Batch size out of range
- **WHEN** `--batch-size 31` is given
- **THEN** the command fails with an error that it must be an integer from 1 to 30

#### Scenario: Output for a finding outside the batch
- **WHEN** a session's output names a fingerprint that was not in its batch
- **THEN** that entry is ignored

### Requirement: Repositories without a local clone
The backfill commands SHALL skip, with a warning in the log, the findings of repositories that have no local clone under `workspace/`, and process the rest.

#### Scenario: Repository never audited on this machine
- **WHEN** a repository with findings to fill has no clone in `workspace/`
- **THEN** its findings are skipped and the log asks to audit it once and run the backfill again

### Requirement: Uses the specialists model
Each backfill session SHALL run with the repository's `claude.models.specialists` model, with only the Read, Grep, Glob and Write tools, a turn limit of 90 and a timeout of 25 minutes.

#### Scenario: Specialists configured as haiku
- **WHEN** a repository sets `claude.models.specialists: haiku`
- **THEN** its backfill sessions run on haiku

### Requirement: Budget stop
Before each batch, the backfill commands SHALL estimate whether the batch would push the 5-hour window past `--session-limit` (default 90%) or the weekly window past `--weekly-limit` (default 95%), using the latest reported usage and the cost of the previous batch, and SHALL stop before starting a batch that would cross either limit, exiting with code 5.

#### Scenario: Next batch would cross the session limit
- **WHEN** the 5-hour window is at 88% and the previous batch cost 5%
- **THEN** the command stops before the next batch, logs the reason and exits with code 5

### Requirement: Resumable and progress kept
The backfill commands SHALL store each batch's results as soon as that batch finishes, and SHALL select only findings still missing the field, so running the command again continues where an earlier run stopped.

#### Scenario: Running again after a budget stop
- **WHEN** a backfill stopped after writing some batches and is run again
- **THEN** the findings already filled are not sent to Claude again

### Requirement: Never overwrite existing values
The backfill commands MUST NOT overwrite a type or reproduction steps a finding already has, including a type an auditor set in the dashboard.

#### Scenario: Auditor already set the type
- **WHEN** an auditor set a finding's type to Chore
- **AND** `backfill-kind` runs
- **THEN** the finding is not selected and its type stays Chore

### Requirement: Dry run
With `--dry-run`, the backfill commands SHALL count and log the findings and batches that would be filled, without taking the lock or calling Claude, and exit with code 0.

#### Scenario: Counting what is missing
- **WHEN** a user runs `backfill-kind --dry-run`
- **THEN** the log states how many findings and batches would be labelled, no Claude session starts and the exit code is 0

### Requirement: Repository and limit flags
The backfill commands SHALL restrict the work to the repositories named by `--repo` (repeatable) and to at most `--limit` findings (a positive integer) in one invocation, and MUST fail with exit code 1 when no configured repository matches `--repo`.

#### Scenario: Limited run on one repository
- **WHEN** a user runs `backfill-repro --repo polvorapp --limit 20 --status open`
- **THEN** at most the 20 most severe open findings of polvorapp without steps are processed

#### Scenario: Unknown repository
- **WHEN** `--repo` names a repository not in `repos.yaml`
- **THEN** the command prints an error and exits with code 1

### Requirement: Visible on the Runs page
While a backfill runs, it SHALL hold `state/.lock`, write an event log under `reports/<date>/logs/` that the lock points at, report each batch's progress ("batch <n> of <total>: <k> of <m> findings labelled" or "got steps"), and record a usage row per successful batch with mode `backfill-kind` or `backfill-repro`, so the dashboard's Runs and Usage pages show it.

#### Scenario: Following a backfill in the dashboard
- **WHEN** a backfill is running and the dashboard is open
- **THEN** the Runs page shows it as the run in progress with its per-batch progress

### Requirement: Exit codes
The backfill commands SHALL exit with 0 when every batch succeeded or there was nothing to do, 1 when a batch failed (the remaining batches still run), 2 when another run holds the lock (nothing is done), 3 when the subscription usage limit was hit (it stops there), 4 when cancelled from the dashboard (what was written is kept), and 5 at a budget stop.

#### Scenario: Another run in progress
- **WHEN** a backfill starts while another run holds `state/.lock`
- **THEN** it does nothing and exits with code 2

#### Scenario: Cancelled from the dashboard
- **WHEN** the run is cancelled from the dashboard during a backfill
- **THEN** it stops before the next batch, keeps the batches already written and exits with code 4
