## MODIFIED Requirements

### Requirement: Precision definitions
Precision SHALL count a finding as kept when it reached open at some point (resolved later still counts) and is not suppressed or refuted, and as dismissed when it is suppressed or refuted, whether it was refuted as a speculative candidate or, by an auditor, as an open finding; precision is kept / (kept + dismissed), and candidates still speculative count in neither. Suppressions are read from `repos.yaml`, so a pending suppression counts already.

#### Scenario: Resolved finding
- **WHEN** a finding was open and later resolved
- **THEN** it counts as kept

#### Scenario: Pending suppression
- **WHEN** an auditor suppresses a finding in `repos.yaml` and no run has updated the database since
- **THEN** precision counts it as dismissed

#### Scenario: Open finding refuted by an auditor
- **WHEN** an auditor refutes a finding the verifier had confirmed
- **THEN** precision counts it as dismissed for the run that first recorded it
