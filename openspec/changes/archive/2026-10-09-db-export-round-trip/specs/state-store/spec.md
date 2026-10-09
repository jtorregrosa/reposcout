## MODIFIED Requirements

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

### Requirement: db import command
`db import` SHALL import the legacy JSON state by hand into the database and print what it imported. With `--from <dir>` (relative to the data directory), it SHALL instead restore an export written by `db export`. Either way, it MUST refuse with a message, exit code 1 and no change when the database already holds the state of any repository.

#### Scenario: Database already holds state
- **WHEN** `db import` or `db import --from backup` runs against a database that holds a repository's state
- **THEN** it prints that the database already holds state, changes nothing and exits with code 1

#### Scenario: Empty database
- **WHEN** `db import` runs against an empty database
- **THEN** it imports the legacy files, prints the counts of repositories, findings, reports, usage rows and failures, and exits with code 0

#### Scenario: Restoring an export
- **WHEN** `db import --from backup` runs against an empty database and `backup/` holds an export
- **THEN** it restores the export, prints what it restored and exits with code 0

## ADDED Requirements

### Requirement: Export round trip
Restoring an export into an empty database SHALL reproduce what the exported database held, in one transaction:
- every repository's state, census and usage rows;
- every finding's status history and stage history, with their run ids, notes and actors;
- each finding's current stage;
- every auditor decision and label correction;
- the analyzer yield, reports and failures.

A restore that fails partway MUST leave the database as it was.

#### Scenario: Restore reproduces the auditor's work
- **WHEN** a database holds a candidate an auditor confirmed, a finding whose type an auditor corrected, and a finding resolved after being validated
- **AND** it is exported and the export is restored into an empty database
- **THEN** the restored database holds the same statuses, stages, decisions, label corrections, status histories and stage histories

#### Scenario: Restore fails partway
- **WHEN** an export holds a report file that cannot be parsed
- **THEN** `db import --from` fails with exit code 1 and the database holds no state afterwards

### Requirement: Export format is checked
`db import --from` MUST refuse a directory whose `manifest.json` is missing or names a format other than `reposcout/export@1`, with a message naming the format it expects, exit code 1 and no change. It SHALL accept an export written with an older schema version.

#### Scenario: Export from before the manifest
- **WHEN** `db import --from old-export` runs and `old-export/` has no `manifest.json`
- **THEN** it refuses, says the directory is not a `reposcout/export@1` export, and exits with code 1
