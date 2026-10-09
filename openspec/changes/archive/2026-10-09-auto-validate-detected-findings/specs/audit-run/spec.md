## MODIFIED Requirements

### Requirement: Audit modes
The CLI SHALL accept `--mode` with exactly `incremental`, `full`, `speculative` or `validate`, rejecting any other value as a usage error; without `--mode` each repository uses its configured `mode`, or `incremental` when none is set.

#### Scenario: Default mode
- **WHEN** the user runs `run` with no `--mode` and the repository sets no `mode`
- **THEN** the repository is audited in incremental mode

#### Scenario: Invalid mode
- **WHEN** the user runs `run --mode quick`
- **THEN** the CLI refuses the flag with a message listing incremental, full, speculative and validate

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

### Requirement: Exit code precedence
The CLI SHALL exit with 4 when the run was cancelled, otherwise 3 when the usage limit was hit, otherwise 1 when any repository failed, otherwise 5 when a sweep or a validation pass stopped at its budget, otherwise 0 when every repository was audited, validated, skipped or prepared.

#### Scenario: Failure and budget stop together
- **WHEN** one repository fails and a sweep on another stops at the session budget
- **THEN** the run exits with code 1

#### Scenario: Validation pass stopped at its budget
- **WHEN** a validation pass validates one repository and stops before the next at the session budget
- **THEN** the run exits with code 5

## ADDED Requirements

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
