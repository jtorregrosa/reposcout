## 1. Store

- [x] 1.1 Add `restoreHistory`, `restoreStages`, `restoreDecision` and `restoreLabels` to the store, writing rows exactly as given and setting each current stage from the latest restored stage event of every fingerprint in the state

## 2. Export module

- [x] 2.1 Add `src/store/backup.ts` with `EXPORT_FORMAT`, `writeExport` (every file in the state-store delta, read in one snapshot, usage unlimited) and `restoreExport` (manifest check, then the restore order in design.md, in one immediate transaction)
- [x] 2.2 Add `test/backup.test.ts`: a database holding a confirmed candidate, a type correction, a validated then resolved finding, usage, yield, a report and a failure round-trips into an empty database with the same statuses, stages, decisions, labels and both histories; a missing or unknown manifest is refused with no change; an unparseable report rolls the whole restore back

## 3. Commands

- [x] 3.1 Make `db export` call `writeExport` and print the same summary
- [x] 3.2 Add `--from <dir>` to `db import` in `src/cli.ts`, relative to the data directory, calling `restoreExport` after the existing empty-database check, and printing what it restored
- [x] 3.3 Extend `test/e2e/db.test.ts`: `db export` then `db import --from` into a fresh home restores the state and decisions, and `db import --from` against a database with state exits 1

## 4. Documentation and verification

- [x] 4.1 Update README.md "The database": the export contents, the manifest, `db import --from`, and the export as a restorable backup
- [x] 4.2 Run `openspec validate db-export-round-trip --strict`
- [x] 4.3 Run `pnpm verify` and fix anything it reports, then run it again in full
