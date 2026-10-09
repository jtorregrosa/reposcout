## MODIFIED Requirements

### Requirement: db export command
`db export` SHALL write the state as JSON into `exports/<timestamp>/` under the data directory, or into the directory given by `--out` (relative to the data directory). The export SHALL hold:
- `state/<repo>.json` per repository, in the shape of the older JSON state;
- `state/census.json`;
- `state/usage.jsonl`;
- `finding-history.json` with every history entry;
- `finding-stages.json` with every stage history entry;
- `analyzer-yield.json`.

It SHALL then print how many repositories and history events it exported.

#### Scenario: Default export
- **WHEN** a user runs `db export`
- **THEN** a new `exports/<timestamp>/` directory holds the per-repository state, census, usage, finding history, stage history and analyzer yield files

#### Scenario: Export to a chosen directory
- **WHEN** a user runs `db export --out backup`
- **THEN** the same files are written under `backup/` in the data directory

## ADDED Requirements

### Requirement: Initial stages on upgrade
When RepoScout upgrades a database whose schema predates lifecycle stages, it SHALL give every finding already stored the initial stage defined in the finding-lifecycle capability, in the same transaction as the upgrade. It SHALL record each assignment in the stage history with the source `upgrade` and the time of the upgrade.

#### Scenario: Upgrading a database with findings
- **WHEN** a database holding a resolved finding, a reproduced open finding and a speculative candidate is opened by this version
- **THEN** they get the stages `fixed`, `validated` and `detected`
- **AND** each has one stage history entry with the source `upgrade`

#### Scenario: Auditor-confirmed finding on upgrade
- **WHEN** the database holds an open finding that an auditor's recorded confirmation made open
- **THEN** its initial stage is `validated`
