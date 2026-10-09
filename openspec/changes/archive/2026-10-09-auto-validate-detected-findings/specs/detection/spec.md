## MODIFIED Requirements

### Requirement: Raw findings file contract
The session SHALL write `output_path` once as a JSON object with `findings`, `speculative`, `discarded`, `known_findings_review` (audit), `speculative_review` (speculative review), `validation_review` (validation), `specialist_candidates` (audit) and `notes`; a finding has file (relative, forward slashes, from the manifest), 1-based line, snippet, category, severity, confidence, verified, title, description, scenario, repro, kind, personal_data, suggested_fix, optional reproduction, and specialists.

#### Scenario: Not valid JSON
- **WHEN** the output file is not valid JSON or has no `findings` array
- **THEN** the repository fails for this run and its state is not changed

#### Scenario: Empty result
- **WHEN** nothing is confirmed
- **THEN** `findings` is an empty list, which is valid

#### Scenario: Speculative candidate fields
- **WHEN** the verifier keeps a candidate as speculative
- **THEN** its entry in `speculative` has the finding fields plus `unconfirmed`, and its `severity` is the impact it would have if real

#### Scenario: Validation output
- **WHEN** a validation session ends
- **THEN** `findings` is an empty list and every answered finding has one entry in `validation_review`

## ADDED Requirements

### Requirement: Validation mode
In `validate` mode the CLI SHALL pass as `validation_candidates` the open findings at `detected` whose file exists at the head, with no auditor decision, not suppressed in `repos.yaml` and with fewer than two unsuccessful attempts: fewest attempts first, then most severe, then oldest, at most 10 or `--max-files`. The session MUST run only the verifier, once.

#### Scenario: More findings than the cap
- **WHEN** a repository has 14 eligible findings and `run --mode validate` is used without `--max-files`
- **THEN** the manifest lists 10 of them, every finding never attempted before any finding attempted once

#### Scenario: Findings left out
- **WHEN** a repository holds open findings at `detected` that are, one each, decided by an auditor, pending suppression in `repos.yaml`, twice unsuccessfully attempted, and in a file gone at the head
- **THEN** none of them is in `validation_candidates`

### Requirement: Validation manifest
A validation manifest SHALL carry empty `analyzers`, `known_findings` and `known_false_positives`, no diff, the verification block of a worktree at the head, and for each candidate its fingerprint, file, line, category, severity, title, description, scenario, repro, snippet and the reasons of its earlier unsuccessful attempts.

#### Scenario: Earlier attempt passed on
- **WHEN** a candidate was tried once and not reproduced
- **THEN** its manifest entry carries that attempt's reason

### Requirement: Validation verdicts
For each candidate the verifier SHALL write at most one temporary test in the worktree, run the test command exactly as given, and answer in `validation_review` with `reproduced` and the test and its output, `not_reproduced` with a reason, or `not_testable` with a reason. It MUST NOT confirm, refute or rewrite a candidate, and MUST NOT propose new findings.

#### Scenario: Reproduced
- **WHEN** the test fails in the way the finding's scenario describes
- **THEN** the candidate's verdict is `reproduced` and `reproduction` holds the test and the relevant output

#### Scenario: Needs an external service
- **WHEN** exercising the code path needs a database or network the test command cannot reach
- **THEN** the verdict is `not_testable` and the reason names what is missing

#### Scenario: No verdict
- **WHEN** the verifier gives a candidate no entry in `validation_review`
- **THEN** the candidate is unchanged, no attempt is recorded and the report lists it as unreviewed
