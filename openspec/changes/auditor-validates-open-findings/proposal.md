## Why

An auditor can confirm or refute only a speculative candidate. A finding the verifier confirmed from the code alone is `open` at the `detected` stage, and on native Windows, or in any repository without a `test_command`, nothing can move it to `validated`, because reproduction is the only other route. A verifier false positive among the open findings can only be hidden with a `repos.yaml` suppression, which means "known and accepted", not "this is not a bug", so precision never counts it against the verifier.

This is the first change of the validate stage: it lets the person triaging settle any open finding as real or not real, with the same decision, reason and undo they already use for speculative candidates.

## What Changes

- An auditor can **confirm** an `open` finding at the `detected` stage. Its status stays `open` and its stage becomes `validated` with the source `auditor`.
- An auditor can **refute** any `open` finding with a reason. It becomes `refuted` with the resolution "Refuted by <auditor>: <reason>", its stage stays where it was, and it is listed among the known false positives of later audits.
- A refutation of an open finding outlives later runs: a run that reports the same fingerprint as confirmed again keeps it `refuted` and does not report it as `new`, in the same way a suppressed fingerprint is never reported.
- **Undo this decision** works for both: a withdrawn refutation returns the finding to `open`, and a withdrawn confirmation returns its stage to the one it had before, with its status unchanged.
- A finding that already has a decision cannot be decided again until that decision is withdrawn (HTTP 409), and a confirmation of an open finding that is already `validated` is refused (HTTP 409).
- Each decision records which status it was made on (`speculative` or `open`), so re-applying and withdrawing it act on the right status. Older decisions are treated as made on `speculative`.
- Precision counts an open finding an auditor refuted as dismissed, so the Usage page measures the verifier's false positives.
- The finding detail offers Confirm… and Refute… on open findings, worded for a finding rather than a candidate.

## Roadmap stage, security and budget

- **Stage:** validate.
- **Security model:** unchanged. The decision is a dashboard write to `state/reposcout.db` that already exists for speculative candidates, behind the same local-only server and request checks. Nothing is written to audited repositories or to `repos.yaml`.
- **Subscription usage:** none. No Claude session is started; a refuted finding only adds one entry to a manifest list that is already capped at 20.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `finding-lifecycle`: auditor decisions extend to open findings; re-applying and withdrawing a decision depend on the status it was made on; a run keeps an auditor-refuted fingerprint refuted; the stage rules for auditor confirmation and withdrawal cover open findings.
- `dashboard`: the finding detail offers Confirm and Refute on open findings, and the decide endpoint's refusals change.
- `detection`: the manifest's known false positives include open findings an auditor refuted.
- `usage-metrics`: precision counts a refuted open finding as dismissed.
- `state-store`: every decision records the status it was made on, and the export carries it.

## Impact

- **Code:** `src/store/store.ts` (decide, undecide, re-applying decisions on state writes), `src/findings/classify.ts` (keeping an auditor-refuted fingerprint out of a run's confirmed findings), `src/findings/stage.ts`, `src/audit/repo.ts`, `src/dashboard/actions.ts`, `src/store/backup.ts`, and `web/src/features/findings/finding-detail.tsx` and `decide-dialog.tsx`.
- **Database:** one migration adds the decided-on status to the `triage` table.
- **Export format:** `decisions.json` gains a `decided_on` field. The format stays `reposcout/export@1`, and an export without the field restores its decisions as made on `speculative`.
- **HTTP contract:** `src/dashboard/api.ts` adds `decided_on` to `Decision`. The decide request body is unchanged.
- **Docs:** README sections on triage in the dashboard and on precision.
