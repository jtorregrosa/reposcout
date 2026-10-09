## Context

See proposal.md for why. These facts about the current code shape the approach:

- **Decisions live in `triage`** and outlive a run's rewrite of `findings`. `writeRepoState` re-applies them through `applyDecision`, which acts only on an entry the run wrote as `speculative`.
- **`decide` refuses anything but `speculative`** (`DecisionError` kind `not-speculative`, HTTP 409), and `undecide` always returns a moved finding to `speculative`.
- **Classification runs before the store sees decisions.** `classify` builds `reported`, the summary counts and what notifications send from the previous state and the run's output. A confirmed finding whose previous status is `refuted` is written as `open` and reported as `new`. Only a speculative report of a refuted fingerprint is skipped. Re-applying a decision in `writeRepoState` alone would fix the state but still report and notify the finding.
- **Precision already counts every `refuted` status as dismissed** (`src/dashboard/metrics.ts`). Only the spec's wording, "refuted after being speculative", changes.
- **`knownFalsePositives` already lists every `refuted` entry** of the selected analyzers, with its resolution as reason. Only the spec's wording changes.
- **Stage transitions** come from the pure functions in `src/findings/stage.ts`: `nextStage` and `withdrawnStage`.

## Goals / Non-Goals

**Goals:**
- One decision model for speculative and open findings: same table, same dialog, same undo.
- A refutation of an open finding sticks across runs and keeps the finding out of reports and notifications, as a suppression does.
- No change to the audit session, the manifest's shape, or the subscription spend.

**Non-Goals:**
- No automated validation pass, such as a run mode that retries reproduction for `detected` findings. That is a later validate-stage change.
- No decisions on `suppressed`, `resolved`, `refuted` or `duplicate` findings.
- No bulk decisions. Each finding is decided on its own, with its own reason.
- No change to suppression. It stays the way to accept a real finding as won't-fix.

## Decisions

### Record the decided-on status in `triage`
A new migration adds `decided_on TEXT NOT NULL DEFAULT 'speculative' CHECK (decided_on IN ('speculative', 'open'))` to `triage`. The default keeps every existing decision behaving as it does today. `Decision` in `src/state/types.ts` and in `src/dashboard/api.ts` gains `decided_on`.

Alternative considered: infer the subject from the status history, using the status just before the decision's event. It needs no schema change, but it breaks for a decision restored from an export, and it turns every state write into a history lookup per decided fingerprint.

### `applyDecision` branches on `decided_on`
- `speculative`: unchanged. It applies only to an entry written as `speculative`.
- `open`, refuted: it applies to an entry written as `open` or `speculative`. The entry becomes `refuted` with `refuted_at` set to the decision time and the auditor's resolution.
- `open`, confirmed: the status needs nothing, because a confirmed open finding is open. `confirmedByAuditor` is true for it, so a fingerprint that leaves the state and comes back gets `validated` as its initial stage, as it does today for a confirmed candidate.

### Keep auditor-refuted fingerprints out of classification
`classify` gains an input `refutedByAuditor: ReadonlySet<string>`. `src/audit/repo.ts` builds it from `store.decisionsFor(repo)`, taking the refutations made on `open`. In `classify`, a confirmed finding or a speculative candidate whose fingerprint is in the set:
- is left out of `reported`, `confirmed` and `speculativeNew`;
- keeps its previous entry in `nextState`, with `last_seen` refreshed;
- is not counted as a miss.

This mirrors how `suppressed` is threaded through today, and keeps the report and the notifications consistent with the state. The re-application in `writeRepoState` stays as the backstop for a decision made while a run was already in flight.

Alternative considered: re-apply in `writeRepoState` only. It is smaller, but the report and the webhook would call a refuted finding `new` on every run where the verifier finds it again.

### Reproduction does not override an auditor's refutation
A run that reproduces an auditor-refuted fingerprint keeps it `refuted`. The auditor read the finding and judged it not a bug; a test showing the described behavior does not show that behavior is wrong. The Undo action is the way back, and the decision is visible on the finding. The alternative, reopening on reproduction, would make a refutation silently expire.

### `decide` and `undecide`
- `decide` reads the row and the existing decision in its immediate transaction. It refuses as follows:
  - an unknown finding: `not-found`, 404;
  - a status other than `speculative` or `open`: `not-decidable`, 409;
  - an existing decision: `already-decided`, 409;
  - a confirmation of an `open` finding whose stage is not `detected`: `already-validated`, 409.
- On an `open` finding, a refutation writes the status, an `open`→`refuted` history event and no stage change. A confirmation writes no status and no status event. It records the stage change from `nextStage` with `confirmedByAuditor`, extended to fire for an entry that was already `open`, with the auditor as actor.
- `undecide` returns a moved finding to `decided_on`. A refutation made on `open` restores `open` and clears `refuted_at` and the resolution. A confirmation made on `open` changes no status and records no status event, and `withdrawnStage` handles the stage as it does today.
- `DecisionError`'s `not-speculative` kind becomes `not-decidable`, and `DECISION_STATUS` in `src/dashboard/actions.ts` maps the two new kinds to 409.

### Export and restore
`snapshot()` selects `decided_on`, and `restoreDecision` writes it. `src/store/backup.ts` defaults a missing `decided_on` to `speculative` when it parses `decisions.json`, so an export from before this change still restores. The format name stays `reposcout/export@1`, because the change only adds an optional field.

### Dashboard
`finding-detail.tsx` decides which actions to show from the status, the stage and whether a decision exists:
- **Speculative:** Confirm and Refute.
- **Open at `detected`:** Confirm and Refute.
- **Open past `detected`:** Refute only.
- **Already decided:** neither. The decision block with Undo shows instead.

`decide-dialog.tsx` takes the status and words its title and button for a candidate or a finding, for example "Refute this finding". It keeps the 3 to 300 character reason, and the request body does not change.

## Partial state and migration

- `decide` and `undecide` each run in one immediate transaction: the decision row, the status, the status event and the stage event commit together or not at all. A run cannot interleave, because `writeRepoState` takes the same immediate lock.
- A failed or cancelled run writes no state, as today. `refutedByAuditor` is read-only input, so a run that dies after reading it leaves nothing behind.
- The migration is a single `ALTER TABLE` with a constant default, applied in the migration transaction. An older database upgrades with every decision marked `speculative`, which is what each of them was, since only speculative candidates could be decided until now.

## Risks / Trade-offs

- **A decision made while a run is in flight** → the run's report may list the finding as `new` once. The backstop in `writeRepoState` still stores it `refuted`, and the next run leaves it out. This is accepted rather than locking the dashboard during runs.
- **An auditor refutes a real bug** → it disappears from the Open tab and is fed to later audits as a known false positive, which steers specialists away from it. The refutation needs a reason, is shown on the finding with who made it, appears in its history, and can be undone. A line change gives a new fingerprint, so the bug is raised again if the code around it moves.
- **Precision drops when auditors start refuting open findings.** That is the intended signal, but a reader comparing prompt versions across this change should know that older versions had no way to record this kind of dismissal. The README's precision section says so.
- **Confirming an open finding adds no status history entry.** The confirmation shows in the decision block and in the stage history, but not in the status history. A placeholder `open`→`open` event would have broken the meaning of status history.
