# finding-lifecycle Specification

## Purpose
Defines how a finding, identified by its fingerprint, moves between the statuses open, speculative, resolved, suppressed, refuted and duplicate across runs, what triggers every transition, and how each change is recorded in the finding's history. It covers classification against the stored state, resolution, reopening, suppression, speculative review outcomes, auditor decisions and label overrides; how candidates are validated and fingerprinted belongs to finding-intake, and how the state is stored belongs to state-store.
## Requirements
### Requirement: Finding statuses
RepoScout SHALL keep every finding of a repository in exactly one of the statuses `open` (confirmed), `speculative` (plausible but unconfirmed), `resolved`, `suppressed`, `refuted` or `duplicate`, keyed by its fingerprint within that repository.

#### Scenario: A status outside the set is never stored
- **WHEN** a run writes a repository's state
- **THEN** every finding in it has one of the statuses open, speculative, resolved, suppressed, refuted or duplicate

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

### Requirement: Labels and steps carried over when a run omits them
When a run reports a finding again without reproduction steps, a type or a personal-data mark, the CLI SHALL keep the values the stored finding already had for the omitted fields, and SHALL take the run's values for fields the run does report.

#### Scenario: Steps from a backfill survive a later run
- **WHEN** a stored open finding has reproduction steps and a type
- **AND** a later run reports it again with neither
- **THEN** the stored finding keeps its reproduction steps and type

### Requirement: Resolution by verifier review
The CLI SHALL resolve an open finding at once when the verifier reviews it with `still_present: false` and its file is in the run's audited files and its category is among the analyzers that ran, recording the verifier's reason (or "the verifier found it no longer present") as its resolution and the run time as `resolved_at`.

#### Scenario: Verifier finds it gone
- **WHEN** an open finding's file is audited by its own category
- **AND** the verifier reviews it with `still_present: false`
- **THEN** it becomes `resolved` in that run and appears among the report's resolved findings with the reason

#### Scenario: Verifier confirms it is still there
- **WHEN** the verifier reviews an open finding with `still_present: true`
- **THEN** it stays `open`, its `last_seen` becomes the run time and its miss count is reset

### Requirement: Resolution by file deletion
The CLI SHALL resolve an open finding with the resolution "file deleted" when its file is among the run's deleted files: the deletions and renames since the base commit in an incremental run, or, in a full run, which has no diff, every file of an open or speculative finding that is no longer tracked in the tree.

#### Scenario: Incremental run deletes the file
- **WHEN** an incremental run's diff deletes or renames away the file of an open finding
- **THEN** the finding becomes `resolved` with the resolution "file deleted"

#### Scenario: Full run no longer finds the file
- **WHEN** a full run finds that the file of an open finding is not tracked at the head commit
- **THEN** that file is treated as deleted and the finding becomes `resolved` with the resolution "file deleted"

### Requirement: Resolution after two consecutive misses
The CLI SHALL count a miss for an open finding when a run audits its file, its category is among the analyzers that ran, a specialist of its category opened the file (or the verifier reviewed it without saying either way), and the run did not report it; it SHALL resolve the finding on the 2nd consecutive miss with the resolution "not reported again in 2 consecutive re-audits of the file", and any sighting SHALL reset the count to zero.

#### Scenario: One miss is not enough
- **WHEN** an open finding's specialist opens its file and does not report it once
- **THEN** the finding stays `open` with a miss count of 1

#### Scenario: Second consecutive miss resolves
- **WHEN** the next run that re-audits the file also does not report it
- **THEN** the finding becomes `resolved`

#### Scenario: A sighting resets the count
- **WHEN** an open finding with one miss is reported again
- **THEN** its miss count returns to zero and a later single miss does not resolve it

### Requirement: Unopened files are neither seen nor missed
The CLI SHALL leave an open finding unchanged, with no miss counted, when its file was in the run's file list but no specialist of its category opened it and the verifier did not review it.

#### Scenario: File listed but not opened
- **WHEN** a run lists an open finding's file but the finding's specialist never opens it
- **THEN** the finding stays `open` and its miss count does not change

### Requirement: Only analyzers that ran can resolve
The CLI MUST NOT resolve or count a miss for an open finding whose category is not among the analyzers selected for the run, or whose file is not in the run's audited files, except when its file is deleted.

#### Scenario: Subset run leaves other categories open
- **WHEN** a run with only `security` re-audits the file of an open `logic` finding and does not report it
- **THEN** the `logic` finding stays `open` with no miss counted

#### Scenario: Speculative review does not resolve open findings
- **WHEN** a run in speculative mode reviews candidates in a file that also holds an open finding
- **THEN** the open finding is neither resolved nor counted as missed

### Requirement: Open finding reported again only as speculative
The CLI SHALL treat an open finding that a run reports again only as a speculative candidate as still present: it stays `open`, its `last_seen` is refreshed, its miss count is reset, and no speculative entry is created for it.

#### Scenario: Auditor-confirmed finding seen as speculative
- **WHEN** a run reports the fingerprint of an open finding as a speculative candidate
- **THEN** the finding stays `open` and is not added to the speculative candidates

### Requirement: Reopening a resolved finding
The CLI SHALL report a resolved finding that a run confirms again as `new` and marked `reopened`, keep its original `first_seen`, store it as `open` with `reopened_at` set to the run time, and record a history entry from `resolved` to `open` with the note "Reopened: reported again after it was resolved".

#### Scenario: Resolved finding reappears
- **WHEN** a run confirms a finding whose fingerprint is stored as `resolved`
- **THEN** the report lists it as `new` with `reopened: true` and its original `first_seen`
- **AND** its history gains a resolved-to-open entry noting the reopening

### Requirement: Speculative candidates are tracked apart from open findings
The CLI SHALL store a speculative candidate as `speculative`, keep its `first_seen` while it stays speculative, refresh its `last_seen` each time it is raised again, list it among the report's new speculative candidates only on its first sighting, and MUST NOT count speculative candidates in the open total.

#### Scenario: New speculative candidate
- **WHEN** a run raises a speculative candidate whose fingerprint is not in the state
- **THEN** it is stored as `speculative` and listed in the report's `speculative_new`
- **AND** the report's `open_total` does not include it

### Requirement: Speculative candidates are never auto-resolved
The CLI MUST NOT resolve or count misses for a speculative candidate that a run does not raise again; it SHALL leave that status only when confirmed, refuted or marked duplicate by a review or an auditor, suppressed, or removed from the state when its file is deleted.

#### Scenario: Candidate not raised again
- **WHEN** a run re-audits the file of a speculative candidate and does not raise it
- **THEN** the candidate stays `speculative`

#### Scenario: File of a speculative candidate deleted
- **WHEN** the file of a speculative candidate is among the run's deleted files
- **THEN** the candidate leaves the state and its history records a change to `removed`

### Requirement: Promotion of a speculative candidate
The CLI SHALL store a speculative candidate that a run confirms as a finding as `open`, report it as `new` and marked `promoted`.

#### Scenario: Later run confirms the candidate
- **WHEN** a run confirms a finding whose fingerprint is stored as `speculative`
- **THEN** the report lists it as `new` with `promoted: true`
- **AND** the state holds it as `open`

### Requirement: Refutation by a speculative review
The CLI SHALL move a speculative candidate to `refuted` when a review gives it the verdict `refuted`, recording the redacted reason as its resolution and the run time as `refuted_at`, and MUST NOT raise a refuted fingerprint as a speculative candidate again; only a change to its line, which changes the fingerprint, lets the same issue be raised afresh.

#### Scenario: Review refutes the candidate
- **WHEN** a speculative review returns `refuted` with a reason for a candidate
- **THEN** the candidate becomes `refuted` with that reason as its resolution and is listed among the report's refuted candidates

#### Scenario: Refuted candidate raised again
- **WHEN** a later run raises a speculative candidate with the fingerprint of a refuted one
- **THEN** it stays `refuted` and is not listed as a new speculative candidate

### Requirement: Duplicate verdict on a speculative candidate
The CLI SHALL move a speculative candidate to `duplicate` when a review gives it the verdict `duplicate` naming another fingerprint (or none), with the resolution "Duplicate of <fingerprint>." or "Duplicate of another candidate." followed by the reason, MUST ignore a duplicate verdict that names the candidate itself, and MUST NOT raise a duplicate fingerprint as a speculative candidate again.

#### Scenario: Candidate is a duplicate of another
- **WHEN** a speculative review marks a candidate `duplicate` of another fingerprint
- **THEN** the candidate becomes `duplicate` with a resolution naming the kept fingerprint

#### Scenario: Self-referencing duplicate verdict
- **WHEN** a review marks a candidate as a duplicate of its own fingerprint
- **THEN** the candidate stays `speculative`

### Requirement: Verdicts from the verifier's discards in a speculative review
In a speculative review, the CLI SHALL settle a candidate under review that the verifier put among its discards (matched by file and title, ignoring case and surrounding whitespace) instead of leaving it speculative: as `duplicate` when the discard reason is "duplicate", otherwise as `refuted` with the resolution "Discarded by the verifier: <reason>."; a candidate with neither a verdict nor a discard SHALL stay speculative and be listed in the report's `speculative_unreviewed` with a warning in the log.

#### Scenario: Discarded candidate under review
- **WHEN** a speculative review discards a candidate under review with the reason "no evidence"
- **THEN** the candidate becomes `refuted` with the resolution "Discarded by the verifier: no evidence."

#### Scenario: Candidate without a verdict
- **WHEN** a speculative review gives a candidate under review no verdict and does not discard it
- **THEN** it stays `speculative` and its fingerprint is listed in `speculative_unreviewed`

### Requirement: Still-speculative review note
The CLI SHALL keep a speculative candidate that a review leaves speculative in that status, refresh its `last_seen`, store the reviewer's redacted reason as its review note, and record a history entry with the same from and to status and that note whenever the note changes.

#### Scenario: Review changes nothing
- **WHEN** a speculative review returns `still_speculative` with a reason for a candidate
- **THEN** the candidate stays `speculative` with the reason as its review note
- **AND** its history gains a speculative-to-speculative entry carrying the reason

### Requirement: Suppression via repos.yaml
The CLI SHALL store as `suppressed`, with the reason from `repos.yaml`, every finding or speculative candidate whose fingerprint is listed under the repository's `suppressed` entries, whatever its status, and MUST NOT report a suppressed finding as new or existing; the dashboard's Suppress action only edits `repos.yaml`, and the status changes at the next run.

#### Scenario: Reported finding is suppressed
- **WHEN** a run confirms a finding whose fingerprint is listed under `suppressed` with a reason
- **THEN** the report does not list it as new or existing and counts it in `suppressed_count`
- **AND** the state holds it as `suppressed` with that reason

#### Scenario: Suppressed finding not reported
- **WHEN** a finding listed under `suppressed` is not reported by the run
- **THEN** it stays `suppressed` instead of being resolved or counted as missed

### Requirement: Suppression restores the earlier status on removal
The CLI SHALL record, for each suppressed finding, the status it would have without the suppression, and SHALL return the finding to that status (open, speculative, resolved, refuted or duplicate) at the first run after its entry is removed from `repos.yaml`; an entry suppressed by a version that did not record that status SHALL become `open`.

#### Scenario: Unsuppressing a refuted candidate
- **WHEN** a refuted candidate is suppressed and its entry is later removed from `repos.yaml`
- **THEN** the next run returns it to `refuted`

#### Scenario: Legacy suppression without a recorded status
- **WHEN** a suppressed entry with no recorded earlier status leaves the suppression list
- **THEN** the next run stores it as `open`

### Requirement: Suppression is bound to the anchored code
The CLI SHALL match a suppression only by exact fingerprint, so when the anchored source line of a suppressed finding changes, a finding reported on the new code gets a new fingerprint, is not suppressed, and is classified afresh.

#### Scenario: Suppressed code is edited
- **WHEN** the source line a suppressed finding is anchored to changes
- **AND** a run reports the issue again on the new line
- **THEN** it is reported as `new` under a different fingerprint

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

### Requirement: Auditor label overrides
The dashboard SHALL let an auditor set a finding's type (`bug`, `vulnerability` or `chore`) and its personal-data mark, alone or together, applying the change at once, keeping an earlier correction of the field left out, and re-applying the corrected fields over whatever any later run or backfill reports, while fields the auditor never corrected follow the run.

#### Scenario: Correction survives a run
- **WHEN** an auditor changes a finding's type from Bug to Chore
- **AND** a later run reports it as a vulnerability with personal data
- **THEN** its type stays Chore and its personal-data mark follows the run

#### Scenario: Request with nothing to change
- **WHEN** a label request gives neither a type nor a personal-data mark
- **THEN** it is refused with HTTP 400

### Requirement: Finding history
RepoScout SHALL append a history entry for every status change of a finding, with the time, the run id (none for a dashboard action), the previous status (none for a first appearance), the new status, a note (the resolution, the suppression reason or the reviewer's words) and the actor, which is null when a run made the change and the auditor's name when made from the dashboard; a fingerprint leaving the state SHALL be recorded with the new status `removed`, and a label correction that changes a value SHALL be recorded with an unchanged status and a note "Labels changed by <auditor>: …".

#### Scenario: Run changes a status
- **WHEN** a run resolves an open finding
- **THEN** its history gains an entry with the run id, from `open`, to `resolved`, the resolution as note and a null actor

#### Scenario: Auditor changes a label
- **WHEN** an auditor changes a finding's type
- **THEN** its history gains an entry with the same from and to status, a note naming the old and new type, and the auditor as actor

### Requirement: Fingerprint migration merges duplicates
On the first run against state written with an older fingerprint version, the CLI SHALL recompute each finding's fingerprint from its file and line in the fresh clone (keeping the old one when the file is gone or the line is past its end), merge entries that now share a fingerprint by keeping the higher status (open, speculative, suppressed, resolved, duplicate, refuted in that order), the earliest `first_seen`, the latest `last_seen` and the union of specialists, and log each `suppressed` entry in `repos.yaml` whose fingerprint changed with its new value.

#### Scenario: Two version-1 entries for one bug
- **WHEN** older state holds two entries that anchor to the same line in the same category
- **THEN** the next run keeps a single entry with the earliest `first_seen`
- **AND** the old fingerprints that left the state are recorded in history as `removed`

#### Scenario: Suppressed fingerprint changes
- **WHEN** a fingerprint listed under `suppressed` is remapped by the migration
- **THEN** the log warns with the old and new fingerprint so the entry can be updated

### Requirement: Lifecycle stages
RepoScout SHALL keep for every finding in a repository's state exactly one lifecycle stage, `detected`, `validated`, `reported` or `fixed`, in that order, separate from its status. The status records what was decided about the finding. The stage records how far it has progressed, and stays as it was while the finding is suppressed, refuted or duplicate.

#### Scenario: Stage and status side by side
- **WHEN** a finding is `open` and its bug was reproduced by a test
- **THEN** its status is `open` and its stage is `validated`

#### Scenario: Suppression keeps the stage
- **WHEN** a `validated` open finding is suppressed
- **THEN** its status becomes `suppressed` and its stage stays `validated`

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
