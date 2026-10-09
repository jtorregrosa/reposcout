# audit-run Specification

## Purpose
The `run` command orchestrates audits over the repositories in `repos.yaml`: it chooses the mode, takes the run lock, audits each repository in turn with one Claude session, isolates failures, honours cancellation and the subscription limit, chains sweep passes, and decides the exit code. Checkout is covered by repository-checkout, file choice by file-selection, finding classification by finding-lifecycle, and the database by state-store.
## Requirements
### Requirement: Run command and repository filter
The CLI SHALL provide `run`, which audits every repository in the config file (`--config`, default `repos.yaml`) in order, or only those named by `--repo <name>` (repeatable), and SHALL fail with exit code 1 and an error naming the filter when no configured repository matches.

#### Scenario: Audit one repository
- **WHEN** the user runs `run --repo polvorapp` and `repos.yaml` configures `polvorapp` and `other`
- **THEN** only `polvorapp` is audited

#### Scenario: Unknown repository
- **WHEN** the user runs `run --repo missing` and no repository is named `missing`
- **THEN** the CLI prints an error that no repository matches `--repo missing`
- **AND** exits with code 1 without auditing anything

### Requirement: Audit modes
The CLI SHALL accept `--mode` with exactly `incremental`, `full`, `speculative` or `validate`, rejecting any other value as a usage error; without `--mode` each repository uses its configured `mode`, or `incremental` when none is set.

#### Scenario: Default mode
- **WHEN** the user runs `run` with no `--mode` and the repository sets no `mode`
- **THEN** the repository is audited in incremental mode

#### Scenario: Invalid mode
- **WHEN** the user runs `run --mode quick`
- **THEN** the CLI refuses the flag with a message listing incremental, full, speculative and validate

### Requirement: Speculative mode reviews only speculative candidates
In `speculative` mode RepoScout SHALL run a speculative review session for each repository that holds speculative candidates, choosing them as defined in the detection capability, and SHALL skip a repository with none; it MUST NOT change the last audited commit, the per-file audit times or the open findings.

#### Scenario: No candidates
- **WHEN** `run --mode speculative` runs on a repository with no speculative findings
- **THEN** the repository is skipped with the reason "no speculative candidates"

#### Scenario: Review keeps coverage untouched
- **WHEN** a speculative review completes
- **THEN** the repository's last audited commit and file audit times are unchanged
- **AND** only the reviewed findings and the time of the last speculative review are updated

### Requirement: Analyzer subset for one run
The CLI SHALL accept `--analyzers` as a comma-separated non-empty list of `security`, `concurrency`, `error-handling`, `logic` and `performance`, overriding each repository's configured analyzers for that run, and SHALL reject an unknown or empty list as a usage error.

#### Scenario: Subset run
- **WHEN** the user runs `run --analyzers security,logic`
- **THEN** only the security and logic specialists run, plus the verifier

#### Scenario: Unknown analyzer
- **WHEN** the user runs `run --analyzers security,style`
- **THEN** the CLI refuses the flag naming the unknown analyzer `style`

### Requirement: Per-analyzer commit and audit times
After a successful non-speculative audit RepoScout SHALL advance the last audited commit to the audited head only for the analyzers that ran, and SHALL stamp a file's audit time only for those analyzers, leaving every other analyzer's commit and audit times as they were.

#### Scenario: Analyzer left out keeps its commit
- **WHEN** an incremental run with `--analyzers security` audits head `B` while `logic` last audited `A`
- **THEN** `security` records `B` as its last audited commit
- **AND** `logic` still records `A`, so its next run sees the changes since `A`

### Requirement: Prepare-only runs
With `--prepare-only` RepoScout SHALL fetch, plan, select files and write the manifest for each repository, and MUST NOT start Claude, write repository state, write the day's failures or `summary.md`, or send notifications.

#### Scenario: Prepare without Claude
- **WHEN** the user runs `run --prepare-only`
- **THEN** each repository ends as `prepared` with its manifest under `reports/<date>/.work/<run-id>/<repo>/manifest.json`
- **AND** no Claude session is started and the findings in the database are unchanged

### Requirement: Authentication override
The CLI SHALL accept `--auth isolated` or `--auth login` to override `claude.auth` for that run only, and SHALL reject any other value as a usage error.

#### Scenario: Login for one run
- **WHEN** the user runs `run --auth login` and `repos.yaml` sets `claude.auth: isolated`
- **THEN** the Claude sessions of that run use the interactive login

### Requirement: Single run at a time
RepoScout SHALL create `state/.lock` exclusively before touching any repository, recording the process id, start time, run id and the relative path of the run's event log, and SHALL remove it when the run ends; when a live process younger than 12 hours holds the lock, the run MUST exit with code 2 without auditing anything.

#### Scenario: Lock held by a live run
- **WHEN** `run` starts while `state/.lock` names a live process started less than 12 hours ago
- **THEN** the run audits nothing and exits with code 2

#### Scenario: Lock released at the end
- **WHEN** a run finishes, fails or is cancelled
- **THEN** `state/.lock` no longer exists

### Requirement: Stale lock takeover
RepoScout SHALL take over a lock whose process no longer exists, whose start time is 12 hours old or more, or whose content cannot be read, logging a warning, and proceed with the run.

#### Scenario: Dead process
- **WHEN** `state/.lock` names a process id that is no longer running
- **THEN** the run removes the lock, logs that it removed a stale lock, takes the lock and audits normally

### Requirement: Per-repository failure isolation
When one repository's audit fails for any reason other than cancellation or the usage limit, RepoScout SHALL record it as a failure for the day, leave its state unchanged, continue with the next repository, and exit with code 1 at the end; a repository that later succeeds the same day SHALL have its failure cleared.

#### Scenario: One repository fails
- **WHEN** a run audits `a` and `b`, and `a`'s Claude session times out while `b` succeeds
- **THEN** `b`'s state and report are saved
- **AND** `a` is recorded as failed for the day with the error, and the run exits with code 1

### Requirement: Usage limit deferral
When a Claude session hits the subscription usage limit, RepoScout SHALL stop auditing, mark that repository and every remaining one as `deferred` with no state change, record them among the day's failures as deferred, and exit with code 3.

#### Scenario: Limit hit on the first repository
- **WHEN** the first of three repositories hits the usage limit
- **THEN** no Claude session is started for the other two
- **AND** all three are listed as deferred, their state is unchanged and the run exits with code 3

### Requirement: Cancellation from the dashboard
RepoScout SHALL treat a `state/.cancel` file holding the current run id as a cancel request, checked before each repository, between sweep passes, before Claude starts and once a second while Claude runs; on cancel it SHALL kill Claude's process tree, mark the repository `cancelled` without changing its state, mark later repositories as not attempted, remove the cancel file and exit with code 4.

#### Scenario: Cancel during an audit
- **WHEN** the dashboard writes a cancel request for the running run while Claude is auditing
- **THEN** Claude's process tree is killed within about a second
- **AND** the repository keeps its previous state and the run exits with code 4

#### Scenario: Stale cancel request
- **WHEN** `state/.cancel` holds the id of an earlier run
- **THEN** the current run is not cancelled

### Requirement: Exit code precedence
The CLI SHALL exit with 4 when the run was cancelled, otherwise 3 when the usage limit was hit, otherwise 1 when any repository failed, otherwise 5 when a sweep or a validation pass stopped at its budget, otherwise 0 when every repository was audited, validated, skipped or prepared.

#### Scenario: Failure and budget stop together
- **WHEN** one repository fails and a sweep on another stops at the session budget
- **THEN** the run exits with code 1

#### Scenario: Validation pass stopped at its budget
- **WHEN** a validation pass validates one repository and stops before the next at the session budget
- **THEN** the run exits with code 5

### Requirement: Sweeps until covered
With `--until-covered` RepoScout SHALL chain full passes over each repository, each pass picking only eligible files the selected analyzers have not audited since the sweep began, and SHALL stop at the first of: no such file left, a budget stop, a cancel, a pass that fails or is skipped, or `--max-passes` passes (default 30, 1 to 100).

#### Scenario: Sweep reaches coverage
- **WHEN** a sweep's next pass finds no eligible file unaudited since the sweep began
- **THEN** the sweep stops as complete without starting a Claude session for that pass

### Requirement: Sweep flag validation
The CLI SHALL refuse `--until-covered` combined with a `--mode` other than `full`, SHALL refuse `--max-passes` and `--sweep-since` without `--until-covered`, SHALL refuse `--session-limit` and `--weekly-limit` unless given with `--until-covered` or `--mode validate`, SHALL refuse `--analyzers` with `--mode validate`, and SHALL accept the limits only as whole percentages from 10 to 99.

#### Scenario: Sweep flag without a sweep
- **WHEN** the user runs `run --session-limit 80` without `--until-covered` or `--mode validate`
- **THEN** the CLI exits with code 1 explaining these flags only apply with `--until-covered` or `--mode validate`

#### Scenario: Incompatible mode
- **WHEN** the user runs `run --until-covered --mode incremental`
- **THEN** the CLI exits with code 1 explaining that sweeps run in full mode

#### Scenario: Limits with a validation pass
- **WHEN** the user runs `run --mode validate --session-limit 70`
- **THEN** the CLI accepts the flag and the validation pass uses 70% as its session limit

#### Scenario: Analyzers with a validation pass
- **WHEN** the user runs `run --mode validate --analyzers security`
- **THEN** the CLI exits with code 1 explaining that a validation pass takes no analyzers

### Requirement: Sweep budget stop
Before each sweep pass RepoScout SHALL take the latest subscription reading whose window has not reset, add the measured cost of the previous pass (or 8% of the 5-hour window and 2% of the weekly one before any pass is measured), and stop before the pass when the result would exceed `--session-limit` (default 90) or `--weekly-limit` (default 95) or the reported status is not allowed; with no reading it SHALL proceed.

#### Scenario: Pass would cross the session limit
- **WHEN** the 5-hour window reads 85% and no pass of this sweep was measured yet
- **THEN** the sweep stops before the pass, logs the reason and the `--until-covered --sweep-since <instant>` command to resume
- **AND** the repositories after it are deferred and the run exits with code 5

### Requirement: Resuming a sweep
The CLI SHALL accept `--sweep-since <iso>` with `--until-covered`, requiring an ISO date and time that is not in the future, and a sweep given it SHALL count audits made since that instant instead of since its own start.

#### Scenario: Resume after a budget stop
- **WHEN** the user re-runs the logged command with `--sweep-since 2026-10-09T07:00:07Z`
- **THEN** files audited by the selected analyzers after that instant are not picked again

#### Scenario: Future instant
- **WHEN** `--sweep-since` is later than now
- **THEN** the CLI refuses the flag

### Requirement: Per-pass state and report ids
Each sweep pass SHALL save its own state and report under the run id suffixed with `-p<n>`, so passes completed before a stop keep everything they covered.

#### Scenario: First pass report
- **WHEN** the first pass of a sweep in run `run-X` completes
- **THEN** its report is written under `reports/<date>/runs/run-X-p1/<repo>.json`

### Requirement: Run identifier
RepoScout SHALL name each run `run-` followed by its start time in ISO 8601 with `:` and `.` replaced by `-`, and SHALL use that id for its log, event log, work directory and per-run reports.

#### Scenario: Run id
- **WHEN** a run starts at 2026-10-09T07:00:07.123Z
- **THEN** its id is `run-2026-10-09T07-00-07-123Z`

### Requirement: Live event log
Every run SHALL append its progress as JSON lines to `reports/<date>/logs/run-<id>.events.jsonl`, including when the run and each repository start and finish, each stage, sweep pass decisions, a resume, a cancel and the exit code, so the dashboard can follow it from the lock file without the launching process.

#### Scenario: Run finished event
- **WHEN** a run ends
- **THEN** its event log ends with a `run_finished` event carrying the run id, the exit code and each repository's outcome

### Requirement: Claude session timeout
RepoScout SHALL bound one repository's whole Claude session, including any resume, by `claude.timeout_minutes` (default 45), kill the process tree at the deadline, treat a killed session whose tree has not exited 10 seconds later as ended, and fail that repository with a timeout error.

#### Scenario: Session hangs
- **WHEN** the Claude session runs past `claude.timeout_minutes`
- **THEN** its process tree is killed and the repository fails with "claude timed out after <n> min"
- **AND** the run continues with the next repository

### Requirement: Single resume when output is missing
When a non-speculative Claude session reports success without writing the raw findings file and was neither cancelled nor timed out, RepoScout SHALL resume that same session once with the remaining time, asking it to verify and write the output; with less than 2 minutes left it MUST skip the resume and fail the repository with that reason.

#### Scenario: Resume once
- **WHEN** the session ends successfully without its output file and 20 minutes remain
- **THEN** the CLI resumes the session once and processes the output it then writes

#### Scenario: Too little time left
- **WHEN** the session ends without its output file and less than 2 minutes of the timeout remain
- **THEN** no resume is made and the repository fails stating the seconds left

### Requirement: State committed only after post-processing
RepoScout SHALL save a repository's report, its yield and its new state in one database transaction only after the Claude session succeeded and its output was validated and classified, and SHALL write the report files under `reports/` only after that commit; a failed, deferred or cancelled audit MUST leave the previous state whole.

#### Scenario: Invalid output
- **WHEN** the raw findings file is not valid JSON or has no `findings` array
- **THEN** the repository fails and its state and reports are unchanged

### Requirement: Skipping a repository with no changes
In incremental mode RepoScout SHALL skip a repository without starting Claude when every selected analyzer last audited the current head, and SHALL record the new head without starting Claude when commits changed but no auditable file was selected.

#### Scenario: No new commits
- **WHEN** an incremental run finds the branch head equal to every selected analyzer's last audited commit
- **THEN** the repository is skipped with the reason "no changes" and no Claude session starts

### Requirement: Validate mode reproduces detected findings
In `validate` mode RepoScout SHALL run, for each repository with verification on and at least one finding to try, one validation session that tries to reproduce open findings at the `detected` stage, choosing them as the detection capability defines, and SHALL skip a repository with none with the reason `no findings to validate`.

#### Scenario: Nothing to validate
- **WHEN** `run --mode validate` runs on a repository with verification on and no open finding at `detected`
- **THEN** the repository is skipped with the reason `no findings to validate` and no Claude session starts

### Requirement: Validate mode leaves coverage and resolution alone
A validation pass MUST NOT change the last audited commit overall or per analyzer, the file audit times, the last run time, any finding's status or `last_seen`, or any miss count; it SHALL change only the findings it reproduced and the record of validation attempts.

#### Scenario: Coverage untouched
- **WHEN** a validation pass completes on a repository last audited at commit `A` while its branch is at `B`
- **THEN** every analyzer still records `A` as its last audited commit and the file audit times are unchanged

#### Scenario: Unreproduced finding stays open
- **WHEN** a validation pass cannot reproduce an open finding
- **THEN** the finding is still `open`, its `missed_runs` is unchanged and no resolution is recorded

### Requirement: Validate mode needs verification
In `validate` mode RepoScout SHALL skip, before fetching it, every repository whose verification is off, with a reason starting `verification off:` that says why: no `test_command`, or no sandbox on this platform without `test_command_unsandboxed: true`. No Claude session starts and no usage row is recorded for it.

#### Scenario: Native Windows without opt-in
- **WHEN** `run --mode validate` runs on native Windows for a repository with `test_command` and no `test_command_unsandboxed`
- **THEN** the repository is skipped with a reason saying there is no sandbox on this platform
- **AND** the run exits with code 0 when nothing else failed

#### Scenario: Native Windows with opt-in
- **WHEN** the repository sets `test_command_unsandboxed: true`
- **THEN** the validation session runs the test command unsandboxed and the log warns that it does

### Requirement: Validation budget stop
Before each repository's validation session RepoScout SHALL apply the budget estimate defined in usage-metrics with `--session-limit` (default 90) and `--weekly-limit` (default 95), using the measured cost of the previous validation session of this run; when the estimate refuses, it SHALL defer that repository and every later one with the budget reason and start no session.

#### Scenario: Session would cross the limit
- **WHEN** the 5-hour window reads 85% before the first validation session of the run
- **THEN** no session starts, every remaining repository is deferred with the budget reason, and the run exits with code 5

