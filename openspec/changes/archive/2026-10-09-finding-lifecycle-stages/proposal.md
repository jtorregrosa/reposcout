## Why

RepoScout grows one roadmap stage at a time (detect, validate, report, fix), but a finding today has only a status, which mixes how far it has progressed with what was decided about it. The validate, report and fix stages need a place to record their progress before any of them is built, or each would bend the status model to fit.

## What Changes

Roadmap stage: platform. It prepares the data model, the API and the dashboard for the later stages without adding stage behavior.

- Every finding gets a **lifecycle stage**: `detected`, `validated`, `reported` or `fixed`, kept apart from its status. The status still says what was decided (open, speculative, resolved, suppressed, refuted, duplicate). The stage says how far the finding has progressed.
- A stage moves only on a recorded event. Today these events are:
  - the verifier reproducing the bug with a test (`verified: true`) → validated;
  - an auditor confirming a speculative candidate → validated;
  - resolution → fixed;
  - reopening → back to the stage it had before fixed;
  - withdrawing an auditor's confirmation → back to the stage it had before that confirmation.
- `reported` is defined but has no trigger yet. The report stage will add one.
- Every stage change is recorded with its time, run, source, note and actor. The stage outlives the state a run rewrites, like auditor decisions do.
- On upgrade, findings in existing databases get an initial stage from what is already stored.
- The dashboard API exposes each finding's stage and its stage history.
- The Findings page gains a stage filter, held in the URL, and the finding detail shows a four-step stage timeline. There are no new pages, and the navigation does not change.
- `db export` writes the stage history beside the status history.

Non-goals:

- No new validate, report or fix behavior.
- No stage in run reports, `summary.md`, SARIF or webhook messages.
- No dashboard action that moves a stage by hand.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `finding-lifecycle`: adds the lifecycle stage, its transitions and its history.
- `dashboard`: adds the stage filter and the stage timeline in the finding detail.
- `state-store`: the schema upgrade assigns initial stages, and `db export` includes the stage history.

## Impact

- **Code:**
  - The SQLite schema gets a new migration with a current-stage table and a stage-event table.
  - The store computes stages wherever it writes state or a decision: a run's state write, decide, undecide and the legacy import.
  - The dashboard API contract (`src/dashboard/api.ts`) gains the stage fields on `FindingView` and a stage history endpoint.
  - In the web app: the finding filters, the finding detail and the domain labels.
- **Security model:** unchanged. The change adds no tool permission, no write to audited repositories and no network access. The new endpoint is read-only behind the existing dashboard guards.
- **Subscription usage:** none. Stages are computed by the CLI from data it already has, with no Claude session.
- **Compatibility:** older databases upgrade automatically. A database upgraded by this version cannot be opened by an older RepoScout, as with every earlier migration.
