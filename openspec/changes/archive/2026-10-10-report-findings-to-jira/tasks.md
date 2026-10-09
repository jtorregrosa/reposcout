## 1. Configuration and credentials

- [x] 1.1 Add the top-level `jira` schema (`site`, `email_env`, `token_env`) and the per-repository `jira` target to `src/config/config.ts`, merged with `defaults` (`fields` per key, `labels` replaced), with the loading errors the repository-config spec names
- [x] 1.2 Add `readSecretEnv` and register the Jira email and token for redaction when read
- [x] 1.3 Unit tests for the schemas, the merge and every loading error

## 2. Jira client

- [x] 2.1 Create `src/jira/client.ts`:
  - Basic auth;
  - fixed path templates with key validation and encoding;
  - `redirect: 'manual'`;
  - one 429 retry within 10 s;
  - mapped, redacted errors with field ids.
- [x] 2.2 Create `src/jira/metadata.ts`: paged create metadata, normalization to `FieldSpec`, default resolution by id or name and option value or id, and a five-minute cache
- [x] 2.3 Create `src/jira/values.ts`: convert and validate form values per kind into Jira's payload, refusing with the field named
- [x] 2.4 Create `src/jira/adf.ts`: the description document from a finding, with text nodes only and a code block for the snippet
- [x] 2.5 Create `src/jira/lookups.ts`: parent search by hierarchy level, assignable users, active and future sprints, and the dedupe label search
- [x] 2.6 Add a fake Jira HTTP server for tests, and unit tests for:
  - the client: redirect refused, 429 retry, error mapping and redaction;
  - metadata normalization and defaults;
  - value conversion;
  - ADF, including literal markup;
  - lookups.

## 3. Store and stages

- [x] 3.1 Add the migration creating `finding_issues`, and the `reported` and `unlinked` stage sources
- [x] 3.2 Add `Store.linkIssue` and `Store.unlinkIssue`, writing the link and the stage event in one transaction. Drop the link when its fingerprint leaves the state
- [x] 3.3 Add `finding-issues.json` to `db export` and to `db import --from`, accepting exports without it
- [x] 3.4 Tests:
  - link and unlink with their stage history;
  - a run keeping `reported`;
  - withdrawal and reopening around `reported`;
  - an upgrade of an older database;
  - the export round trip with and without the file.

## 4. Dashboard server

- [x] 4.1 Make action dispatch `await`-aware, and add the `report` action:
  - local checks;
  - the per-process mutex;
  - for each finding, the dedupe search, the create, and the link;
  - per-finding outcomes.
- [x] 4.2 Add the `unlink` action
- [x] 4.3 Add the GET lookups `/api/jira/meta`, `/api/jira/parents`, `/api/jira/users` and `/api/jira/sprints`, requiring the session token
- [x] 4.4 Extend `src/dashboard/api.ts` and the overview: `FindingView.issue`, `RepoView.jira`, `Overview.jira` (site and ready, never the credential), and the lookup and outcome types
- [x] 4.5 Add a Jira check to `doctor`: the site, the variables, and `GET /myself` printing the display name
- [x] 4.6 Tests against the fake Jira:
  - refusals (409 for a finding not validated or already linked, 400 for a crafted key, 403 without the token);
  - a created issue moves to `reported`;
  - dedupe adoption;
  - a batch with one refusal;
  - a Jira 400 with a field error changing nothing;
  - the action log holding no credential.

## 5. Web

- [x] 5.1 Extend `availableActions` with `report` and `unlink`, and the common actions of a selection (no shortcut key was added)
- [x] 5.2 Add the Jira query factories and `ReportDialog`:
  - one control per field kind;
  - async parent and user comboboxes;
  - required-field gating;
  - per-field Jira errors;
  - the batch layout with an editable summary per finding.
- [x] 5.3 Next step bar: Report to Jira in To report (Copy for a ticket when not configured), Open in Jira in Reported, and Unlink issue in More with its confirmation
- [x] 5.4 Show the issue key and link in the detail header, the list rows and the HTML and Markdown exports, and offer Report to Jira in the bulk bar for findings of one repository
- [x] 5.5 Component tests:
  - the prefilled form;
  - a required field gating Create;
  - a field error shown in place;
  - reporting not configured;
  - a reported finding in the list;
  - unlink returning the finding to To report;
  - a bulk report of three findings;
  - mixed targets not offered.

## 6. Documentation and verification

- [x] 6.1 Update README:
  - configuration (`jira` sections and `.env` keys);
  - the dashboard pages and actions (Report to Jira, Open in Jira, Unlink);
  - the security model (the first external write, credential scope, the dedicated-account advice, and the dedupe label);
  - `doctor`.
- [x] 6.2 Add an end-to-end test that starts the dashboard against the fake Jira, reports a finding and checks the stage, the link, the action log and `db export`
- [x] 6.3 Run `pnpm verify`
