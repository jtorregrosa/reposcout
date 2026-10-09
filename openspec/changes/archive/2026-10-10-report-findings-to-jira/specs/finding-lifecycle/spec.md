## ADDED Requirements

### Requirement: Reported on a linked issue
RepoScout SHALL move a finding from `validated` to `reported`, with the source `reported` and the issue key as note, when an issue is linked to it. It SHALL move the finding back to `validated`, with the source `unlinked`, when the issue is unlinked. Runs SHALL keep `reported` like any other stage, and the stage SHALL stay `reported` while the finding is suppressed, refuted or duplicate.

#### Scenario: Issue linked
- **WHEN** an issue `API-42` is linked to a validated open finding
- **THEN** its stage becomes `reported` with the source `reported` and the note `API-42`

#### Scenario: Later run
- **WHEN** a later run reports the reported finding again
- **THEN** its stage stays `reported`

#### Scenario: Unlinked
- **WHEN** the issue is unlinked
- **THEN** the finding's stage is `validated` with the source `unlinked`

## MODIFIED Requirements

### Requirement: Stages move only on recorded events
RepoScout MUST change a finding's stage only through the transitions this capability defines:
- on its first appearance;
- on reproduction;
- on an auditor's confirmation;
- on linking or unlinking an issue;
- on resolution;
- on reopening;
- on withdrawal of a confirmation.

A stage MUST NOT move backwards except on reopening, on withdrawal of a confirmation, or on unlinking an issue.

#### Scenario: A later run without reproduction keeps the stage
- **WHEN** a finding was validated by reproduction
- **AND** a later run reports it again with `verified: false`
- **THEN** its stage stays `validated`

### Requirement: Stage history
RepoScout SHALL record every stage change of a finding in the same transaction as the change that caused it. Each entry holds:
- the time;
- the run id (none for a dashboard action);
- the previous stage (none on first appearance);
- the new stage;
- the source: `initial`, `reproduced`, `auditor`, `reported`, `unlinked`, `resolved`, `reopened`, `withdrawn` or `upgrade`;
- a note;
- the actor: null when a run made the change, the auditor's name when made from the dashboard.

#### Scenario: First appearance recorded
- **WHEN** a run records a new finding
- **THEN** its stage history holds one entry with no previous stage, the new stage, the source `initial` and the run id

#### Scenario: Auditor confirmation recorded
- **WHEN** an auditor confirms a speculative candidate
- **THEN** its stage history gains an entry from `detected` to `validated` with the source `auditor`, no run id and the auditor as actor

#### Scenario: Report recorded
- **WHEN** an auditor reports a validated finding as `API-42`
- **THEN** its stage history gains an entry from `validated` to `reported` with the source `reported`, the note `API-42`, no run id and the auditor as actor

## REMOVED Requirements

### Requirement: Reported stage reserved
**Reason**: Linking a Jira issue now moves a finding to `reported`.
**Migration**: None. Existing findings keep their stages, and only a linked issue moves one to `reported`.
