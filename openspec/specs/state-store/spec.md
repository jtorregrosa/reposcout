# state-store Specification

## Purpose
Defines `state/reposcout.db`, the SQLite database that is RepoScout's record: what it holds, how writes stay atomic while the dashboard reads, how its schema is versioned and upgraded, the one-time import of the older JSON state, and the `db info`, `db import` and `db export` commands. How findings change status is defined in finding-lifecycle; what runs write into it is defined by audit-run, usage-metrics and reports.
## Requirements
### Requirement: Database location
RepoScout SHALL keep its state in one SQLite database at `state/reposcout.db` under the data directory, which is the RepoScout directory unless `REPOSCOUT_HOME` names another, and SHALL create the `state/` directory when it is missing.

#### Scenario: Data directory override
- **WHEN** `REPOSCOUT_HOME` is set to a directory
- **THEN** the CLI and the dashboard read and write `<REPOSCOUT_HOME>/state/reposcout.db`

### Requirement: What the database records
The database SHALL record, per repository, the branch, the last audited commit overall and per analyzer, the last run, full run and speculative review times, the eligible file count, each file's audit time per analyzer and the files queued again because they were not opened; every finding with its status and full fields; the history of every status change; auditor decisions and label corrections; the reports; failures by day; the file census; one usage row per Claude run; and each run's yield per analyzer.

#### Scenario: State read back after a run
- **WHEN** a run writes a repository's state and a later run reads it
- **THEN** the later run sees the same commits, file audit times, findings and statuses that were written

### Requirement: Every write is a transaction
Every write to the database MUST be made in a transaction, so a process that dies or fails partway through a write leaves the previous committed state whole.

#### Scenario: Write fails halfway
- **WHEN** writing a repository's new state fails after some of it was written
- **THEN** the repository's previous state and history are unchanged

### Requirement: Read-then-write transactions start as writers
A transaction that reads before it writes MUST start as a writer (`BEGIN IMMEDIATE`), so a concurrent writer from another process makes it wait (up to 5 seconds) instead of failing on upgrade.

#### Scenario: Dashboard action during a run's write
- **WHEN** a run's state write is in progress and a dashboard action tries to write
- **THEN** the second writer waits for the first to commit instead of the run's transaction failing

### Requirement: Concurrent reads by the dashboard
The database SHALL allow the dashboard to read while a run writes, and SHALL let a reader detect that another process has committed, so the dashboard follows a run started elsewhere, including by Task Scheduler.

#### Scenario: Dashboard notices a run's commit
- **WHEN** a run commits new state while the dashboard is open
- **THEN** the dashboard's next check sees that the data changed and reads the new state

### Requirement: Schema versioning and automatic upgrade
The database schema SHALL be versioned with `PRAGMA user_version`, and RepoScout SHALL upgrade an older database to the current version the first time it opens it, applying each pending migration in its own transaction, without losing the data an older version wrote.

#### Scenario: Older database opened by a newer RepoScout
- **WHEN** a database at an older schema version is opened
- **THEN** its schema version becomes the current one
- **AND** the state it held reads back as before

### Requirement: One-time import of the legacy JSON state
The first time RepoScout opens a database that has never been written and has not recorded an import, and `state/` holds legacy files (`state/<repo>.json`, `state/usage.jsonl` or `state/census.json`), it SHALL import the repository states, census, usage rows, reports under `reports/<date>/` and `reports/<date>/failures.json` in one transaction, record the import time, and leave the JSON files untouched and never read them again.

#### Scenario: First use after upgrading from JSON state
- **WHEN** RepoScout opens an empty database and `state/demo.json` exists
- **THEN** the repository's state, usage, census, reports and failures are imported in one transaction
- **AND** the JSON files are left as they were

#### Scenario: Import happens only once
- **WHEN** a database that recorded an import is opened again with the JSON files still present
- **THEN** nothing is imported again

### Requirement: History of imported findings
On import, the history of each finding SHALL start with what the JSON knew: an entry at its `first_seen` to `open` (or to `speculative` for a speculative or refuted candidate), followed, when its status differs, by an entry to its current status at its resolution, refutation or last-seen time with its resolution or reason as note, with no run id.

#### Scenario: Imported resolved finding
- **WHEN** the JSON state holds a resolved finding with `first_seen` and `resolved_at`
- **THEN** its history has an entry to `open` at `first_seen` and one from `open` to `resolved` at `resolved_at`

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

### Requirement: db info command
`db info` SHALL print the database path, its size in MB including the write-ahead log, its schema version, when the JSON state was imported (or "no"), and the counts of repositories, findings (with a count per status), history events, reports, usage rows and analyzer yield rows, and exit with code 0.

#### Scenario: Inspecting the database
- **WHEN** a user runs `db info`
- **THEN** the output lists the path, size, schema version, import time and the counts, including findings per status

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

### Requirement: Initial stages on upgrade
When RepoScout upgrades a database whose schema predates lifecycle stages, it SHALL give every finding already stored the initial stage defined in the finding-lifecycle capability, in the same transaction as the upgrade. It SHALL record each assignment in the stage history with the source `upgrade` and the time of the upgrade.

#### Scenario: Upgrading a database with findings
- **WHEN** a database holding a resolved finding, a reproduced open finding and a speculative candidate is opened by this version
- **THEN** they get the stages `fixed`, `validated` and `detected`
- **AND** each has one stage history entry with the source `upgrade`

#### Scenario: Auditor-confirmed finding on upgrade
- **WHEN** the database holds an open finding that an auditor's recorded confirmation made open
- **THEN** its initial stage is `validated`

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

