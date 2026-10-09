# file-selection Specification

## Purpose
File selection decides which files of a fetched repository one audit hands to the specialists: the candidates from the diff or the tree, the exclusions, the ranking, the caps and the full-mode rotation, and afterwards which of them count as audited per analyzer from what the specialists actually opened. It does not cover fetching the clone (repository-checkout) or how findings in those files are classified (finding-lifecycle).

## Requirements

### Requirement: Incremental candidates from the diff
In incremental mode RepoScout SHALL take as candidates the files added, modified, copied or renamed between each distinct last audited commit of the selected analyzers and the head, and SHALL treat deleted files and the old paths of renamed files as deleted unless they are also candidates.

#### Scenario: Analyzers at different commits
- **WHEN** `security` last audited `A` and `logic` last audited `B`, and both run incrementally
- **THEN** the candidates are the union of the files changed since `A` and since `B`

#### Scenario: Renamed file
- **WHEN** `src/a.ts` was renamed to `src/b.ts` since the last audit
- **THEN** `src/b.ts` is a candidate and `src/a.ts` is treated as deleted

### Requirement: Incremental diff for the auditors
In incremental mode RepoScout SHALL write the diff of the selected files since each base commit to `changes.diff` in the run's work directory, capped at 600,000 bytes in total split evenly between base commits, ending a truncated diff with a note to read the files directly.

#### Scenario: Large diff
- **WHEN** the diff of the selected files exceeds the cap
- **THEN** it is cut at the cap and ends with "diff truncated at <n> bytes; read the files directly"

### Requirement: Baseline full run
RepoScout SHALL audit a repository in full mode, whatever mode was asked except speculative, when any selected analyzer has no last audited commit.

#### Scenario: New repository
- **WHEN** an incremental run reaches a repository with no state
- **THEN** it is audited in full mode as its baseline

### Requirement: Full-mode candidates from the tree
In full mode RepoScout SHALL take every tracked file at the head as a candidate, and SHALL treat as deleted the files of open and speculative findings that are no longer tracked.

#### Scenario: Finding in a removed file
- **WHEN** a full run finds that the file of an open finding is no longer tracked
- **THEN** that file is passed on as deleted

### Requirement: Nothing auditable changed
When no candidate survives selection in incremental mode, RepoScout SHALL record the head as the selected analyzers' last audited commit and skip the repository without starting Claude.

#### Scenario: Only excluded files changed
- **WHEN** the only changed files since the last audit match `excluded_paths`
- **THEN** the head is recorded and the repository is skipped with the reason "no auditable files changed"

### Requirement: Exclusions
RepoScout SHALL drop any candidate that matches `.git/**`, `**/.claude/**`, `CLAUDE.local.md`, `.mcp.json` or a glob in the repository's `excluded_paths`, matching case-insensitively and including dot files, and SHALL drop candidates missing from the working tree.

#### Scenario: Excluded glob
- **WHEN** `excluded_paths` holds `**/migrations/**` and a migration file changed
- **THEN** the migration file is skipped as excluded

### Requirement: Oversized, empty and binary files
RepoScout SHALL skip a candidate larger than `max_file_bytes` (default 200,000 bytes), an empty one, and one whose first 8,000 bytes contain a NUL byte.

#### Scenario: Generated bundle
- **WHEN** a changed file is 500,000 bytes and `max_file_bytes` is the default
- **THEN** it is skipped as larger than 200000 bytes

#### Scenario: Image file
- **WHEN** a changed file is a PNG image
- **THEN** it is skipped as binary

### Requirement: Ranking
RepoScout SHALL rank eligible files into tiers: files matching `focus_paths` first, then source files, then configuration files, then test source files, then everything else including non-source test files; in incremental mode it SHALL order by tier, then by lines added and deleted descending, then by least recently audited, then by path.

#### Scenario: Focus path first
- **WHEN** an incremental run has more eligible files than the cap and `focus_paths` matches `src/auth/login.ts`
- **THEN** `src/auth/login.ts` is selected before other source files

#### Scenario: Tests last
- **WHEN** the eligible files are `src/a.ts` and `test/a.test.ts`
- **THEN** `src/a.ts` ranks before `test/a.test.ts`

### Requirement: File caps
RepoScout SHALL cap the selected files at `--max-files` when given, otherwise at `max_files_full_run` in full mode when set, otherwise at `max_files_per_run` (default 40), and SHALL refuse any cap that is not an integer from 1 to 150.

#### Scenario: Cap above the ceiling
- **WHEN** the user runs `run --max-files 200`
- **THEN** the CLI refuses the flag explaining it must be an integer from 1 to 150

#### Scenario: Omitted files logged
- **WHEN** more files are eligible than the cap
- **THEN** the files beyond the cap are left out and a warning logs how many were omitted

### Requirement: Full-mode rotation
In full mode RepoScout SHALL order eligible files by the oldest audit time across the selected analyzers, files never audited by one of them first, using the ranking only as a tie-break, so successive capped full runs rotate through the whole repository.

#### Scenario: Focus paths do not monopolise the cap
- **WHEN** focus paths alone fill the cap and were audited last week, while other files were never audited
- **THEN** the next full run selects the never-audited files first

#### Scenario: Subset rotation
- **WHEN** a full run with `--analyzers logic` follows runs with only `security`
- **THEN** files `logic` has never audited are selected first, whatever `security` audited

### Requirement: Sweep selection
During a sweep RepoScout SHALL select only eligible files whose oldest audit time across the selected analyzers is earlier than the sweep's start, or `--sweep-since`, and SHALL report the sweep complete when none are left.

#### Scenario: Sweep exhausted
- **WHEN** every eligible file was audited by the selected analyzers after the sweep began
- **THEN** no file is selected and the sweep stops as complete

### Requirement: Census of eligible files
On every full run, including a prepare-only one, RepoScout SHALL record the number of eligible files at the head for the repository, and a completed full run SHALL drop audit times of files no longer eligible.

#### Scenario: Prepare-only sizing
- **WHEN** `run --mode full --prepare-only` runs on a repository
- **THEN** the database records its count of eligible files and head, with no audit started

### Requirement: Read coverage per analyzer
After an audit RepoScout SHALL stamp a selected file as audited for an analyzer only when that analyzer's specialists opened it inside the clone; files opened only by the verifier or the orchestrator MUST NOT count, except in speculative mode where a file the verifier opened counts as read.

#### Scenario: File sent to two analyzers, read by one
- **WHEN** `src/a.ts` is selected for `security` and `logic` and only the `logic` specialist opens it
- **THEN** `src/a.ts` is stamped audited for `logic` only

### Requirement: Unread files retried once
RepoScout SHALL queue a selected file that an analyzer's specialists did not open for that analyzer's next run, and SHALL stamp it as audited anyway if it is selected and left unread a second time; an analyzer that did not run keeps its queue.

#### Scenario: Unread twice
- **WHEN** `src/big.ts` was left unread by `security` last run and is again not opened by `security`
- **THEN** it is stamped as audited for `security`

### Requirement: Read coverage in the report
Each report SHALL include `read_coverage` with the number of selected files, the number read by at least one specialist, the unread paths and, outside speculative mode, `by_analyzer` counts, and RepoScout SHALL log a warning listing up to 15 unread files.

#### Scenario: Partial read
- **WHEN** 10 files were selected and specialists opened 8
- **THEN** the report's `read_coverage` shows 10 selected, 8 read and the 2 unread paths
