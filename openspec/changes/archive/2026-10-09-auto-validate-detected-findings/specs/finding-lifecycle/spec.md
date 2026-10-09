## ADDED Requirements

### Requirement: Reproduction by a validation pass
When a validation pass reproduces an open finding, RepoScout SHALL keep its status and every field of its finding except `verified`, which becomes true, and `reproduction`, which holds the test and output; its stage SHALL then move as Validated by reproduction defines.

#### Scenario: Detected finding reproduced
- **WHEN** a validation pass reproduces an open finding at `detected`
- **THEN** it is still `open`, its severity, confidence and description are unchanged, `verified` is true, and its stage is `validated` with the source `reproduced`

#### Scenario: Refuted by an auditor while the pass ran
- **WHEN** an auditor refutes the finding after the validation pass started and the pass reproduces it
- **THEN** the finding is `refuted` after the pass and the attempt is recorded as `reproduced`

### Requirement: Unsuccessful validation attempts
When a validation pass answers `not_reproduced` or `not_testable` for a finding, RepoScout MUST NOT change its status, stage, confidence or text, and SHALL record the attempt with the time, the run id, the outcome and the verifier's reason; after two such attempts the finding is no longer offered to a validation pass.

#### Scenario: First unsuccessful attempt
- **WHEN** a validation pass answers `not_reproduced` for an open finding at `detected` with high confidence
- **THEN** it stays `open` at `detected` with high confidence, and one attempt is recorded

#### Scenario: Second unsuccessful attempt
- **WHEN** a finding already has one unsuccessful attempt and the next pass answers `not_testable`
- **THEN** it has two attempts recorded and later validation passes leave it out

### Requirement: Validation attempts outlive the rewritten state
RepoScout SHALL keep a fingerprint's validation attempts across every run that rewrites the repository's state, including after the fingerprint leaves and re-enters the state, in the same way as its stage history.

#### Scenario: Audit after an attempt
- **WHEN** a full audit rewrites a repository's state after a finding's unsuccessful attempt
- **THEN** the attempt is still recorded for that fingerprint
