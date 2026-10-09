# detection Specification

## Purpose
Detection is stage 1 of the roadmap: the `/audit` Claude session that turns a manifest of selected files into a raw findings file. It covers the manifest the CLI hands the session, how specialists and the verifier divide the judgement, the speculative review mode, the models and limits each role runs with, and the shape of the raw findings file. What the CLI does with that file afterwards belongs to finding-intake and finding-lifecycle; which files are selected belongs to file-selection, and tool permissions and read scopes belong to audit-security.
## Requirements
### Requirement: Session invocation
For each repository to audit, the CLI SHALL run one Claude session as `claude -p "/audit <clone> <range> <mode> <manifest>"`, where range is `<base>..<head>` in incremental mode and the head commit otherwise, mode is `incremental`, `full` or `speculative`, and the manifest is `reports/<date>/.work/<run-id>/<repo>/manifest.json`.

#### Scenario: Incremental audit
- **WHEN** a repository is audited in incremental mode from commit A to head B
- **THEN** the session is started with the prompt `/audit <clone> A..B incremental <manifest path>`

#### Scenario: Full audit
- **WHEN** a repository is audited in full mode at head B
- **THEN** the range argument is B alone

### Requirement: Manifest contents
The manifest MUST give the session the repository name, project and branch, the clone path, the mode, `commit_range` (`from` set only in incremental mode, `to` the head), `analyzers`, `focus_areas`, `owner_facts`, `repo_claude_md`, `diff_path`, the selected `files` with status and focus flag, `deleted_files`, `omitted_files_count`, `known_findings`, `known_false_positives`, `git_commands`, the `verification` block and the single `output_path`.

#### Scenario: Manifest written before the session
- **WHEN** a repository has files to audit
- **THEN** the CLI writes `manifest.json` under `reports/<date>/.work/<run-id>/<repo>/` before Claude starts
- **AND** `output_path` points at `raw-findings.json` in the same directory

#### Scenario: Prepare only
- **WHEN** `run --prepare-only` is used
- **THEN** the manifest is written and no Claude session is started

### Requirement: Diff file in incremental mode
In incremental mode the CLI SHALL write the diff of the selected files to `changes.diff` beside the manifest and set `diff_path` to it, capping the diff at 600,000 bytes in total; in full and speculative mode `diff_path` MUST be null.

#### Scenario: Full mode has no diff
- **WHEN** a full audit writes its manifest
- **THEN** `diff_path` is null and `commit_range.from` is null

#### Scenario: Several base commits
- **WHEN** the selected analyzers last audited different commits
- **THEN** `changes.diff` holds one section per base commit, each headed `# reposcout: changes since <commit>`, sharing the 600,000-byte cap

### Requirement: Known open findings in the manifest
The manifest's `known_findings` SHALL list every open finding whose file is among this run's selected files and whose category is one of the selected analyzers, each with fingerprint, file, line, category, title and snippet.

#### Scenario: Open finding outside the selection
- **WHEN** an open finding lies in a file that was not selected for this run
- **THEN** it is not in `known_findings`

#### Scenario: Analyzer not running
- **WHEN** an open `logic` finding lies in a selected file but only `security` runs
- **THEN** it is not in `known_findings`

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

### Requirement: Owner facts in the manifest
The manifest's `owner_facts` SHALL carry the repository's `facts` from `repos.yaml`, the defaults' facts first, each redacted, and the session MUST pass them verbatim to every specialist and to the verifier as trusted statements from the repository's owner.

#### Scenario: Facts reach the agents
- **WHEN** `repos.yaml` lists facts for a repository
- **THEN** each specialist prompt and the verifier prompt carry them, introduced as facts the repository's owner vouches for

#### Scenario: Text in the clone claiming to be a fact
- **WHEN** a file in the clone claims to state an owner fact
- **THEN** it is treated as untrusted repository data, not as an owner fact

### Requirement: Specialists run in parallel per analyzer
The session SHALL dispatch only the specialists of the manifest's `analyzers`, all in parallel, give every selected file to at least one of them, and split a specialist's share above about 15 files into batches with one instance each; each specialist MUST have only the Read, Grep and Glob tools.

#### Scenario: Analyzer subset
- **WHEN** a run uses `--analyzers security,logic`
- **THEN** only the security and logic specialists are available to the session and dispatched

#### Scenario: Large share
- **WHEN** the security specialist's share is 40 files
- **THEN** several security instances run in parallel, each with a batch of the files

### Requirement: Specialist prompt contents
Each specialist SHALL receive the clone path, its files with status and focus flag and the instruction to open every one, the mode and commit range, `focus_areas`, the diff path when there is one, the owner facts, up to 10 lines of project background from the repository's `CLAUDE.md`, and the known false positives of its own category only.

#### Scenario: Known false positives per category
- **WHEN** the manifest lists known false positives in the `security` and `logic` categories
- **THEN** the security specialist gets only the security entries and the logic specialist only the logic ones
- **AND** a specialist with no entry of its category gets no known false positives section

#### Scenario: Incremental focus
- **WHEN** the mode is incremental
- **THEN** specialists start from the diff and treat the rest of each file as context

### Requirement: Verifier input
After every specialist has returned, the session SHALL launch the verifier once with the clone path, the owner facts, every specialist candidate as one JSON array, the manifest's `known_findings`, all of the manifest's `known_false_positives`, and the `verification` block; a specialist that fails or returns malformed output MUST be noted in `notes`, and the orchestrator does not redo its work.

#### Scenario: Verifier sees all false positives
- **WHEN** the manifest lists known false positives of three categories
- **THEN** the verifier receives all of them

#### Scenario: Failed specialist
- **WHEN** one specialist instance fails
- **THEN** the verifier still runs on the other candidates and `notes` names the failure

### Requirement: Verifier outcome for each candidate
The verifier SHALL deduplicate candidates sharing a root cause, check each against the code itself, and place each in exactly one list: `findings` when traced and confirmed, `speculative` when the scenario is concrete but hinges on one point it could not confirm (stated in `unconfirmed`), or `discarded`; it MUST credit the proposing specialists in `specialists` in every list.

#### Scenario: Confirmed candidate
- **WHEN** the verifier traces a candidate's scenario through the code and it holds
- **THEN** the candidate appears in `findings` with the specialists that proposed it

#### Scenario: Depends on external configuration
- **WHEN** a candidate's impact depends on how a consumer configures a library, which the code cannot show
- **THEN** it appears in `speculative` with that point in `unconfirmed` and the severity it would have if real

#### Scenario: Duplicate of a known open finding
- **WHEN** a candidate is the same defect as a known open finding
- **THEN** it is not reported as a new finding and is recorded only through `known_findings_review`

### Requirement: High-impact security candidates are kept as speculative
The verifier SHALL keep a plausible security candidate with high potential impact that it can neither confirm nor rule out as speculative rather than discarding it, so that a person sees it.

#### Scenario: Unconfirmed high-impact security candidate
- **WHEN** a security candidate would allow an authorization bypass but depends on a deployment setting the code cannot show
- **THEN** it appears in `speculative`, not in `discarded`

### Requirement: Discard reasons
Every discarded candidate SHALL carry one of the reasons `duplicate`, `no evidence`, `style`, `not reproducible`, `prevented elsewhere` or `known-false-positive`, with its title, file and proposing specialists; a candidate matching a known false positive in pattern, category and reason MUST be discarded as `known-false-positive` unless its code differs materially from that entry's snippet.

#### Scenario: Matches a dismissed pattern
- **WHEN** a candidate repeats a pattern listed in `known_false_positives` and the code does not differ materially
- **THEN** it is discarded with the reason `known-false-positive`

#### Scenario: Line does not match
- **WHEN** a candidate's quoted snippet is not at its line
- **THEN** it is discarded with the reason `no evidence`

### Requirement: Grading and labels
For each finding and speculative candidate the verifier SHALL assign `severity` (critical, high, medium, low) from impact and reachability, `confidence`, `kind` (`vulnerability` over `bug` over `chore` when several fit), `personal_data` (true when it exposes, logs, sends, keeps or mishandles data about an identifiable person), and `repro` with preconditions, ordered steps, expected and actual results.

#### Scenario: Low confidence
- **WHEN** the verifier would rate a candidate's confidence only low
- **THEN** it goes to `speculative` instead of `findings`

#### Scenario: Credential alone
- **WHEN** a finding exposes an API key and no data about a person
- **THEN** `personal_data` is false

### Requirement: Review of known open findings
In an audit, the verifier SHALL return one `known_findings_review` entry per known open finding, with its fingerprint, `still_present` true or false for the audited commit, and a one-line reason, whether or not a specialist re-reported it.

#### Scenario: Defect fixed
- **WHEN** a known open finding's code was fixed in the audited commit
- **THEN** its review entry has `still_present: false` and a reason

### Requirement: Optional reproduction in a throwaway worktree
When the repository has a usable `test_command`, the CLI SHALL create a throwaway git worktree of the audited commit under `workspace/.verify/<repo>`, set `verification` to `enabled: true` with `worktree_path` and `test_command` as `cd <worktree> && <test_command>`, and remove the worktree when the session ends; otherwise `verification` MUST be `{ "enabled": false }`.

#### Scenario: Reproduced bug
- **WHEN** verification is enabled and the verifier writes a temporary test in the worktree that demonstrates the bug
- **THEN** the finding has `verified: true` and `reproduction` holds the test and its relevant output

#### Scenario: No test command
- **WHEN** the repository has no `test_command`, or it is ignored for lack of a sandbox
- **THEN** the manifest's `verification` is `{ "enabled": false }`, findings are confirmed from the code alone, and the report says verification was off

#### Scenario: Failed reproduction
- **WHEN** a reproduction attempt fails for a finding the code clearly shows
- **THEN** the finding may be kept with lowered confidence and `verified: false`

### Requirement: Owner facts are trusted but the code wins
The verifier SHALL settle a candidate whose open point an owner fact decides, quoting the fact in its reason, and MUST let the code win when it contradicts a fact, saying so in the reason.

#### Scenario: Fact gives the scale
- **WHEN** a performance candidate is speculative only for want of data volumes and an owner fact states them
- **THEN** the verifier judges the candidate at that scale and quotes the fact

#### Scenario: Code contradicts a fact
- **WHEN** an owner fact says a route is only reachable through a gateway but the code exposes it directly
- **THEN** the code decides the outcome and the reason states the contradiction

### Requirement: Speculative review mode
In `speculative` mode the CLI SHALL pass as `speculative_candidates` only speculative candidates whose file still exists, most severe first and then oldest, at most 30 or `--max-files`, with empty `analyzers`, `known_findings` and `known_false_positives`; the session MUST run only the verifier, once, and dispatch no specialists.

#### Scenario: More candidates than the limit
- **WHEN** a repository has 45 speculative candidates and `run --mode speculative` is used without `--max-files`
- **THEN** the 30 most severe, oldest first among equals, are reviewed

#### Scenario: Nothing to review
- **WHEN** a repository has no speculative candidate whose file exists
- **THEN** the repository is skipped with the reason `no speculative candidates` and no session starts

### Requirement: Speculative review verdicts
In a speculative review the verifier SHALL settle each candidate either as confirmed, a full finding in `findings` keeping its file, line and category, or with one `speculative_review` verdict of `refuted`, `duplicate` (with `duplicate_of`) or `still_speculative` and a reason; the review MUST NOT advance the audited commit or the per-analyzer file audit times, and MUST NOT resolve open findings.

#### Scenario: Confirmed by review
- **WHEN** the verifier confirms a speculative candidate
- **THEN** it appears in `findings` and becomes an open finding marked promoted

#### Scenario: Discarded instead of given a verdict
- **WHEN** the verifier lists a reviewed candidate in `discarded` with the same file and title
- **THEN** the CLI settles it as `duplicate` when the reason is `duplicate`, and as `refuted` otherwise

#### Scenario: No verdict given
- **WHEN** the verifier neither confirms a candidate nor gives it a verdict
- **THEN** it stays speculative, is listed in the report's `speculative_unreviewed`, and is reviewed again next time

#### Scenario: Audited commit untouched
- **WHEN** a speculative review finishes
- **THEN** the repository's last audited commit per analyzer and its file coverage are unchanged

### Requirement: Raw findings file contract
The session SHALL write `output_path` once as a JSON object with `findings`, `speculative`, `discarded`, `known_findings_review` (audit), `speculative_review` (speculative review), `validation_review` (validation), `specialist_candidates` (audit) and `notes`; a finding has file (relative, forward slashes, from the manifest), 1-based line, snippet, category, severity, confidence, verified, title, description, scenario, repro, kind, personal_data, suggested_fix, optional reproduction, and specialists.

#### Scenario: Not valid JSON
- **WHEN** the output file is not valid JSON or has no `findings` array
- **THEN** the repository fails for this run and its state is not changed

#### Scenario: Empty result
- **WHEN** nothing is confirmed
- **THEN** `findings` is an empty list, which is valid

#### Scenario: Speculative candidate fields
- **WHEN** the verifier keeps a candidate as speculative
- **THEN** its entry in `speculative` has the finding fields plus `unconfirmed`, and its `severity` is the impact it would have if real

#### Scenario: Validation output
- **WHEN** a validation session ends
- **THEN** `findings` is an empty list and every answered finding has one entry in `validation_review`

### Requirement: Models per role
The CLI SHALL run the orchestrator on `claude.models.orchestrator`, every specialist on `claude.models.specialists` and the verifier on `claude.models.verifier` (aliases `haiku`, `sonnet`, `opus`, `fable` or a `claude-*` model id; defaults sonnet, sonnet, opus), with prompts and tools from `.claude/agents/`, and pass `claude.fallback_model` as the session's fallback model when it differs from the orchestrator's.

#### Scenario: Verifier on another model
- **WHEN** `claude.models.verifier` is `fable`
- **THEN** the verifier runs on fable with the prompt and tools of `.claude/agents/verifier.md`

#### Scenario: Unknown model
- **WHEN** `repos.yaml` names a model that is neither a known alias nor a `claude-*` id
- **THEN** the configuration is rejected

### Requirement: Turn limits and timeout
The CLI SHALL bound the orchestrator with `claude.max_turns` (default 60), each specialist and verifier instance with `claude.subagent_max_turns.specialists` and `.verifier` when set (no per-subagent limit otherwise), and the whole session, its one resume included, with `claude.timeout_minutes` (default 45).

#### Scenario: Subagent limit set
- **WHEN** `claude.subagent_max_turns.specialists` is 40
- **THEN** every specialist instance stops after at most 40 turns

#### Scenario: Timeout reached
- **WHEN** the session runs past `timeout_minutes`
- **THEN** the repository fails with a message that Claude timed out after that many minutes

### Requirement: Prompt version
When each Claude session starts, the CLI SHALL compute `prompt_version` as the first 12 hex characters of SHA-256 over `.claude/skills/audit/SKILL.md` and every `.claude/agents/*.md`, with line endings normalised, and record it in the report and in the run's usage row.

#### Scenario: Prompt edited
- **WHEN** any agent file changes in content
- **THEN** the next run's `prompt_version` differs

#### Scenario: Line endings only
- **WHEN** the prompts are checked out with CRLF instead of LF line endings
- **THEN** `prompt_version` is unchanged

### Requirement: Validation mode
In `validate` mode the CLI SHALL pass as `validation_candidates` the open findings at `detected` whose file exists at the head, with no auditor decision, not suppressed in `repos.yaml` and with fewer than two unsuccessful attempts: fewest attempts first, then most severe, then oldest, at most 10 or `--max-files`. The session MUST run only the verifier, once.

#### Scenario: More findings than the cap
- **WHEN** a repository has 14 eligible findings and `run --mode validate` is used without `--max-files`
- **THEN** the manifest lists 10 of them, every finding never attempted before any finding attempted once

#### Scenario: Findings left out
- **WHEN** a repository holds open findings at `detected` that are, one each, decided by an auditor, pending suppression in `repos.yaml`, twice unsuccessfully attempted, and in a file gone at the head
- **THEN** none of them is in `validation_candidates`

### Requirement: Validation manifest
A validation manifest SHALL carry empty `analyzers`, `known_findings` and `known_false_positives`, no diff, the verification block of a worktree at the head, and for each candidate its fingerprint, file, line, category, severity, title, description, scenario, repro, snippet and the reasons of its earlier unsuccessful attempts.

#### Scenario: Earlier attempt passed on
- **WHEN** a candidate was tried once and not reproduced
- **THEN** its manifest entry carries that attempt's reason

### Requirement: Validation verdicts
For each candidate the verifier SHALL write at most one temporary test in the worktree, run the test command exactly as given, and answer in `validation_review` with `reproduced` and the test and its output, `not_reproduced` with a reason, or `not_testable` with a reason. It MUST NOT confirm, refute or rewrite a candidate, and MUST NOT propose new findings.

#### Scenario: Reproduced
- **WHEN** the test fails in the way the finding's scenario describes
- **THEN** the candidate's verdict is `reproduced` and `reproduction` holds the test and the relevant output

#### Scenario: Needs an external service
- **WHEN** exercising the code path needs a database or network the test command cannot reach
- **THEN** the verdict is `not_testable` and the reason names what is missing

#### Scenario: No verdict
- **WHEN** the verifier gives a candidate no entry in `validation_review`
- **THEN** the candidate is unchanged, no attempt is recorded and the report lists it as unreviewed

