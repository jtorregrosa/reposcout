## MODIFIED Requirements

### Requirement: What the database records
The database SHALL record, per repository:
- the branch, the last audited commit overall and per analyzer;
- the last run, full run and speculative review times;
- the eligible file count, each file's audit time per analyzer, and the files queued again because they were not opened;
- every finding with its status and full fields, and the history of every status change;
- auditor decisions and label corrections;
- validation attempts;
- the Jira issue linked to a finding, with who linked it and when;
- the reports, failures by day and the file census;
- one usage row per Claude run, and each run's yield per analyzer.

#### Scenario: State read back after a run
- **WHEN** a run writes a repository's state and a later run reads it
- **THEN** the later run sees the same commits, file audit times, findings and statuses that were written

#### Scenario: Attempts read back
- **WHEN** a validation pass records an unsuccessful attempt and a later validation pass reads the state
- **THEN** the later pass sees that attempt and its reason

#### Scenario: Issue link outlives a run
- **WHEN** a finding linked to `API-42` is reported again by a run that rewrites the state
- **THEN** the finding is still linked to `API-42`

### Requirement: db export command
`db export` SHALL write the database as JSON into `exports/<timestamp>/` under the data directory, or into the directory given by `--out` (relative to the data directory). It SHALL read everything from one consistent snapshot. The export SHALL hold:
- `manifest.json`, naming the format `reposcout/export@1`, the schema version, the time of the export and the repositories;
- `state/<repo>.json` per repository, in the shape of the older JSON state;
- `state/census.json`;
- `state/usage.jsonl`;
- `finding-history.json`, with every history entry and its actor;
- `finding-stages.json`, with every stage history entry;
- `decisions.json`, with every auditor decision;
- `labels.json`, with every label correction;
- `validation-attempts.json`, with every validation attempt;
- `finding-issues.json`, with every linked Jira issue;
- `analyzer-yield.json`;
- `reports.jsonl`, with every stored report and its date;
- `failures.json`, with every recorded failure and deferral.

It SHALL then print how many repositories and history events it exported.

#### Scenario: Default export
- **WHEN** a user runs `db export`
- **THEN** a new `exports/<timestamp>/` directory holds the manifest and every file listed above

#### Scenario: Export to a chosen directory
- **WHEN** a user runs `db export --out backup`
- **THEN** the same files are written under `backup/` in the data directory

#### Scenario: History keeps who acted
- **WHEN** an auditor confirmed a speculative candidate and a user runs `db export`
- **THEN** that entry in `finding-history.json` carries the auditor's name as `actor`, and `decisions.json` holds the decision

### Requirement: Export round trip
Restoring an export into an empty database SHALL reproduce what the exported database held, in one transaction:
- every repository's state, census and usage rows;
- every finding's status history and stage history, with their run ids, notes and actors;
- each finding's current stage;
- every auditor decision and label correction;
- every validation attempt;
- every linked Jira issue;
- the analyzer yield, reports and failures.

A restore that fails partway MUST leave the database as it was. An export without `validation-attempts.json` SHALL restore with no validation attempts, and one without `finding-issues.json` with no linked issues.

#### Scenario: Restore reproduces the auditor's work
- **WHEN** a database holds a candidate an auditor confirmed, a finding whose type an auditor corrected, and a finding resolved after being validated
- **AND** it is exported and the export is restored into an empty database
- **THEN** the restored database holds the same statuses, stages, decisions, label corrections, status histories and stage histories

#### Scenario: Restore keeps validation attempts
- **WHEN** a database holds a finding with two unsuccessful validation attempts and it is exported and restored
- **THEN** the restored finding has the same two attempts, and validation passes still leave it out

#### Scenario: Export from before validation attempts
- **WHEN** an export has no `validation-attempts.json`
- **THEN** it restores without error and no finding has validation attempts

#### Scenario: Restore keeps issue links
- **WHEN** a database holds a finding reported as `API-42` and it is exported and restored
- **THEN** the restored finding is linked to `API-42` and its stage is `reported`

#### Scenario: Restore fails partway
- **WHEN** an export holds a report file that cannot be parsed
- **THEN** `db import --from` fails with exit code 1 and the database holds no state afterwards
