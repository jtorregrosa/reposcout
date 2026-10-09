## 1. Attempts in the database

- [x] 1.1 Append a migration to `src/store/schema.ts` that creates `validation_attempts` as design.md gives it, and add a `ValidationAttempt` type to `src/state/types.ts` and `src/dashboard/api.ts`
- [x] 1.2 Add `attemptsFor(repo)` and `recordAttempts(repo, attempts)` to `src/store/store.ts`, and check that `writeRepoState` leaves the table untouched
- [x] 1.3 Export the table as `validation-attempts.json` from `snapshot()` and `src/store/backup.ts`, and restore it, treating a missing file as no attempts
- [x] 1.4 Extend `test/backup.test.ts`: a round trip keeps two attempts, and an export without the file restores with none; add a store test that a state rewrite keeps the attempts

## 2. Mode, flags and budget

- [x] 2.1 Add `validate` to `MODES` in `src/config/analyzers.ts`, and update the `--mode` help in `src/cli.ts`
- [x] 2.2 In `src/commands/run.ts`:
  - accept `--session-limit` and `--weekly-limit` with `--mode validate`;
  - refuse `--analyzers` and `--until-covered` with it;
  - pass the limits to the run as validation options.
- [x] 2.3 In `runLocked` (`src/audit/run.ts`), in validate mode:
  - skip a repository whose `verificationFor` gives no test command, with `verification off: …`, before `auditRepo`;
  - apply `budgetDecision` before each other repository, with the previous validation session's `window_cost`, setting `budgetHit` when it refuses.
- [x] 2.4 Add flag tests for the new combinations and refusals, and unit tests for the skip and the budget stop, including exit code 5

## 3. Picking and applying

- [x] 3.1 In `planAudit`, build `validationCandidates` as design.md orders and filters them, with `--max-files` or 10 as the cap, from the stored state, the stages, the decisions, `repo.suppressed` and the attempts
- [x] 3.2 Add `src/findings/validation.ts`, a pure function from the previous state, the candidates and `validation_review` to the next state, the attempts and the report's `validation` block. It ignores unknown fingerprints, duplicate verdicts and unknown verdicts
- [x] 3.3 Unit-test the picking: order, cap, and each exclusion (decision, pending suppression, two attempts, gone file, stage past `detected`)
- [x] 3.4 Unit-test the applying:
  - a reproduction changes only `verified` and `reproduction`;
  - `not_reproduced` and `not_testable` change nothing in the state;
  - no verdict records no attempt.

## 4. Session and prompts

- [x] 4.1 Add `validation_candidates`, with the reasons of earlier attempts, to `buildManifest` in `src/audit/manifest.ts`, with empty `analyzers`, `known_findings` and `known_false_positives` in validate mode
- [x] 4.2 Add the `validate` branch to `.claude/skills/audit/SKILL.md`, and `validation_review` to its output shape
- [x] 4.3 Add "Steps for a validation" to `.claude/agents/verifier.md`, and `validation_review` to its return shape
- [x] 4.4 In `auditRepo`, in validate mode:
  - skip with `no findings to validate` when there are no candidates;
  - after the session, apply the verdicts, then write the report, the state and the attempts in one transaction;
  - leave the commits, file audit times and `last_run_at` as they were;
  - return the outcome counts.
- [x] 4.5 Add `validation` to `RepoReport` in `src/report/types.ts`, and a validation line with the reproduced findings to `src/report/summary.ts`

## 5. Dashboard

- [x] 5.1 Accept `validate` in `startRun` (`src/dashboard/actions.ts`): refuse analyzers with it, refuse a selection with no repository whose verification is on, and pass `--session-limit`
- [x] 5.2 Add `counts.detected` to the repository summary, and serve `GET /api/findings/<repo>/<fingerprint>/validations` in `src/dashboard/server.ts`
- [x] 5.3 Add Validate to `start-audit-dialog.tsx`: the cap labelled "Findings per repository" with the placeholder 10, analyzers hidden, and repositories with verification off disabled with their reason
- [x] 5.4 Add Validate detected findings to `repository-page.tsx`, with a confirmation that says how many findings it would try, disabled while a run is active
- [x] 5.5 List the validation attempts in `finding-detail.tsx`, saying when validation passes no longer try the finding
- [x] 5.6 Show tried, reproduced, not reproduced and not testable in `outcomeFacts` in `run-panels.tsx`
- [x] 5.7 Test `startRun` for validate, including its 400 refusals, and the attempts endpoint, in `test/actions.test.ts` or `test/dashboard.test.ts`

## 6. End to end

- [x] 6.1 Add a validate-mode reply to the fake `claude`
- [x] 6.2 Add an end-to-end test in `test/e2e/run.test.ts`. Audit a repository so that it holds three open findings at `detected`, then run `--mode validate` with the fake answering `reproduced`, `not_reproduced` and `not_testable`. Check:
  - the reproduced finding is `validated` with the source `reproduced`, and its text is unchanged;
  - the other two are still `detected` with their confidence unchanged, and have one attempt each;
  - the last audited commits and the file audit times are unchanged;
  - `reports/<date>/<repo>.json` has the `validation` block;
  - `summary.md` has the validation line;
  - a usage row with the mode `validate` exists;
  - no webhook was sent.
- [x] 6.3 Add an end-to-end test where a second unsuccessful pass makes a finding ineligible, so the third pass skips the repository with `no findings to validate`
- [x] 6.4 Add an end-to-end test on a repository without `test_command`: it is skipped with `verification off:`, no session starts, and the exit code is 0
- [x] 6.5 Open the dashboard against a copy of the database:
  - start Validate from New audit and from the Repository page;
  - follow the run on the Runs page;
  - check the attempts and the stage timeline on the finding detail;
  - check the `validate` row on the Usage page.

## 7. Documentation and verification

- [x] 7.1 Update README.md:
  - the modes section gains `--mode validate`: what it picks, the cap, the two-attempt limit, and the budget flags;
  - the verification section says the mode skips repositories with verification off;
  - the security model notes that the unsandboxed opt-in is exercised on every validation pass;
  - the dashboard section gains Validate and the attempts;
  - the usage section says validation runs count in the totals.
- [x] 7.2 Run `openspec validate auto-validate-detected-findings --strict`
- [x] 7.3 Run `pnpm verify` and fix anything it reports
