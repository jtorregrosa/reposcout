## ADDED Requirements

### Requirement: Lifecycle stages
RepoScout SHALL keep for every finding in a repository's state exactly one lifecycle stage, `detected`, `validated`, `reported` or `fixed`, in that order, separate from its status. The status records what was decided about the finding. The stage records how far it has progressed, and stays as it was while the finding is suppressed, refuted or duplicate.

#### Scenario: Stage and status side by side
- **WHEN** a finding is `open` and its bug was reproduced by a test
- **THEN** its status is `open` and its stage is `validated`

#### Scenario: Suppression keeps the stage
- **WHEN** a `validated` open finding is suppressed
- **THEN** its status becomes `suppressed` and its stage stays `validated`

### Requirement: Stages move only on recorded events
RepoScout MUST change a finding's stage only through the transitions this capability defines: on its first appearance, on reproduction, on an auditor's confirmation, on resolution, on reopening, and on withdrawal of a confirmation. A stage MUST NOT move backwards except on reopening or on withdrawal of a confirmation.

#### Scenario: A later run without reproduction keeps the stage
- **WHEN** a finding was validated by reproduction
- **AND** a later run reports it again with `verified: false`
- **THEN** its stage stays `validated`

### Requirement: Initial stage
When a fingerprint enters a repository's state, RepoScout SHALL give it the stage `fixed` if its status is `resolved`, `validated` if it is `open` and either its finding is `verified` or an auditor's confirmation applies to it, and `detected` otherwise.

#### Scenario: New confirmed finding
- **WHEN** a run records a new open finding with `verified: false`
- **THEN** its stage is `detected`

#### Scenario: New speculative candidate
- **WHEN** a run records a new speculative candidate
- **THEN** its stage is `detected`

#### Scenario: New reproduced finding
- **WHEN** a run records a new open finding with `verified: true`
- **THEN** its stage is `validated`

### Requirement: Validated by reproduction
RepoScout SHALL move a finding at the `detected` stage to `validated`, with the source `reproduced`, when a run stores it as `open` with `verified: true`.

#### Scenario: Reproduced on a later run
- **WHEN** an open finding at `detected` is reported again with `verified: true`
- **THEN** its stage becomes `validated` with the source `reproduced`

### Requirement: Validated by an auditor's confirmation
RepoScout SHALL move a candidate to `validated`, with the source `auditor`, when an auditor's confirmation makes it `open`. This applies both when the decision is made, with the auditor as actor, and when a later run re-applies it to a candidate still at `detected`, with no actor.

#### Scenario: Auditor confirms a speculative candidate
- **WHEN** an auditor confirms a speculative candidate at `detected`
- **THEN** it becomes `open` and its stage becomes `validated` with the source `auditor`

### Requirement: Withdrawn confirmation returns the stage
When an auditor withdraws a confirmation and the candidate returns to `speculative`, RepoScout SHALL return its stage to the one it had before the confirmation, unless the finding has since been validated by reproduction.

#### Scenario: Confirmation withdrawn
- **WHEN** an auditor withdraws the confirmation of a candidate that was `detected` before it
- **THEN** the candidate is `speculative` again and its stage is `detected`

### Requirement: Fixed on resolution
RepoScout SHALL move a finding to the `fixed` stage, with the source `resolved` and the resolution as note, whenever its status changes to `resolved`, whatever resolved it.

#### Scenario: Two misses resolve a validated finding
- **WHEN** a `validated` open finding is resolved after two consecutive misses
- **THEN** its stage becomes `fixed` with the resolution as note

### Requirement: Reopening returns to the earlier stage
When a resolved finding is reopened, RepoScout SHALL return its stage to the one it had before it became `fixed`, with the source `reopened`, or to `detected` when that is unknown. RepoScout SHALL then move it to `validated` if the run that reopened it reproduced it.

#### Scenario: Reopened validated finding
- **WHEN** a finding that was `validated` before it was resolved is reported again
- **THEN** its status is `open` and its stage is `validated` with the source `reopened`

#### Scenario: Reopened finding with no earlier stage
- **WHEN** a resolved finding whose stage history does not show what it was before `fixed` is reopened
- **THEN** its stage becomes `detected`

### Requirement: Reported stage reserved
RepoScout SHALL accept `reported` as a stage in its data, its API and its dashboard, but no transition in this capability SHALL move a finding to it. A finding can return to `reported` only by reopening, from a stage history that already held it.

#### Scenario: No finding reaches reported today
- **WHEN** runs, decisions and withdrawals are applied to findings
- **THEN** none of them moves a finding to `reported`

### Requirement: Stage outlives the rewritten state
RepoScout MUST keep a finding's stage across every run that rewrites the repository's state, and SHALL drop it when the fingerprint leaves the state. The fingerprint's stage history stays.

#### Scenario: Run rewrites the state
- **WHEN** a run rewrites a repository's state and a `validated` finding is still in it
- **THEN** the finding is still `validated` after the run

#### Scenario: Fingerprint leaves the state
- **WHEN** a speculative candidate leaves the state because its file was deleted
- **AND** later a candidate with the same fingerprint enters the state again
- **THEN** it gets an initial stage as a new fingerprint would

### Requirement: Stage history
RepoScout SHALL record every stage change of a finding in the same transaction as the change that caused it. Each entry holds the time, the run id (none for a dashboard action), the previous stage (none on first appearance), the new stage, the source (`initial`, `reproduced`, `auditor`, `resolved`, `reopened`, `withdrawn` or `upgrade`), a note, and the actor: null when a run made the change, the auditor's name when made from the dashboard.

#### Scenario: First appearance recorded
- **WHEN** a run records a new finding
- **THEN** its stage history holds one entry with no previous stage, the new stage, the source `initial` and the run id

#### Scenario: Auditor confirmation recorded
- **WHEN** an auditor confirms a speculative candidate
- **THEN** its stage history gains an entry from `detected` to `validated` with the source `auditor`, no run id and the auditor as actor
