## MODIFIED Requirements

### Requirement: Budget estimate for sweeps and backfills
Before each sweep pass, backfill batch or validation session, RepoScout SHALL take the latest subscription reading whose window has not reset, add the measured cost of the previous pass, batch or session, or 8% of the 5-hour window and 2% of the weekly one before any was measured, and refuse to start when the 5-hour sum exceeds the session limit (default 90%) or the weekly sum the weekly limit (default 95%).

#### Scenario: First pass without a reading
- **WHEN** no current subscription reading exists
- **THEN** the pass proceeds, since it measures usage

#### Scenario: Estimate would cross the session limit
- **WHEN** the 5-hour window is at 85% and no pass has been measured
- **THEN** the next pass is not started because 85% + 8% exceeds 90%

#### Scenario: Status not allowed
- **WHEN** the latest reading's status does not start with `allowed`
- **THEN** the next pass is not started

#### Scenario: Second validation session measured
- **WHEN** the first validation session of a run moved the 5-hour window by 3% and it now reads 80%
- **THEN** the next validation session starts, because 80% + 3% does not exceed 90%

### Requirement: Yield per analyzer recorded per run
For every audit outside a speculative review or a validation pass, RepoScout SHALL record each selected analyzer's yield in the database and the report: specialist instances, candidates proposed, kept, speculative and discarded counts, tokens, and cost; a speculative review or a validation pass records no yield.

#### Scenario: Speculative review
- **WHEN** a run in speculative mode completes
- **THEN** no yield is recorded for it

#### Scenario: Validation pass
- **WHEN** a run in validate mode completes
- **THEN** no yield is recorded for it

## ADDED Requirements

### Requirement: Usage of a validation session
RepoScout SHALL record a validation session's usage row with the mode `validate`, empty analyzers and the number of findings it was given as its files; the row SHALL count in the 7-day totals and in cost per finding like any other run, and MUST NOT change precision.

#### Scenario: Validation session on the Usage page
- **WHEN** a validation session tried 8 findings
- **THEN** the Usage page shows its row with the mode `validate`, 8 files and its cost
