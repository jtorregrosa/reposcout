## MODIFIED Requirements

### Requirement: Findings filters and sort
The Findings page SHALL narrow the list by:
- repository;
- severity;
- type, including findings with no type yet;
- category;
- lifecycle stage (`detected`, `validated`, `reported` or `fixed`, several at once);
- personal data;
- a text search over title, file, description, fingerprint and repository.

It SHALL sort by severity (default), by newest first seen, or by location.

#### Scenario: Search
- **WHEN** the auditor types part of a fingerprint in the search box
- **THEN** only findings whose title, file, description, fingerprint or repository contain it are listed

#### Scenario: Stage filter
- **WHEN** the auditor selects the stages `validated` and `fixed`
- **THEN** only findings at one of those stages are listed
- **AND** each status tab counts only findings at those stages

### Requirement: Findings view state in the URL
The Findings page MUST keep every filter, the status tab, the sort and the selected finding in the URL query (`status`, `repo`, `severity`, `category`, `kind`, `stage`, `pd`, `q`, `sort`, `id`, `view`), so a view can be bookmarked, shared with another auditor and walked back with the browser's back button. A `stage` value that is not a known stage MUST be ignored.

#### Scenario: Shared link
- **WHEN** an auditor opens a Findings URL another auditor sent
- **THEN** the same tab, filters, sort and selected finding are shown

#### Scenario: Unknown stage in the URL
- **WHEN** a Findings URL has `stage=validated,shipped`
- **THEN** the stage filter holds only `validated`

### Requirement: Finding detail
The selected finding SHALL open beside the list and show:
- its severity, category, status, file and line, type and personal-data mark;
- its lifecycle stage as a four-step timeline (detected, validated, reported, fixed) with the current step marked and the date each reached step was entered;
- the scenario, reproduction steps, why it is a bug, the suggested fix and the anchored code;
- its confidence, specialists, first and last seen, commit and fingerprint;
- any unconfirmed point, suppression reason, resolution or auditor decision;
- its history of statuses, each linked to the run that set it.

#### Scenario: Speculative candidate selected
- **WHEN** the auditor selects a speculative candidate
- **THEN** the detail shows what the verifier could not confirm alongside the evidence

#### Scenario: History
- **WHEN** a finding is selected
- **THEN** its history lists every status it has had, each linked to the run that set it

#### Scenario: Stage timeline
- **WHEN** the auditor selects a finding that was validated by an auditor and later resolved
- **THEN** the timeline marks `fixed` as current, shows the dates it entered `detected`, `validated` and `fixed`, and leaves `reported` as not reached

## ADDED Requirements

### Requirement: Stage history endpoint
The dashboard SHALL serve a finding's stage history, oldest first, as a read-only request behind the same guards as every other dashboard request, and SHALL include each finding's current stage, the time it entered it and the source of that change in the findings it serves.

#### Scenario: Stage history requested
- **WHEN** the dashboard requests the stage history of a finding that was detected and then validated by reproduction
- **THEN** it receives two entries in order, the first with the source `initial` and the second with the source `reproduced`
