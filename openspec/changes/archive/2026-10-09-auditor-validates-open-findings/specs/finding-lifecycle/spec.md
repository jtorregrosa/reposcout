## MODIFIED Requirements

### Requirement: Classification of confirmed findings against state
The CLI SHALL mark each confirmed finding of a run `new` when the stored state has no open entry for its fingerprint and `existing` when it has one, store it as `open` with `last_seen` set to the run time, keep `first_seen` from the stored entry when it was open or resolved, and set `first_seen` to the run time otherwise. A confirmed finding whose fingerprint an auditor refuted as an open finding is the exception defined in "Auditor-refuted findings stay refuted".

#### Scenario: First sighting
- **WHEN** a run confirms a finding whose fingerprint is not in the state
- **THEN** the report lists it with status `new`
- **AND** the state holds it as `open` with `first_seen` and `last_seen` equal to the run time

#### Scenario: Repeated sighting
- **WHEN** a run confirms a finding whose fingerprint is stored as `open`
- **THEN** the report lists it with status `existing`
- **AND** its `first_seen` is unchanged and its `last_seen` is the run time

### Requirement: Auditor decision on a speculative candidate
The dashboard SHALL let an auditor decide a candidate that is currently `speculative` as `confirmed` (it becomes `open`) or `refuted` (it becomes `refuted` with the resolution "Refuted by <auditor>: <reason>"), with a required reason of 3 to 300 characters, recording the verdict, reason, `decided_by` (the account the dashboard runs under), the time and the decided-on status `speculative`.

#### Scenario: Auditor confirms a candidate
- **WHEN** an auditor confirms a speculative candidate with a reason
- **THEN** it becomes `open` at once
- **AND** its history gains a speculative-to-open entry "Confirmed by <auditor>: <reason>" with that auditor as actor

#### Scenario: Decision on a non-speculative finding
- **WHEN** an auditor tries to decide a finding whose status is `resolved`
- **THEN** the action is refused with HTTP 409 and nothing changes, as "Decisions that are refused" defines

### Requirement: Auditor decisions persist across runs
The CLI SHALL re-apply an auditor's decision every time a run writes the state of the fingerprint, including a run that started before the decision. A decision made on `speculative` SHALL apply only while the run holds the fingerprint as `speculative`, and MUST leave alone a candidate the run itself has since confirmed, refuted or marked duplicate. A refutation made on `open` SHALL apply whenever the run holds the fingerprint as `open` or `speculative`.

#### Scenario: Run still sees the decided candidate as speculative
- **WHEN** an auditor refutes a candidate
- **AND** a later run raises it as speculative again
- **THEN** it is stored as `refuted` with the auditor's resolution

#### Scenario: Run confirms a candidate an auditor refuted as speculative
- **WHEN** an auditor refuted a speculative candidate
- **AND** a later run confirms the same fingerprint as a finding
- **THEN** it is stored as `open` and the decision no longer applies

#### Scenario: Run confirms a finding an auditor refuted as open
- **WHEN** an auditor refuted an open finding
- **AND** a later run confirms the same fingerprint again
- **THEN** it stays `refuted` with the auditor's resolution

### Requirement: Withdrawing an auditor decision
The dashboard SHALL let an auditor withdraw a decision, which removes it and, when the decision had moved the finding (confirmed and still open, or refuted and still refuted), returns it to the status the decision was made on, recording a history entry "Decision withdrawn by <auditor>" with that auditor as actor. A withdrawn confirmation made on `open` changes no status and records no status history entry. Withdrawing when there is no decision MUST be refused with HTTP 404.

#### Scenario: Withdrawn confirmation
- **WHEN** an auditor withdraws a confirmation on a candidate that is still `open`
- **THEN** the candidate returns to `speculative` and the decision no longer applies to later runs

#### Scenario: Withdrawn refutation of an open finding
- **WHEN** an auditor withdraws the refutation of a finding that was `open` when it was refuted
- **THEN** the finding returns to `open` without the auditor's resolution
- **AND** its history gains a refuted-to-open entry "Decision withdrawn by <auditor>"

#### Scenario: Withdrawn confirmation of an open finding
- **WHEN** an auditor withdraws the confirmation of a finding that was `open` when it was confirmed
- **THEN** its status stays `open` and its stage returns as "Withdrawn confirmation returns the stage" defines

### Requirement: Validated by an auditor's confirmation
RepoScout SHALL move a finding to `validated`, with the source `auditor`, when an auditor confirms it while it is at `detected`: a speculative candidate the confirmation makes `open`, or a finding that is already `open`. This applies both when the decision is made, with the auditor as actor, and when a later run re-applies a confirmation to a candidate still at `detected`, with no actor.

#### Scenario: Auditor confirms a speculative candidate
- **WHEN** an auditor confirms a speculative candidate at `detected`
- **THEN** it becomes `open` and its stage becomes `validated` with the source `auditor`

#### Scenario: Auditor confirms an open finding
- **WHEN** an auditor confirms an open finding at `detected`
- **THEN** its status stays `open` and its stage becomes `validated` with the source `auditor` and the auditor as actor

### Requirement: Withdrawn confirmation returns the stage
When an auditor withdraws a confirmation, RepoScout SHALL return the finding's stage to the one it had before the confirmation, unless the finding has since been validated by reproduction or has moved past `validated`. This holds whether the confirmation was made on a speculative candidate, which returns to `speculative`, or on an open finding, which stays `open`.

#### Scenario: Confirmation withdrawn
- **WHEN** an auditor withdraws the confirmation of a candidate that was `detected` before it
- **THEN** the candidate is `speculative` again and its stage is `detected`

#### Scenario: Confirmation of an open finding withdrawn
- **WHEN** an auditor withdraws the confirmation of an open finding that was `detected` before it
- **THEN** the finding is still `open` and its stage is `detected`

#### Scenario: Reproduced after the confirmation
- **WHEN** an auditor confirmed an open finding and a later run reproduced it
- **AND** the auditor withdraws the confirmation
- **THEN** its stage stays `validated`

## ADDED Requirements

### Requirement: Auditor decision on an open finding
The dashboard SHALL let an auditor decide a finding that is currently `open` as `confirmed`, which keeps it `open`, or `refuted`, which makes it `refuted` with the resolution "Refuted by <auditor>: <reason>" and leaves its stage as it was, with a required reason of 3 to 300 characters, recording the verdict, reason, `decided_by`, the time and the decided-on status `open`.

#### Scenario: Auditor refutes an open finding
- **WHEN** an auditor refutes an open finding with a reason
- **THEN** it becomes `refuted` at once with the auditor's resolution and its stage is unchanged
- **AND** its history gains an open-to-refuted entry "Refuted by <auditor>: <reason>" with that auditor as actor

#### Scenario: Auditor confirms an open finding
- **WHEN** an auditor confirms an open finding at `detected`
- **THEN** its status stays `open`, no status history entry is added, and the decision is shown on the finding

### Requirement: Decisions that are refused
RepoScout MUST refuse a decision with HTTP 404 for an unknown finding, and with HTTP 409, changing nothing, when the finding is neither `speculative` nor `open`, when it already has a decision, or when it is a confirmation of an `open` finding whose stage is past `detected`.

#### Scenario: Second decision
- **WHEN** an auditor confirmed a speculative candidate and then tries to refute it
- **THEN** the action is refused with HTTP 409 until the confirmation is withdrawn

#### Scenario: Confirming a reproduced finding
- **WHEN** an auditor tries to confirm an open finding at `validated`
- **THEN** the action is refused with HTTP 409

### Requirement: Auditor-refuted findings stay refuted
When a run confirms or raises as speculative a finding whose fingerprint an auditor refuted as an open finding before the run started, the CLI SHALL keep it `refuted` with the auditor's resolution, MUST NOT list it in the report as `new` or `existing` or send it in a notification, and SHALL record no status history entry for it, even when the run reproduced it.

#### Scenario: Verifier confirms a refuted finding again
- **WHEN** an auditor refuted an open finding
- **AND** a later run's verifier confirms the same fingerprint
- **THEN** the report and the notifications leave it out and it stays `refuted`

#### Scenario: Line changes after the refutation
- **WHEN** the source line an auditor-refuted finding is anchored to changes
- **AND** a run reports the issue on the new line
- **THEN** it is reported as `new` under a different fingerprint
