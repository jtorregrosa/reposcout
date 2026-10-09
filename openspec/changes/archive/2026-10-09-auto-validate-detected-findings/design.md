## Context

See proposal.md for why. These facts about the current code shape the approach:

- **Speculative mode is the model.** It goes through the same `auditRepo` path as an audit:
  - `planAudit` picks its candidates from the stored state: the file still exists, most severe first, then oldest, capped by `--max-files` or 30.
  - `buildManifest` adds them as `speculative_candidates` and empties `analyzers`, `known_findings` and `known_false_positives`.
  - The skill skips the specialists and launches the verifier once.
  - `classify` runs with `auditedFiles: []`, so nothing is resolved or missed.
  - The next state is the previous one with new findings, and only `last_speculative_review_at` set. Commits and file audit times stay as they were.
- **Reproduction already exists.** `verificationFor(repo)` decides whether the test command is usable:
  - It returns `null` without a `test_command`.
  - It returns `null` on native Windows without `test_command_unsandboxed`.
  - It returns the command with a warning on native Windows with that opt-in.

  `runAuditSession` adds `workspace/.verify/<repo>` as a worktree of the head and removes it in a `finally`. `buildSettings` allows Bash for that exact command only, and sandboxes it on macOS and Linux.
- **The stage moves by itself.** `writeRepoState` calls `nextStage`, which moves an `open` entry from `detected` to `validated` with the source `reproduced` when `finding.verified` is true. So a validation pass only has to store the finding with `verified: true`.
- **Budget checks run only in sweeps and backfills.** Both use `budgetDecision`, the latest reading from `latestRateLimit`, and `passCost` for the measured cost. A speculative review starts its session with no check.
- **Records that outlive the rewritten state live in their own tables**: `triage` for decisions, `finding_stages` and `finding_stage_events` for stages, `labels` for label corrections. `writeRepoState` deletes and rewrites `findings` on every run.

## Goals / Non-Goals

**Goals:**
- One mode that turns reproducible `detected` findings into `validated` without anyone opening the dashboard, at a bounded subscription cost.
- No new security rule: the pass uses the worktree, the exact test command and the sandbox exactly as an audit does.
- A finding the pass cannot reproduce is left as the auditor and the audit last saw it.

**Non-Goals:**
- No retrying of speculative candidates. The speculative review settles those.
- No validation of `validated` findings that an auditor confirmed. Reproducing them would only change the source of the stage, and the auditor already vouched for them.
- No scheduling. Task Scheduler or a by-hand run starts the pass, as for every other mode.
- No Findings filter for "attempted and not reproduced". The finding detail shows the attempts. A filter can follow if triage asks for it.
- No change to how an audit's verifier reproduces or grades.

## Decisions

### A run mode, not a separate command
`validate` joins `MODES` and goes through `runAudits` and `auditRepo`, like `speculative`. That way it gets, unchanged:
- the lock;
- cancellation;
- the usage-limit deferral;
- the event log the Runs page replays;
- the usage row;
- the report and `summary.md`.

Alternative considered: a `reposcout validate` command on the backfill runner, which already batches findings across repositories under a budget. It was rejected because the backfill runner:
- sends findings to a plain Claude prompt, without the verifier, the manifest, the verification worktree or the sandboxed settings;
- would have to rebuild the clone fetch and the fingerprint migration that `auditRepo` already does.

### Which findings, in which order, how many
`planAudit` builds `validationCandidates` from the stored state for a repository. A finding is taken when:
- its status is `open`;
- its stage is `detected`;
- its file exists in the clone at the head;
- it has no decision in `triage`;
- its fingerprint is not in `repo.suppressed`;
- it has fewer than two attempts whose outcome is not `reproduced`.

The order is fewer attempts first, then `SEVERITY_RANK`, then `first_seen`. The cap is `--max-files`, or 10.

- **Fewer attempts first:** a capped pass spreads its budget so that every finding gets a first try before any finding gets a second one. Severity orders findings within each round.
- **10 rather than speculative's 30:** each candidate costs a test written and the whole `test_command` run, often minutes for a .NET or Node suite. All of them must fit in one `claude.timeout_minutes` (default 45). A timeout throws away the whole session: no attempt is recorded, and no reproduction is kept.
- **Excluded when any auditor decision exists:**
  - A refutation leaves the finding `refuted`, so it is not `open`.
  - A confirmation of an open finding moves it to `validated`, so it is not `detected`.

  The decision check is therefore redundant today. It stays as an explicit guard, so that a future decision kind cannot make the pass re-litigate a person's call.
- **A withdrawn confirmation makes the finding eligible again**, because nobody vouches for it any more.
- **Pending suppressions are excluded** because the dashboard already shows them as suppressed, and `classify` would suppress the finding on the next audit anyway.
- **Two attempts, then stop:** a test that could not exercise the path twice is unlikely to manage a third time. A fingerprint is anchored to its line, so a code change around the finding gives it a new fingerprint with no attempts, and the pass picks it up again.

### What the verifier answers
The manifest gains `validation_candidates`. Each entry has the speculative candidate fields without `unconfirmed`, plus `previous_attempts`, which lists the reasons of earlier tries. The skill gains a `validate` branch beside `speculative`: it launches the verifier once with the candidates and the verification block, and writes `findings: []` and `validation_review`.

The verifier gains a "Steps for a validation" section:
- write one test per candidate, in the worktree only;
- run the exact command;
- answer `reproduced` with the test and output, `not_reproduced`, or `not_testable`, each with a reason;
- never confirm, refute, re-grade or add findings.

The verifier answers only in `validation_review`, never with a full finding in `findings`. This keeps the CLI's update narrow: it sets `verified` and `reproduction` on the stored finding and leaves everything else as the audit and any auditor label override left it. A full finding would let a validation pass silently rewrite severity, text or labels.

### What a non-reproduction does
Three options were considered:
- **Leave it at `detected` and record the attempt.** Chosen.
- **Lower its confidence.** Rejected. Confidence is the verifier's grade from tracing the code. A sandboxed test with no network or database fails to exercise many real paths, so its silence is weak evidence. Lowering confidence on every pass would wear down findings that the code shows clearly. It would also move the Findings confidence filter without anyone looking at the finding. The audit rule "a failed reproduction lowers confidence" stays as it is for audits, where the verifier grades a finding it has just traced.
- **Add a "needs review" status or stage.** Rejected. It would be a new lifecycle state for something an auditor already has a tool for: Confirm and Refute on open `detected` findings since #4. The attempts, with their reasons, are the input the auditor needs, and they show on the finding detail.

`not_reproduced` and `not_testable` are kept apart because they mean different things to a person. "The test ran and the bug did not show" leans towards refuting. "The test could not reach the code" says nothing about the bug. Both count towards the two-attempt limit.

### Applying the verdicts
A new pure function in `src/findings/validation.ts` takes the previous `FindingsState`, the candidates and `validation_review`, and returns:
- the next state: the previous state with only the reproduced entries changed;
- the attempts to record, one per answered candidate;
- the report's `validation` block.

The function drops a verdict for a fingerprint that was not a candidate. It ignores a second verdict for the same fingerprint. It treats an unknown verdict as no verdict.

`classify` is not called. A validation pass must not resolve anything, count misses or refresh `last_seen`. Bypassing `classify` makes that true by construction, rather than by feeding it empty inputs and relying on every branch to do nothing.

`auditRepo` writes `{ ...previous, fingerprint_version, findings: nextState }`, leaving:
- `last_commit`, `last_commit_by_analyzer`, `last_run_at` and `last_full_run_at` as they were;
- `file_audits_by_analyzer` and `unread_once_by_analyzer` as they were.

`writeRepoState` then applies the decisions, the labels and `nextStage` as for any run. An auditor's refutation made during the pass therefore still wins over a reproduction, as #4 decided.

### Verification off: skip before cloning
`runLocked` asks `verificationFor(repo)` before calling `auditRepo` in `validate` mode. When it gives no test command, the repository is `skipped` with `verification off: <warning or "no test_command configured">`, and the run neither fetches nor starts a session. This gives the native Windows behaviour the request asked about:
- Without the opt-in, the pass does nothing and costs nothing for that repository. A validation pass whose verifier cannot run tests could only spend tokens reading code, which the audit already did.
- With `test_command_unsandboxed: true`, it runs, and the existing warning is logged and shown on the Runs page.

A skip is not a failure. A run where every repository is skipped exits 0, and the log names why each was skipped.

### Budget check before each session
In `validate` mode `runLocked` calls `budgetDecision` before each repository, with:
- `rateLimit` from `latestRateLimit(store.usage(50))`, as the sweep reads it;
- `lastCost`: the `window_cost` of the previous validation session in this run, or none;
- the `--session-limit` and `--weekly-limit` the run was given (default 90 and 95).

When the decision refuses, it sets `budgetHit`, which already defers the remaining repositories and leads to exit code 5. Speculative mode has no such check. It was kept out of the validation pass for three reasons:
- A validation pass is optional background work, typically scheduled.
- It costs more per session than a speculative review.
- The flags and the decision already exist, so the check costs nothing to reuse.

### Database
One migration adds:

```sql
CREATE TABLE validation_attempts (
  repo TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  at TEXT NOT NULL,
  run_id TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('reproduced', 'not_reproduced', 'not_testable')),
  reason TEXT,
  PRIMARY KEY (repo, fingerprint, run_id)
);
```

- `writeRepoState` leaves the table alone, so attempts outlive state rewrites as stages do.
- `Store` gains `attemptsFor(repo)` (fingerprint to attempts) and `recordAttempts(repo, attempts)`.
- An older database upgrades with an empty table. Nothing has been attempted, which is true.
- `repos` gets no new column. The report and the usage row already date the pass, so a `last_validation_at` would only duplicate them.

### Export and restore
`snapshot()` selects the table, and `db export` writes it as `validation-attempts.json`. The restore reads the file when it exists and treats a missing file as an empty list, so exports from before this change still restore. The format stays `reposcout/export@1`, because the change only adds an optional file.

### Launching from the dashboard
- `startRun` accepts `mode: 'validate'`. It refuses `analyzers` with it, and refuses when none of the selected repositories (or none of all of them) has `verificationState(repo) === 'on'`. It passes `--session-limit` with validate as it does for a sweep.
- `StartAuditDialog` adds Validate to the mode radio group, labels the cap "Findings per repository" with the placeholder `10`, and hides the analyzers. Repositories with verification off are shown disabled, with "no test_command" or "no sandbox" beside them.
- `RepositoryPage` adds Validate detected findings to the header actions. The button is shown when `repo.verification === 'on'` and `repo.counts.to_validate > 0`. It is disabled while a run is active, and asks for confirmation through an `AlertDialog` that says how many findings a pass would try (`min(eligible, 10)`). `FindingCounts` gains `to_validate`: open findings at `detected` with no decision and fewer than two unsuccessful attempts, which is what a pass would pick before its cap.
- The finding detail loads the attempts from a new read-only `GET /api/findings/<repo>/<fingerprint>/validations`, next to the existing `/stages` route and behind the same guards. Attempts are only needed for the selected finding, so the findings list does not carry them.

### Runs page and events
- The `files_selected` event already carries `mode`, and `selected` is the number of findings in validate mode.
- A validated repository's `repo_finished` outcome is `{ status: 'ok', tried, reproduced, not_reproduced, not_testable, unreviewed }`, so `outcomeFacts` in `run-panels.tsx` renders them.
- The stage label stays `auditing`. The mode shown beside it says what kind of session it is.

## Partial state and migration

- A validation pass writes in one transaction, after the session succeeds:
  - the report;
  - the repository state with the reproduced findings;
  - their stage changes, through `writeRepoState`;
  - every attempt.

  A pass that fails, times out, hits the usage limit or is cancelled writes none of them. No attempt is counted for a session whose answers were lost, so a timeout never burns a finding's two tries.
- The verification worktree is removed in the existing `finally` of `runAuditSession`, whatever the outcome.
- The usage row is still recorded for a failed session, as for every mode, because the subscription was spent.
- The migration creates an empty table in the migration transaction. Older databases need no data change.

## Risks / Trade-offs

- **A test passes for the wrong reason** and a non-bug is marked reproduced. The verifier must show the failure the scenario describes, and the test and output are stored in `reproduction`, visible on the finding. An auditor who disagrees refutes it, which wins over the reproduction on every later run.
- **Unsandboxed tests on Windows run on every pass.** The opt-in is per repository and already warned about. The README's security model section gains a sentence: a validation pass is where that opt-in is exercised most.
- **Validation sessions raise cost per finding**, because they cost money and find nothing new. Speculative reviews already do this. The README's usage section says that validation runs count in the totals, and the Usage page shows them with their own mode so they can be filtered by eye.
- **The prompt version changes for audits too,** because the skill and the verifier gain a section. Precision is split by prompt version, so rows after this change start a new column, although audit behaviour is unchanged. This is accepted rather than splitting the prompts into a separate file just for this mode.
- **A repository whose test suite takes longer than the timeout** fails every validation pass. Lower `--max-files` for that repository, or raise `claude.timeout_minutes` in `repos.yaml`. The failure message names the timeout as today.
