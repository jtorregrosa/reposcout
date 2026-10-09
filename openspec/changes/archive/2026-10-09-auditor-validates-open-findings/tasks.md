## 1. Decision model

- [x] 1.1 Append a migration to `src/store/schema.ts` that adds `decided_on` to `triage` with the default `speculative` and a check on `speculative` and `open`, and add `decided_on` to `Decision` in `src/state/types.ts` and `src/dashboard/api.ts`
- [x] 1.2 Make `applyDecision` in `src/store/store.ts` branch on `decided_on`: a refutation made on `open` applies to an entry written as `open` or `speculative`, and a decision made on `speculative` behaves as today
- [x] 1.3 Extend `nextStage` in `src/findings/stage.ts` so an auditor's confirmation moves an entry that was already `open` from `detected` to `validated`, and check that `withdrawnStage` covers a confirmation made on `open`
- [x] 1.4 Add cases to `test/stage.test.ts` for the confirmation of an open finding, its withdrawal, and its withdrawal after a reproduction

## 2. Store actions

- [x] 2.1 Rework `decide` to accept `open` findings, record `decided_on`, and refuse with the kinds `not-found`, `not-decidable`, `already-decided` and `already-validated`. A refutation on `open` writes an `open`→`refuted` event; a confirmation on `open` writes only its stage event
- [x] 2.2 Rework `undecide` to return a moved finding to `decided_on`: a refutation made on `open` restores `open` and clears the resolution, and a confirmation made on `open` changes only the stage
- [x] 2.3 Map the new `DecisionError` kinds in `DECISION_STATUS` in `src/dashboard/actions.ts`
- [x] 2.4 Extend `test/triage.test.ts` with:
  - confirming and refuting an open finding, with their status, stage and history entries;
  - undoing each one;
  - each refusal and its HTTP status;
  - a run that rewrites the state after a refutation made on `open`;
  - the upgrade of a database whose decisions predate `decided_on`

## 3. Runs

- [x] 3.1 Add `refutedByAuditor` to `classify` in `src/findings/classify.ts`: a confirmed finding or speculative candidate with such a fingerprint stays `refuted` in `nextState`, is left out of `reported`, `confirmed` and `speculativeNew`, and is never counted as a miss
- [x] 3.2 Build the set in `src/audit/repo.ts` from the repository's refutations made on `open`, and pass it to both `classify` calls
- [x] 3.3 Add `test/findings.test.ts` cases: an auditor-refuted fingerprint reported again as confirmed, reported again with `verified: true`, and raised as speculative; a speculative-made refutation followed by a confirmation still opens the finding
- [x] 3.4 Add an end-to-end test in `test/e2e/run.test.ts` with the fake `claude`: refute an open finding through the store, run again with the verifier confirming it, and check that the state, `reports/<date>/<repo>.json` and `summary.md` leave it out as `new`, and that the next manifest lists it in `known_false_positives` with `dismissed_as` `refuted`

## 4. Export

- [x] 4.1 Select `decided_on` in `snapshot()`, write it with `restoreDecision`, and default a missing `decided_on` to `speculative` when `src/store/backup.ts` parses `decisions.json`
- [x] 4.2 Extend `test/backup.test.ts`: the round trip keeps a refutation made on `open`, and an export whose decisions have no `decided_on` restores them as made on `speculative`

## 5. Dashboard

- [x] 5.1 Show Confirm and Refute in `web/src/features/findings/finding-detail.tsx` by status, stage and existing decision as design.md lists, and pass the status to the dialog
- [x] 5.2 Word `decide-dialog.tsx` for a candidate or a finding according to the status
- [x] 5.3 Cover the decide endpoint for an open finding, and its 409 refusals, in `test/actions.test.ts` or `test/dashboard.test.ts`
- [x] 5.4 Open the dashboard against a database with an open `detected` finding, confirm it, refute another, undo both, and check the stage timeline, the Refuted tab and the decision block

## 6. Documentation and verification

- [x] 6.1 Update README.md: triage in the dashboard covers open findings, a refuted open finding stays refuted and out of reports until undone or its line changes, and precision now counts auditor refutations of open findings
- [x] 6.2 Run `openspec validate auditor-validates-open-findings --strict`
- [x] 6.3 Run `pnpm verify` and fix anything it reports
