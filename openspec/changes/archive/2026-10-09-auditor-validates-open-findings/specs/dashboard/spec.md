## RENAMED Requirements

- FROM: `### Requirement: Decide a speculative candidate`
- TO: `### Requirement: Decide a finding`

## MODIFIED Requirements

### Requirement: Decide a finding
The finding detail SHALL offer Confirm and Refute for speculative candidates, Confirm for open findings at the `detected` stage and Refute for every open finding, each requiring a reason of 3 to 300 characters, recorded in the database with the auditor's account name and time, and SHALL offer Undo this decision on a decided finding. The actions SHALL be hidden on a finding that already has a decision, and their wording SHALL name a candidate or a finding according to its status.

#### Scenario: Confirming
- **WHEN** the auditor confirms a speculative candidate with a reason
- **THEN** it becomes an open finding showing who confirmed it, when and why

#### Scenario: Refuting an open finding
- **WHEN** the auditor refutes an open finding with a reason
- **THEN** it moves to the Refuted tab showing who refuted it, when and why, and offers Undo this decision

#### Scenario: Confirming an open finding
- **WHEN** the auditor confirms an open finding at `detected`
- **THEN** it stays in the Open tab, its stage timeline shows `validated`, and the detail shows who confirmed it, when and why

#### Scenario: Reproduced open finding
- **WHEN** the auditor selects an open finding at `validated`
- **THEN** the detail offers Refute and does not offer Confirm

#### Scenario: Deciding a non-speculative finding
- **WHEN** a decision is requested for a finding that is neither speculative nor open, or that already has a decision
- **THEN** it is refused with status 409
- **AND** a decision for an unknown finding, or an undo with no decision, is refused with status 404
