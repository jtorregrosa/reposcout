# evaluation Specification

## Purpose
Defines `pnpm eval`, which measures whether a change to the audit prompts or models finds more seeded bugs or more noise, by auditing a seeded corpus with the real Claude and scoring the reports against ground truth. It spends subscription usage, runs only by hand and never in CI, and never touches the user's own state, reports or repositories.

## Requirements

### Requirement: Seeded corpus with ground truth
The evaluation SHALL treat each directory under `eval/corpus/` that holds a `truth.yaml` as a case whose sources live in its `src/`, and each `truth.yaml` SHALL name the `case`, list `clean_files`, and list bugs with `id`, `file`, `lines` (one inclusive `[start, end]` range or a list of them), `category` (one of the five analyzers), `severity` (`critical`, `high`, `medium` or `low`) and `description`.

#### Scenario: Invalid truth file
- **WHEN** a `truth.yaml` has a bug with an unknown category or a range whose start is after its end
- **THEN** that case fails with a message naming the truth file and the offending field, and is recorded as failed in the result

### Requirement: Estimate without consent
`pnpm eval` without `--yes` SHALL print the selected cases with their file and non-blank line counts, the analyzers, the current prompt version and an estimated share of the 5-hour window, then say that it spends real subscription usage and exit with code 1 without running any audit.

#### Scenario: Dry estimate
- **WHEN** `pnpm eval` is run without `--yes`
- **THEN** no Claude session starts and the output ends with the instruction to run again with `--yes`
- **AND** the exit code is 1

### Requirement: Cost estimate source
The estimate SHALL be the number of cases times the 5-hour window share per case measured by the previous result in the results directory, or 8% per case when no previous result measured it.

#### Scenario: No previous result
- **WHEN** the results directory holds no previous result with a measured 5-hour share
- **THEN** the estimate uses 8% of the 5-hour window per case and says nothing has been measured yet

#### Scenario: Previous result measured
- **WHEN** the previous result used 12% of the 5-hour window over two cases
- **THEN** the estimate for three cases is about 18% and names the run it was measured by

### Requirement: Case and option selection
`pnpm eval` SHALL accept `--case <name>` (repeatable; default every case), `--analyzers <list>` (default all five), `--models role=alias,...` for `orchestrator`, `specialists` and `verifier`, `--auth isolated|login`, `--keep` and `--out <dir>` (default `eval/results`), and SHALL fail before running anything on an unknown case, analyzer, role or auth mode.

#### Scenario: Unknown case
- **WHEN** `pnpm eval --case nope` is run
- **THEN** it fails with a message listing the available cases and exits with code 1

#### Scenario: Malformed models flag
- **WHEN** `--models judge=opus` is given
- **THEN** it fails with a message that `--models` takes role=alias pairs for orchestrator, specialists and verifier

### Requirement: Isolated temporary run per case
With `--yes`, for each case the evaluation SHALL create a temporary data directory, copy the case's `src/` into a new git repository on branch `main` there, write a `repos.yaml` with `provider: local`, the selected analyzers, any `--models` and `max_files_full_run: 150`, and run the real CLI with `run --mode full` with `REPOSCOUT_HOME` set to that directory and `REPOSCOUT_ALLOW_LOCAL_PROVIDER=1`.

#### Scenario: User state untouched
- **WHEN** `pnpm eval --yes` runs a case
- **THEN** the audit's state, reports and clone live in the temporary directory and the user's own `state/` and `reports/` are not written

### Requirement: Credentials from the user's environment file
Before running cases, the evaluation SHALL load `.env` from the RepoScout directory so `claude.auth: isolated` finds `CLAUDE_CODE_OAUTH_TOKEN`, and SHALL pass `--auth` through to the CLI when given.

#### Scenario: Login instead of token
- **WHEN** `pnpm eval --yes --auth login` is run
- **THEN** each case's run uses the interactive Claude login

### Requirement: Temporary directories removed unless kept
The evaluation SHALL delete each case's temporary data directory after the case, unless `--keep` is given, in which case it prints the kept path.

#### Scenario: Keep for inspection
- **WHEN** `pnpm eval --yes --keep` finishes a case
- **THEN** the temporary directory remains and its path is printed as `kept <path>`

### Requirement: Failed cases and the usage limit
A case whose run exits with a code other than 0 or writes no report SHALL be recorded as failed with the exit code, and when a case stops at the subscription usage limit (exit code 3) the evaluation SHALL skip every remaining case.

#### Scenario: Usage limit reached
- **WHEN** the second of three cases exits with code 3
- **THEN** the third case is not run and the result records the second as failed with `run exited 3`

### Requirement: Matching rule
The scorer SHALL match a reported finding to a seeded bug when both are in the same file and the finding's line lies within any of the bug's line ranges widened by 3 lines on each side.

#### Scenario: Line within tolerance
- **WHEN** a seeded bug spans lines 26 to 28 and a finding in the same file points at line 31
- **THEN** the finding matches the bug

#### Scenario: Line outside tolerance
- **WHEN** the same finding points at line 32
- **THEN** it does not match the bug

### Requirement: Recall
Recall SHALL be the seeded bugs found by a confirmed finding of their own category over the seeded bugs whose category was among the audited analyzers, reported per case, in total and per analyzer, and empty when no bug is in scope.

#### Scenario: Subset of analyzers
- **WHEN** a case with security and logic bugs is evaluated with `--analyzers security`
- **THEN** recall counts only the security bugs

### Requirement: Cross-category and duplicates
A finding matching a seeded bug only in another category SHALL count that bug as cross-category, neither found nor a false positive, unless a finding of the right category found it; a second same-category finding on an already found bug SHALL count as a duplicate.

#### Scenario: Wrong category on a seeded bug
- **WHEN** an unbounded-cache performance bug is reported only as a `security` finding on its lines
- **THEN** the bug counts as cross-category and the finding is not a false positive

### Requirement: Precision and false positives
Precision SHALL be the findings that point at any seeded bug, whatever their category, over all confirmed findings; every other finding SHALL be a false positive, flagged as a control false positive when its file is listed in `clean_files`, and FP/KLOC SHALL be false positives per thousand non-blank lines of the case.

#### Scenario: Finding in a control file
- **WHEN** a finding is reported in a file listed in `clean_files`
- **THEN** it counts as a false positive and as a control false positive

### Requirement: Speculative hits
Speculative candidates SHALL never count as false positives; a seeded bug that no confirmed finding found but a speculative candidate points at SHALL count as a speculative hit.

#### Scenario: Only speculative
- **WHEN** a seeded bug has no matching finding but a new speculative candidate on its lines
- **THEN** it counts as a speculative hit and as missed for recall

### Requirement: Cost metrics
Each case SHALL record the usage its report recorded: USD equivalent cost, wall time in seconds, turns, input and output tokens, and the share of the 5-hour and weekly subscription windows, summed in the totals.

#### Scenario: Totals of cost
- **WHEN** two cases each record a USD equivalent cost
- **THEN** the totals show their sum

### Requirement: Prompt version stamp
Each result SHALL be stamped with a prompt version, the first 12 hex characters of SHA-256 over `.claude/skills/audit/SKILL.md` and every `.claude/agents/*.md` in path order with line endings normalised, together with the effective models and the analyzers.

#### Scenario: Line endings ignored
- **WHEN** the same prompts are checked out with CRLF line endings
- **THEN** the prompt version is unchanged

### Requirement: Result files
After the cases, the evaluation SHALL write `<timestamp>.json` (schema `reposcout/eval@1`) and `<timestamp>.md`, a Markdown table per case and in total with recall per analyzer, into the results directory, and exit with code 0 only when every case was scored.

#### Scenario: One case failed
- **WHEN** one case failed and the others were scored
- **THEN** both files are written with the failed case marked and the exit code is 1

### Requirement: Comparison with the previous result
The Markdown result SHALL compare the totals with the newest earlier result of the same schema in the results directory, showing before, after and delta for recall, precision, FP/KLOC, cross-category, speculative hits, cost and recall per analyzer, each marked better or worse.

#### Scenario: Recall improved
- **WHEN** recall rose from 60% to 70% since the previous result
- **THEN** the comparison shows `+10 pts (better)` for recall
