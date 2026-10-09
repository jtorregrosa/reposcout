## ADDED Requirements

### Requirement: Decided-on status of auditor decisions
The database SHALL record for every auditor decision the status it was made on, `speculative` or `open`, and `decisions.json` in an export SHALL carry it as `decided_on`. A decision stored before this was recorded, or restored from an export whose decision has no `decided_on`, SHALL be treated as made on `speculative`.

#### Scenario: Upgrading a database with decisions
- **WHEN** a database holding an auditor's refutation of a speculative candidate is opened by this version
- **THEN** that decision is recorded as made on `speculative` and later runs re-apply it as before

#### Scenario: Restoring an older export
- **WHEN** `db import --from` restores an export whose `decisions.json` entries have no `decided_on`
- **THEN** the restore succeeds and each decision is recorded as made on `speculative`

#### Scenario: Round trip of a decision on an open finding
- **WHEN** an auditor refuted an open finding and the database is exported and restored into an empty database
- **THEN** the restored decision is made on `open` and the finding is `refuted`
