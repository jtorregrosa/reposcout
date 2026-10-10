## Context

The dashboard edits repos.yaml today only through `editConfig` in `src/dashboard/actions.ts`, which edits a `yaml` Document, validates the result with `parseConfig` and replaces the file atomically. Suppressions use it. `parseConfig` merges `defaults` into each entry with three rules (recursive for objects, replacing for scalars and lists, appending for `excluded_paths` and `facts`), derives `name`, `pat_env`, `project` and `analyzers` when absent, and lets zod fill the rest. It returns only the merged result, so where a value came from is lost. `doctor` builds its checks inline and prints them. The server re-reads repos.yaml on every request and pushes a refresh to the pages when the file changes.

## Goals / Non-Goals

**Goals:**
- One resolver that the API, the editor and the tests share, giving each key's effective value and origin.
- Every write expressed as a small operation on one key, so an edit never has to send or rebuild a whole entry.
- A single list of editable keys, checked on the server, which is the only thing the UI relies on.

**Non-Goals:**
- A YAML text editor.
- Detecting concurrent edits: an operation applies to the file as it is when the request arrives (see Decisions).
- Reloading `.env` in the running dashboard.

## Decisions

### Origins come from a second pass over the raw document

The resolver runs `parseConfig` for the effective values, then walks the raw `defaults` and entry maps to label each editable key:
- `repo` when the entry sets it;
- `defaults` when only `defaults` does;
- `derived` for `name`, `pat_env`, `project` on GitHub and `analyzers` when unset;
- `built-in` otherwise, carrying zod's default.

`excluded_paths` and `facts` return `{ inherited, own }` instead of one list. The merge itself is not touched, so a run behaves exactly as before.

*Alternative:* make `parseConfig` track origins while it merges. This was rejected because it puts dashboard concerns into the path every run takes, and a bug there would change audits.

### Operations, not documents

The new actions are:
- `config-set` `{ scope, key, value }`;
- `config-unset` `{ scope, key }`;
- `repo-add` `{ entry }`;
- `repo-remove` `{ repo }`;
- `repo-test` `{ entry }`.

`scope` is `defaults` or a repository name. `key` is a dotted path from the editable-key list. Anything outside that list is refused with 400 before the file is read. The value is first checked against that key's own schema, so the error names the field, then the whole file goes through `editConfig`, so cross-key rules (such as the 150 ceiling or a Jira target needing `jira.site`) still apply. `config-unset` deletes the key, and an object left empty is deleted too, so Reset leaves no `claude: {}` behind. For `excluded_paths` and `facts`, `config-set` writes only the scope's own list.

*Alternative:* `PUT` a whole entry. This was rejected because it would rewrite keys the auditor never touched, including the read-only ones, and would make it impossible to tell an override from an inherited value.

### Edits apply to the file as it is now

`editConfig` reads the file on every call, so an operation on one key applies on top of any hand edit made since the page loaded. Because operations are per key, the only lost update is two editors changing the same key, where the later one wins, which is what editing a file by hand already does. The page refreshes from the file-change push after every write.

*Alternative:* send the hash of the file the page last saw and refuse a write when it differs. This was declined for a single-user tool, since it would make every hand edit force a reload.

### Read-only keys are a list on the server

The editable-key list lives next to the schema in `src/config/`. Every other key the resolver returns carries `editable: false` and the reason shown in the UI ("decides what runs on this machine", "names where a credential is read from", "identifies the repository's history"). The UI never decides editability. In `repo-add`, the entry must not carry any of `test_command`, `test_command_unsandboxed`, `path`, `claude.auth`, `pat_env` or `jira`, and `provider` must be `azure-devops` or `github`. So a new repository always gets the derived `pat_env` and inherits the rest from `defaults`.

### Test connection runs git, not doctor

`repo-test` builds the clone URL with `remoteUrl`, the auth header the run would build, and the `GIT_CONFIG_*` environment from `src/git/git.ts`. It runs `git ls-remote --heads <url> <branch>` with a 20-second timeout, and answers one of: `reachable`, `branch missing`, `not found or no access`, `token missing` (Azure DevOps with neither the PAT variable nor `REPOSCOUT_ADO_BEARER`) or `failed: <redacted git error>`. `doctor` keeps its "touches no repository" rule.

### Checks shared with doctor, in process

The checks move to a function returning `Check[]`, called by `doctor` (unchanged output and exit code) and by `GET /api/checks` behind the session token, because one of them calls Jira. The dashboard runs them in its own process, so they reflect the environment loaded when `ui` started, and the Credentials section says so with the start time and "restart `ui` after editing `.env`".

*Alternative:* spawn `doctor --json` so the checks see a fresh `.env`. This was declined because it adds a CLI output contract for a difference that a restart already covers.

### Removing a repository leaves state alone

`repo-remove` deletes the entry from the `repos` sequence only. The state database keys everything by name, so the history waits there, and a later `repo-add` with the same name picks it up. Removing the last entry is refused with 409, because `parseConfig` requires a non-empty list.

## Risks / Trade-offs

- [A YAML anchor or alias shared between entries makes a per-entry edit change several repositories] → when the key's node is an alias, `config-set` refuses with 409 and asks for a hand edit.
- [`defaults` edits change many repositories at once] → the Defaults section shows how many repositories inherit each value, and how many override it, next to the field.
- [The resolver and `parseConfig` drift apart] → a test asserts that, for each fixture, every effective value the resolver reports equals the one `parseConfig` returns.
- [Credential checks are stale after editing `.env`] → the Credentials section states when the environment was loaded.
- [Test connection hangs on a slow host] → 20-second timeout, with `GIT_TERMINAL_PROMPT=0` as in clones.

## Migration Plan

No database or file migration. A failed or refused edit leaves repos.yaml unchanged because `editConfig` validates before its atomic rename, and no action here touches a run or the state database, so a cancelled run is unaffected. Rolling back the change removes the UI. Every edit already made is plain YAML.
