## Context

See proposal.md for why. Four facts shape the approach:

- **The export is assembled by hand.** `db export` in `src/commands/db.ts` builds its files from store reads and raw `SELECT`s. It reads in autocommit mode, so a run that commits halfway through an export can leave the export inconsistent.
- **The restore needs the legacy import's trick, and more.** `db import` calls `importLegacy`, which writes each repository through `writeRepoState` and then replaces the history that write invented with what the JSON knew. A full restore needs the same, and it also has to replace the stage history and the current stage.
- **Decisions and labels are re-applied on every write.** They live in `triage` and `labels`, and `writeRepoState` re-applies them, so they must be in place before the state is written.
- **Each table has a natural key**, so a restore into an empty database has no conflicts to resolve.

## Goals / Non-Goals

**Goals:**
- Keep one module that owns both directions of the export, so a new table is added in one place.
- Give a restore that is all or nothing, and an export that is one snapshot.
- Keep the export format independent of the schema version.

**Non-Goals:**
- Restoring into a database with state, merging exports, or exporting only some repositories.

## Decisions

### `src/store/backup.ts` owns the export format
It exports `writeExport(store, dir)` and `restoreExport(store, dir)`, plus the constant `EXPORT_FORMAT = 'reposcout/export@1'`. `src/commands/db.ts` only resolves paths, enforces the empty-database rule and prints. A round-trip unit test runs against two in-memory stores with no CLI.

Alternative considered: dump every table as raw rows. That is exact, but it ties the format to the schema version, and a backup taken before an upgrade could not be restored after it. Raw rows also break the readable `state/<repo>.json` shape that the current export promises.

### One snapshot for the export
All reads run inside one deferred read transaction. Under WAL, that gives a single snapshot while a run keeps writing. Writing the files happens after the reads, from the collected data, so the transaction stays short.

### Restore order inside one immediate transaction
1. Manifest check, before any write.
2. `triage` and `labels` rows. They must exist before the state is written, because `writeRepoState` re-applies them.
3. For each `state/<repo>.json`, `writeRepoState` with no run id. Then replace that repository's `finding_events` with the exported entries, which carry their actors.
4. Replace that repository's `finding_stage_events` with the exported entries. Set each current stage from the latest exported event of every fingerprint in the state. A fingerprint with no exported stage events keeps the initial stage `writeRepoState` gave it.
5. Census, usage, analyzer yield (through `saveYield`, one row at a time), reports (`saveReport` with their date) and failures (`replaceFailures` per date).
6. `meta.export_restored_at`.

Any throw rolls everything back, which is what the spec's "fails partway" scenario checks.

### Store gains narrow restore methods
`restoreHistory(repo, events)`, `restoreStages(repo, events)`, `restoreDecision(...)` and `restoreLabels(...)` write rows exactly as given. Being explicit keeps raw SQL out of the backup module, as it is out of the rest of the code outside the store.

### Usage rows are exported whole
The `usage` table stores the whole row as JSON, and `appendUsage` re-derives its index columns, so `state/usage.jsonl` restores exactly. The export reads every row, not the dashboard's latest 200.

## Risks / Trade-offs

- [Large reports make the export big] → `reports.jsonl` holds one line per report, which is what the database already stores. Size grows with history either way.
- [An export taken by an older RepoScout has no manifest] → It is refused with a message. The legacy path still imports its state.
- [The format must evolve] → A future `reposcout/export@2` can be read next to `@1`, and the restore dispatches on the manifest.

## Migration Plan

No schema migration. The README's database section changes to describe the export as a restorable backup, with `db import --from`.
