## Why

`db export` is described as a JSON copy of the database that can be imported again, and the README names a committed export as one way to keep the database between pipeline runs. Neither holds today:

- the export leaves out the history `actor` column, auditor decisions, label corrections, reports and failures;
- `db import` reads only the legacy `state/` files, so restoring an export loses every finding's history and stage history, and every auditor decision.

A restore today silently drops the auditor's work.

## What Changes

Roadmap stage: platform.

- `db export` writes everything the database holds that cannot be derived from the rest, from one consistent snapshot. It adds:
  - the history `actor` column;
  - `decisions.json`, `labels.json` and `failures.json`;
  - `reports.jsonl`;
  - a `manifest.json` that names the export format (`reposcout/export@1`), the schema version and the time of the export.
- `db import --from <dir>` restores an export into an empty database, in one transaction. It restores:
  - the repository state, census and usage;
  - the finding and stage histories, with their actors;
  - the current stages, decisions and labels;
  - the analyzer yield, reports and failures.
- A directory without a known manifest is refused, and so is a database that already holds state. `db import` without `--from` keeps importing the legacy JSON state as before.
- The README describes the export as a backup that restores.

Non-goals:

- No merge of an export into a database that holds state.
- No automatic backups, and no change to the phase 2 pipeline.
- No change to the legacy JSON import.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `state-store`: `db export` contents and consistency, `db import --from`, and the round-trip guarantee.

## Impact

- **Code:**
  - `src/commands/db.ts` and `src/cli.ts`, for the `--from` option;
  - a new module under `src/store/` that writes and restores an export;
  - small restore methods on the store.
- **Security model:** unchanged. The export holds what the database holds. That includes finding text already redacted on the way in, and no secret is added.
- **Subscription usage:** none.
- **Compatibility:**
  - Exports written before this change have no manifest. `db import --from` refuses them with a message, and they can still be imported through the legacy path by copying their `state/` directory into the data directory.
  - The export format is versioned apart from the schema, so an export restores into a newer RepoScout.
