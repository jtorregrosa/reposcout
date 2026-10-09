## Context

See proposal.md for why, and the specs for what. This builds on the dashboard of `dashboard-ux-overhaul`: the To report and Reported queues, the Next step bar and the selection bar exist, and `availableActions` already decides what a finding allows.

**Server today:**
- Dashboard actions are synchronous functions behind `POST /api/actions/<name>`, guarded by Host, Origin, `Sec-Fetch-Site` and the session token.
- GET endpoints check Host and `Sec-Fetch-Site` only.
- Every outbound call so far (git, webhooks) runs from the CLI, never from the dashboard server.

**Store and stages:**
- State lives in SQLite with versioned migrations.
- Stage changes go through `nextStage` and `withdrawnStage`, and are recorded with the change that caused them.

**Secrets:**
- They come from `.env`, are registered for redaction, and every `REPOSCOUT_*` variable is stripped from Claude's environment.

## Goals / Non-Goals

**Goals:**
- File one Jira Cloud issue per validated finding from the dashboard, singly or in a batch, with the project, parent and custom fields the receiving board needs.
- Never file a finding twice, even after a crash between Jira and the local write.
- Keep the credential on the server and the security story explainable in a few lines.

**Non-Goals:**
- Reading issue status back, or closing findings from Jira.
- Editing, transitioning or deleting issues.
- Jira Server or Data Center.
- Azure DevOps work items or GitHub issues.
- Reporting from a CLI run or a schedule.
- Field types beyond those in the issue-reporting spec. A required field of another type, such as a cascading select, blocks reporting with a message naming it.

## Decisions

### 1. A small Jira client of our own on `fetch`

`src/jira/client.ts` wraps Node's `fetch` with:
- Basic auth from email and token;
- `redirect: 'manual'`, where any 3xx fails the request;
- one retry on 429 honouring `Retry-After` up to 10 seconds;
- Jira's error body (`errorMessages`, `errors` per field) mapped to an error that keeps the field ids;
- every message passed through `redact`.

URLs are built from the configured site and fixed path templates. Every value from the dashboard goes through `encodeURIComponent`, or is checked first against a key pattern: project `^[A-Z][A-Z0-9_]+$`, issue `^[A-Z][A-Z0-9_]+-\d+$`.

`jira.js` was the alternative. It was rejected because the surface needed is six endpoints, and a library would add a dependency and hide the redirect and error handling the security spec cares about.

**Endpoints used (REST v3 and Agile 1.0):**
- `GET /rest/api/3/project/{key}`
- `GET /rest/api/3/issuetype/project?projectId=` (hierarchy levels)
- `GET /rest/api/3/issue/createmeta/{key}/issuetypes` and `…/issuetypes/{id}` (paged)
- `GET /rest/api/3/search/jql` (parents, and the dedupe label)
- `GET /rest/api/3/user/assignable/search`
- `GET /rest/agile/1.0/board?projectKeyOrId=` and `…/board/{id}/sprint?state=active,future`
- `POST /rest/api/3/issue`

### 2. Field metadata normalized once, on the server

`src/jira/metadata.ts` turns create metadata into a small list of `FieldSpec`s, each with `id`, `name`, `kind`, `required`, `options` and `default`.

| `kind` | From Jira's field schema | Sent as |
| --- | --- | --- |
| `select` | `option` | `{ id }` |
| `multiselect` | `array` of `option` | `[{ id }]` |
| `user` | `user` | `{ accountId }` |
| `users` | `array` of `user` | `[{ accountId }]` |
| `sprint` | the `gh-sprint` custom type | the sprint id |
| `date` | `date` | `YYYY-MM-DD` |
| `number` | `number` | a number |
| `text` | `string` | a string |
| `textarea` | `string` with a textarea custom type | ADF |
| `labels` | the system labels field | a list of strings |
| `unsupported` | anything else | not sent |

Defaults from `repos.yaml` are resolved against the metadata: by field id first, then by exact name, and option defaults by value or id. A default that matches no field, or no option, becomes an error on that field. The dashboard gets the specs ready to render and never sees Jira's raw schema. The server caches metadata per project and issue type for five minutes, and every create re-reads it, so a stale form cannot send a value the field no longer allows.

### 3. One `report` action handles one finding or a batch

`POST /api/actions/report` takes:
- `repo`;
- `fingerprints`, 1 to 50;
- `project`, `issue_type` and `parent`;
- `labels`;
- `fields`, a map from field id to the form's value.

For each finding, in order, the server:
1. checks it locally (open, `validated`, no link);
2. searches for the `reposcout-<fingerprint>` label;
3. creates the issue, or adopts the one found;
4. records the link.

It returns one outcome per finding.

The alternative was a batch done in the browser, as bulk Not a bug does. It was rejected here: the metadata is fetched and checked once per batch, values are converted once, and the action log gets one line that holds the whole batch.

Jira's bulk create endpoint was also rejected. Its partial-failure semantics are coarser, and the dedupe search has to precede each create anyway.

**Server mechanics:**
- A per-process mutex serializes `report` calls, so a double click cannot pass the duplicate check twice.
- The server's action dispatch becomes `await`-aware, so an action may return a promise. The existing synchronous actions are unchanged.
- `unlink` is a plain synchronous action on the store.

### 4. Lookups are GET endpoints behind the session token

| Endpoint | Returns |
| --- | --- |
| `GET /api/jira/meta?repo=&project=&issue_type=` | the field specs, the resolved target and the validated default parent |
| `GET /api/jira/parents?project=&issue_type=&q=` | matching parents |
| `GET /api/jira/users?project=&q=` | assignable users |
| `GET /api/jira/sprints?project=` | active and future sprints |

They answer only with `X-RepoScout-Token`, as actions do, because each one spends the credential. The page already holds the token for actions. Errors carry Jira's status and redacted message.

### 5. Store: a `finding_issues` table and two stage sources

A migration adds `finding_issues`, with:
- `repo` and `fingerprint` as the primary key;
- `key`, `url` and `project`;
- `reported_by` and `reported_at`.

`StageSource` gains `reported` and `unlinked`. `Store.linkIssue` writes the link and the `validated → reported` stage event in one transaction, and `Store.unlinkIssue` deletes it and writes `reported → validated`. `nextStage` needs no change: no run transition targets `reported`, and `reported` already survives runs, withdrawal ("moved past validated") and reopening (from the lookback).

When a fingerprint leaves the state, its link is dropped with its stage. The issue key stays in the stage history note. If the fingerprint returns and is reported again, the dedupe label relinks the same issue.

`FindingView` gains `issue: { key, url, reported_by, reported_at } | null`. `RepoView` gains `jira: { project, issue_type } | null`. The overview gains `jira: { site, ready }`, where `ready` means the email and token variables are set. It never carries the email or the token.

### 6. Description in ADF, built from text nodes only

`src/jira/adf.ts` builds the description document:
- a heading per section;
- paragraphs split on blank lines;
- the reproduction steps as ordered lists;
- the snippet as a `codeBlock` with a language guessed from the file extension;
- a small table of location, severity, category, type and fingerprint.

Every piece of finding text goes into `text` nodes, so Jira renders it literally. Wiki markup and HTML in a finding stay inert. The function is pure and covered by snapshot-free assertions on the node tree.

### 7. Web: one report form, two entry points

`ReportDialog` serves a single finding and a selection.
- **Loading:** it loads `jira/meta` with `useQuery`, keyed by repository, project and issue type, and reloads when the auditor changes project or issue type.
- **Rendering:** it renders one control per `FieldSpec` kind:
  - `Select` for a select;
  - a checkbox list for a multi-select;
  - an async `Command` combobox for users and for the parent, debounced at 250 ms;
  - `Select` for a sprint;
  - a date input, a number input, text or a textarea.
- **Required fields:** they are marked, and Create issue stays disabled until each has a value.
- **Jira's errors:** they come back per field id and are shown under the field.
- **Batch:** the dialog shows the shared fields once, and lists the findings with their summaries, which are editable.

The form state is a reducer keyed by field id. The Next step bar and `availableActions` gain `report` and `unlink`, so the shortcut list, the bar and the bulk bar stay consistent. The bulk bar offers Report to Jira only when every selected finding allows `report` and resolves to the same project and issue type.

### 8. Configuration

The `jira` sections go in `src/config/config.ts`:
- a strict top-level schema;
- a per-repository schema merged through the existing defaults merge, with `fields` merged per key and `labels` replaced.

The site must match `^https://[a-z0-9-]+\.atlassian\.net$`. The variables default to `REPOSCOUT_JIRA_EMAIL` and `REPOSCOUT_JIRA_TOKEN`, are read with a new `readSecretEnv`, and are registered for redaction on read. `doctor` gains a Jira check:
- whether the site is configured and the variables are set;
- an authenticated `GET /rest/api/3/myself`, which prints the account's display name and never the email.

## Risks / Trade-offs

- **[Issue created, local write fails]** The issue exists in Jira and the finding has no link. → The `reposcout-<fingerprint>` label. The next report of that finding finds the issue and links it instead of creating one.
- **[Auditor deletes the label in Jira]** The dedupe cannot find the issue. → A finding with a link is never sent again regardless. The label only protects the crash window, and the README says not to remove it.
- **[Unsupported required field]** A project requires a cascading select or another unsupported type, and reporting there is blocked. → The form names the field and its type. A later change can add the kind; the normalization makes that one table entry plus one control.
- **[Large projects]** Create metadata is paged and can be long. → It is paged through, cached for five minutes, and only `FieldSpec`s reach the page.
- **[Long batches]** 50 findings at about a second each holds the request for a while. → The cap, the per-finding outcomes, and the dialog's progress text.
- **[Credential scope]** A Jira API token carries the account's full permissions. → The README recommends a dedicated account limited to creating issues in the target projects, and the dashboard's own limit forbids anything but creating.

## Migration Plan

- **Schema:** the migration adds `finding_issues`. Older databases upgrade on open with no links, and no stage changes on upgrade.
- **Export:** `db export` writes `finding-issues.json`. `db import --from` restores it and accepts an export without it, keeping the format `reposcout/export@1`.
- **Configuration:** nothing changes until a `jira` section is added. Without one, Report to Jira is not offered and the dashboard behaves as before.
- **Failed or cancelled runs:** a run never writes links. A report changes local state only after Jira has answered, in one transaction.
- **Rollback:** revert the commits. The extra table is ignored by older code, and findings stay `reported`, which the older dashboard already displays.
