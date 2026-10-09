## Context

See proposal.md for why. Four facts about the current code shape the approach:

- **A run rewrites the state.** It replaces a repository's whole `findings` table in one immediate transaction (`writeRepoState`). Anything that must outlive a run lives in its own table and is re-applied on every write, as auditor decisions (`triage`) and label corrections (`labels`) already are.
- **Status changes have exactly three writers:** `writeRepoState` (every run, and the legacy JSON import, which goes through it), `decide` and `undecide`. Each writes its history in `finding_events` in the same transaction.
- **Migrations are SQL strings** in `src/store/schema.ts`, each applied once and recorded in `PRAGMA user_version`. Released entries are never edited.
- **`src/dashboard/api.ts` is the HTTP contract.** The web app type-checks against it.

## Goals / Non-Goals

**Goals:**
- Keep one place that decides every stage transition: a pure function that can be unit-tested without a database.
- Make the stage survive a run's rewrite with no change to how classification works.
- Keep the change invisible to anything that does not read stages: reports, SARIF, webhooks, the audit session.

**Non-Goals:**
- No change to `FindingStatus` or to how statuses are decided.
- No fix for the existing gap where `db export` omits auditor decisions, labels and the history `actor` column. That is a separate change.

## Decisions

### Two new tables, not columns on `findings`
- `finding_stages (repo, fingerprint, stage, source, since)` holds the current stage. Its primary key is `(repo, fingerprint)`.
- `finding_stage_events (id, repo, fingerprint, at, run_id, from_stage, to_stage, source, note, actor)` holds the history. It is indexed by `(repo, fingerprint, id)`.

Columns on `findings` would be wiped by every rewrite. Carrying them through `RepoState` and classification would touch the whole run pipeline for data the run does not decide.

Alternative considered: derive the current stage from the latest event, with no current-stage table. That gives a single source of truth, but every overview load would need a window query, and a fingerprint that left the state and came back would inherit a stale stage. The spec requires a fresh initial stage. The current-stage table makes "drop on leaving the state" a plain `DELETE`, while the events stay as history.

### Separate stage history, not new columns on `finding_events`
Stage events and status events have different shapes and change at different moments. A reproduction moves the stage with no status change, and a suppression changes the status with no stage change. Putting both into one row would force placeholder values. The detail view shows status history and stage timeline as two elements, so separate endpoints match the UI. The new endpoint is `GET /api/findings/:repo/:fingerprint/stages`, next to `/history`.

### One pure transition function
`src/findings/stage.ts` exports the stage order, the sources and a function. The function takes:
- the previous stage row (or none);
- the previous status;
- the entry being written (status and finding, after `applyDecision`);
- what the stage history says about the stage before the last `fixed` and before the last `auditor` change.

It returns the next stage and source, or no change. The store calls it at its three writers, inside their existing transactions. The rules are the ones in the finding-lifecycle delta. The function never returns `reported`, except when it restores a previous stage.

### Look-backs read the stage history
Reopening needs the stage before `fixed`, and withdrawal needs the stage before the auditor's confirmation. Both read `from_stage` of the latest matching event (`to_stage = 'fixed'`, or `source = 'auditor'`) for that fingerprint. This avoids extra `stage_before_*` columns. The cost is one indexed lookup per reopened or withdrawn finding, which is rare.

### Initial stages assigned by the migration, in SQL
The migration creates both tables and inserts the following for every row in `findings`:
- a stage from `status`, `json_extract(finding, '$.verified')` and an `EXISTS` on a `triage` row with `verdict = 'confirmed'`;
- one event with the source `upgrade` and `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')` as its time.

Keeping it in SQL keeps the migration list declarative and inside the upgrade's own transaction. A database populated later by the legacy import gets its stages from `writeRepoState` with the source `initial`, because that import goes through it.

### UI: filter in scope, timeline in the detail
- `stage` joins `matchesScope` in `web/src/lib/findings.ts`, so the status-tab counts respect it as the spec requires. It uses the same comma-list URL parsing as `severity`.
- The timeline is a small component in `web/src/features/findings/`. It takes its dates from the stage endpoint, uses theme tokens only, and adds no new page.
- Stage labels and help text go in `web/src/lib/domain.ts`, next to `STATUS_LABEL`.

## Risks / Trade-offs

- [The stage drifts from what the rules would compute, for example after a manual database edit] → The stage is only ever written by the transition function, and the unit tests cover each transition. Recomputing stages is out of scope, because the history is the record.
- [A finding resolved by "not reported again" reads as `fixed` although nobody changed the code on purpose] → This is accepted for now: `fixed` means the defect is no longer observed. The fix stage can add a finer source (for example `fix-merged`) without changing the stage set.
- [A fingerprint migration changes fingerprints] → The old ones leave the state and lose their current stage. The new ones get an initial stage from their status, verification and decision. Their stage history restarts under the new fingerprint, and the old events stay under the old one, as status history already does.
- [Overview payload grows] → Three short fields per finding. The stage history is only fetched for the selected finding.

## Migration Plan

- The new schema migration runs on first open, inside the upgrade transaction. A failure leaves the database at its previous version.
- Rollback means restoring a database copy taken before the upgrade, as with every migration, because an older RepoScout refuses a newer schema. The README's "The database" section already covers the upgrade path, and the change adds `finding-stages.json` to the `db export` description.

## Open Questions

- Should the report stage, when it exists, also count a webhook notification as reporting a finding, or only an explicit action such as creating a work item? That belongs to the report stage's own proposal and does not affect this design.
