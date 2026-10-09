# finding-intake Specification

## Purpose
Finding intake is what the CLI does with the raw findings file an audit session writes before anything reaches the state or a report: validating each candidate, checking its line against the code it quotes, demoting confirmed findings whose quote does not exist, computing the line-anchored fingerprint, resolving fingerprint collisions, and redacting secrets. Statuses, resolution and history of the accepted findings belong to finding-lifecycle, and producing the raw file belongs to detection.

## Requirements

### Requirement: Validation of each candidate
The CLI SHALL validate every entry of `findings` and `speculative` and reject it unless it is an object with a `file` among this run's selected files, an integer `line` of at least 1, a `category` among the five analyzers, a `severity` of critical, high, medium or low, a `confidence` of high, medium or low, a boolean `verified`, and `title`, `description`, `scenario` and `suggested_fix` of at least 10 characters after trimming.

#### Scenario: Missing scenario
- **WHEN** a finding has no `scenario`, or one shorter than 10 characters
- **THEN** it is rejected with the reason `missing evidence field "scenario"`

#### Scenario: File not audited
- **WHEN** a finding names a file that was not in the run's selected files
- **THEN** it is rejected with the reason that the file was not in the audited set

#### Scenario: Unknown severity
- **WHEN** a finding's `severity` is `blocker`
- **THEN** it is rejected with the reason `invalid severity "blocker"`

### Requirement: Line beyond the end of the file
The CLI SHALL reject a candidate whose `line` is greater than the number of lines in its file at the audited commit.

#### Scenario: Line past the end
- **WHEN** a finding points at line 120 of a 90-line file
- **THEN** it is rejected with the reason `line 120 beyond end of file (90)`

### Requirement: Rejected candidates are counted, not stored
A rejected candidate MUST NOT reach the state, and the CLI SHALL log it as a warning and list it in the report's `rejected` with whether it was a finding or a speculative candidate, its redacted title, its file and the reason.

#### Scenario: Report lists rejections
- **WHEN** two candidates fail validation in a run
- **THEN** the report's `rejected` holds two entries with their reasons and neither appears among the findings

### Requirement: Speculative candidates are never verified
The CLI SHALL treat every entry of `speculative` as `verified: false`, and give it `confidence` `low` when it has none, before validating it.

#### Scenario: Speculative entry without confidence
- **WHEN** a speculative candidate has no `confidence` and claims `verified: true`
- **THEN** it is validated and stored with `confidence` low and `verified` false

### Requirement: Line relocation to the quoted code
The CLI SHALL look for the quoted code, taken as the first line of `snippet` with at least 8 non-whitespace characters, ignoring a copied line-number prefix and keeping the longest piece around an ellipsis, compared without whitespace, and when it is within 5 lines of the reported line MUST move `line` to the nearest occurrence.

#### Scenario: Quote three lines below
- **WHEN** a finding reports line 40 and its quoted code is on line 43
- **THEN** the finding is stored at line 43, with that line's fingerprint, and the move is logged

#### Scenario: Quote far from the line
- **WHEN** the quoted code occurs in the file but more than 5 lines from the reported line
- **THEN** the reported line is kept and the stored snippet is that line's own text

#### Scenario: No usable quote
- **WHEN** the snippet is missing or has no line of at least 8 non-whitespace characters
- **THEN** the reported line is kept without a check

### Requirement: Demotion when the quote is not in the file
When a confirmed finding's quoted code occurs nowhere in the file, the CLI SHALL keep it only as a speculative candidate with `verified: false` and `unconfirmed` set to "the quoted code was not found in the file", and MUST NOT store it as open.

#### Scenario: Invented code
- **WHEN** a finding in `findings` quotes code that does not exist in its file
- **THEN** it is stored as speculative with `unconfirmed` "the quoted code was not found in the file"
- **AND** a warning is logged

#### Scenario: Speculative candidate with a missing quote
- **WHEN** a speculative candidate's quote occurs nowhere in the file
- **THEN** it stays speculative and "Also, the quoted code was not found in the file." is appended to its own `unconfirmed`

### Requirement: Stored snippet
The CLI SHALL store as `snippet` the model's quote, whitespace-collapsed, when the quote is near the line or unchecked and occurs in the file with at least 8 characters, and otherwise the normalised text of the anchored source line.

#### Scenario: Quote occurs in the file
- **WHEN** a finding's quote is on its line
- **THEN** the stored snippet is the quote with whitespace collapsed

#### Scenario: Quote not in the file
- **WHEN** the quote does not occur in the file
- **THEN** the stored snippet is the anchored source line

### Requirement: Fingerprint definition
The CLI SHALL compute a finding's `fingerprint` as the first 32 hex characters of SHA-256 over the repository name, the file path with forward slashes, the category and the anchored source text, joined by newlines; the anchored text is the finding's line in the audited file with whitespace runs collapsed and trimmed, widened to the line before and after it when it is shorter than 8 characters.

#### Scenario: Unrelated edit above
- **WHEN** lines are inserted above a finding's line and its own text is unchanged
- **THEN** the finding keeps the same fingerprint

#### Scenario: Whitespace change
- **WHEN** only the indentation or spacing of the anchored line changes
- **THEN** the fingerprint is unchanged

#### Scenario: Trivial line
- **WHEN** a finding points at a line holding only a closing brace
- **THEN** the fingerprint is computed over that line and its two neighbours

#### Scenario: Different category
- **WHEN** two findings point at the same line in different categories
- **THEN** they get different fingerprints

### Requirement: Fingerprint independent of the model's quote
The fingerprint MUST depend only on the source text at the finding's line, never on how the model quoted the code, so the same defect quoted two ways gets one fingerprint.

#### Scenario: Two quotes of one bug
- **WHEN** two runs report the same line with differently worded snippets
- **THEN** both get the same fingerprint

### Requirement: Fingerprint version
The CLI SHALL record the fingerprint version, currently 2, with each repository's state, and when it opens state written under an older version it MUST recompute every fingerprint whose file and line still exist, merge entries that now collide, and log any `suppressed` fingerprint in `repos.yaml` that changed with its new value.

#### Scenario: Version 1 duplicates
- **WHEN** a repository's state holds two version 1 findings that anchor to the same line and category
- **THEN** the next run merges them into one entry under the version 2 fingerprint

#### Scenario: Suppression changed
- **WHEN** a suppressed fingerprint is remapped by the migration
- **THEN** a warning names the old and new fingerprint so `repos.yaml` can be updated

### Requirement: Fingerprint collisions keep the first
When two accepted candidates of one run get the same fingerprint, the CLI SHALL keep the first and drop the other, logging a warning with both titles and lines when their titles differ; a confirmed finding MUST win over a speculative candidate with the same fingerprint, and a demoted finding over a speculative one.

#### Scenario: Two distinct bugs on one line
- **WHEN** the verifier reports two findings with different titles that anchor to the same line in the same category
- **THEN** only the first is kept and a warning about the shared fingerprint is logged

#### Scenario: Same finding twice
- **WHEN** the same finding is reported twice with the same title
- **THEN** one is kept and no collision warning is logged

#### Scenario: Confirmed and speculative on one line
- **WHEN** a finding and a speculative candidate share a fingerprint
- **THEN** the finding is kept and the speculative candidate dropped

### Requirement: Reproduction steps and labels are optional
The CLI SHALL keep `repro` only when it has at least one step, cutting it to 12 steps and 8 preconditions and each text to 800 characters, and keep `kind` only when it is `bug`, `vulnerability` or `chore` and `personal_data` only when it is a boolean; a malformed or unknown value MUST be dropped without rejecting the finding.

#### Scenario: Malformed repro
- **WHEN** a finding's `repro` has no steps
- **THEN** the finding is kept without `repro` and a warning is logged

#### Scenario: Unknown kind
- **WHEN** a finding's `kind` is `defect`
- **THEN** the finding is kept without a `kind`, to be labelled later

### Requirement: Redaction of every finding
The CLI SHALL redact every text field of every accepted finding and speculative candidate, and every rejected title, replacing each value from `.env` of 8 characters or longer (whatever its name), the configured PAT and Claude OAuth token, and every match of the known secret patterns with a `[REDACTED]` marker.

#### Scenario: Value from .env quoted
- **WHEN** a finding's snippet contains a 20-character value that appears in `.env`
- **THEN** the stored finding shows `[REDACTED]` in its place

#### Scenario: Short .env value
- **WHEN** a value in `.env` is shorter than 8 characters
- **THEN** it is not redacted by value

### Requirement: Known secret patterns
The redaction SHALL cover private key blocks, JWTs, AWS access key ids, GitHub classic and fine-grained tokens, GitLab, npm, Stripe, Slack, OpenAI-style `sk-` and Google API and OAuth tokens, Azure DevOps PATs in the 52-character and 84-character formats, `Authorization` Basic and Bearer values, credentials in URLs, connection-string keys such as `AccountKey` and `Password`, and values of `password`, `secret`, `token`, `api_key` and `*PAT`-style assignments, while leaving git SHAs and 32-hex fingerprints intact.

#### Scenario: Token assignment in code
- **WHEN** a snippet holds `apiKey = "abcdef123456"`
- **THEN** the stored snippet keeps the key name and replaces the value with `[REDACTED]`

#### Scenario: Fingerprint and SHA untouched
- **WHEN** a finding's text contains a 40-hex commit SHA or a 32-hex fingerprint
- **THEN** they are not redacted

#### Scenario: Credentials in a URL
- **WHEN** a description contains `https://user:secret@host/path`
- **THEN** it is stored as `https://[REDACTED]@host/path`
