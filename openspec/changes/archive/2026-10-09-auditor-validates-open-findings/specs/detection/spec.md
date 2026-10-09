## MODIFIED Requirements

### Requirement: Known false positives in the manifest
The manifest's `known_false_positives` SHALL hold at most the 20 most recently dismissed findings of the selected analyzers: suppressed ones, including a suppression added to `repos.yaml` since the last run, with the reason from `repos.yaml`, and refuted ones with their refutation, whether a review or an auditor refuted a speculative candidate or an auditor refuted an open finding; each has title, file, category, snippet, `dismissed_as` and reason, redacted and cut to 300 characters.

#### Scenario: More than 20 dismissed findings
- **WHEN** a repository has 25 suppressed or refuted findings in the selected analyzers' categories
- **THEN** the manifest lists the 20 most recently dismissed, newest first

#### Scenario: New suppression not yet applied
- **WHEN** a fingerprint was added under `suppressed` in `repos.yaml` after the last run
- **THEN** it is listed with `dismissed_as` `suppressed` and the reason from `repos.yaml`

#### Scenario: Open finding refuted by an auditor
- **WHEN** an auditor refuted an open finding of an analyzer the next audit runs
- **THEN** the manifest lists it with `dismissed_as` `refuted` and the auditor's resolution as reason
