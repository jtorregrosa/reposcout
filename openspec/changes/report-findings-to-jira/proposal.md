## Why

The dashboard now gathers validated findings in a To report queue, but nothing takes them further. Nothing creates the ticket, so the Reported queue is always empty, and the people who own the code only learn of a finding when an auditor copies it by hand into Jira, picks the project, the parent epic and the custom fields their board requires, and remembers which findings they have already filed. Reporting to Jira from the queue closes the loop the Report stage stands for.

## What Changes

- **Configuration:**
  - A new top-level `jira` section names the Jira Cloud site and the environment variables that hold the account email and the API token.
  - A new per-repository `jira` key, merged with `defaults` as every other key, sets the target:
    - the project key;
    - the issue type;
    - a default parent;
    - labels;
    - default values for custom fields, by field id or name.
- **Report to Jira, one finding:** in the dashboard, a To report finding's Next step bar offers **Report to Jira…**. It opens a form prefilled from that repository's target:
  - the project, the issue type and the parent;
  - the summary, from the finding's title;
  - the description: the finding's scenario, the code, why it is a bug, the reproduction steps and the suggested fix;
  - labels;
  - every custom field with a default.

  The form also shows every field Jira marks required for that project and issue type. Each field gets the right control from Jira's create metadata: a select with its allowed options, a user picker, a sprint picker, a date, a number or text. The parent is chosen by searching Jira by key or title among the issues that can be a parent there. Everything is editable before creating.
- **Report to Jira, in bulk:** the selection bar offers **Report to Jira…** for several findings. They must share one repository's target. One form sets the shared fields, and each finding gets its own summary and description and its own issue, created one at a time, with the outcome of each reported.
- **Creating an issue:**
  - It records the issue key and URL on the finding.
  - It moves the finding to the `reported` stage, with its own source in the stage history.
  - It shows the key, linking to Jira, on the finding, in the list and in exports.
  - A finding that already has an issue never gets a second one: the dashboard offers **Open in Jira** instead. A creation whose local record failed is recovered by a label carrying the fingerprint, so a retry links the existing issue instead of filing it twice.
- **Unlink issue:** an auditor can unlink an issue that was filed by mistake. This returns the finding to `validated` and leaves the Jira issue untouched.
- **Export:** `db export` and `db import --from` carry the issue links.
- **Out of scope**, for later changes of the Report stage:
  - reading the issue's status back from Jira;
  - moving a finding to `fixed` when its issue closes;
  - Azure DevOps work items and GitHub issues;
  - reporting from a CLI run.

Roadmap stage: report.

**Security model:** this change alters it. RepoScout gains its first write to an external system.
- **Credential:** a Jira API token with its account email, held in `.env` under `REPOSCOUT_*` names, kept apart from the repository PATs and still stripped from Claude's environment.
- **Where it is used:** only by the dashboard server, over HTTPS, and only against the configured `*.atlassian.net` site. It never reaches the browser, a log line, the action log or a report.
- **Lookups:** the requests that read Jira metadata for the form go through the dashboard server behind the same session token as actions.
- **Dashboard limits:** the deliberate limits of the dashboard change from "never writes to a remote" to "writes to Jira only to create an issue for a finding, on an auditor's action". The README's security section and the audit-security spec say so.
- **Runs untouched:** audit runs, agents and the PAT scopes are unchanged.

**Subscription usage:** none. Reporting calls Jira only and starts no Claude session.

## Capabilities

### New Capabilities

- `issue-reporting`: filing findings as Jira Cloud issues. It covers:
  - the target resolution from configuration;
  - the create metadata and the field values sent;
  - the issue content built from the finding;
  - the one-issue-per-finding rule and its recovery;
  - unlinking;
  - the Jira credential and the requests RepoScout makes.

### Modified Capabilities

- `finding-lifecycle`: `reported` stops being reserved. Linking an issue moves a finding there, and unlinking returns it to `validated`, each with its own stage source.
- `dashboard`: Report to Jira (single and bulk), Open in Jira, Unlink issue, the Jira lookup endpoints, the issue key on findings, the Next step bar for To report and Reported, and the deliberate limits.
- `repository-config`: the top-level `jira` section and the per-repository `jira` target.
- `audit-security`: how the Jira credential is held, where it may be sent, and that it is stripped from Claude's environment.
- `state-store`: issue links in the database, in `db export` and in the export round trip.

## Impact

- **Backend:**
  - `src/config/config.ts`: the `jira` schema.
  - A new `src/jira/` module: the client, the create metadata and the ADF description.
  - `src/dashboard/actions.ts` and `src/dashboard/server.ts`: new actions and lookup endpoints. Actions become awaitable.
  - `src/dashboard/api.ts`: the issue link on `FindingView`, and the lookup types.
  - `src/store/*`: a new `finding_issues` table through a migration, and the new stage sources.
  - `src/store/backup.ts`: export and import.
- **Web:**
  - Findings: a report form and the bulk report; Open in Jira and Unlink in the detail; the key in the list and in exports.
  - The Report stage card offers reporting instead of only exporting.
- **Dependencies:** none. The client uses Node's `fetch`.
- **Docs:** README configuration, dashboard actions, security model, and the `.env` keys.
