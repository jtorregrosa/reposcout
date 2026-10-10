## Why

Everything RepoScout does is driven by repos.yaml, but the dashboard shows five of its roughly twenty-five keys and lets the auditor change only the suppression list. Adding a repository means copying a block and guessing `organization`, `project` and the token variable until a run stops failing. Tuning one means editing YAML by hand. And nobody can tell, without reading the merge rules, whether a value comes from the repository, from `defaults` or from a built-in default. A configuration UI that shows where each value comes from and edits the safe keys in place removes that friction. It keeps repos.yaml as the one source of truth, so the CLI keeps working without the dashboard.

## What Changes

- **Effective configuration with its origin:** the repository page's Configuration tab shows every key a run uses for that repository. Each value says where it comes from: the repository entry, `defaults`, derived from another key (such as `pat_env` from `provider`), or RepoScout's built-in default. `excluded_paths` and `facts` show the inherited entries apart from the repository's own, because they add up instead of replacing.
- **Edit a repository in place:** the same tab edits one key at a time. Each edit is written to repos.yaml through the existing safe-edit path, which keeps comments, validates with the run's parser and writes atomically. A rejected edit shows its validation error next to the field. **Reset to default** removes the key from the entry so the inherited value applies again. Editable keys:
  - `branch`, `mode`, `analyzers`, `max_files_per_run`, `max_files_full_run`, `max_file_bytes`;
  - `focus_paths`, `focus_areas`, the repository's own `excluded_paths` and `facts`;
  - `claude.models.*`, `claude.fallback_model`, `claude.max_turns`, `claude.subagent_max_turns.*`, `claude.timeout_minutes`;
  - the Jira target's `project`, `issue_type`, `parent` and `labels`.

  Removing an analyzer and editing `facts` show a warning first: the former keeps that analyzer's findings from being resolved, and the auditors trust facts without checking them.
- **Add a repository:** a guided form on the Repositories page for an Azure DevOps or GitHub repository, with a **Test connection** step that checks the branch exists with the credentials RepoScout would use. The form appends the entry to repos.yaml. `name` and the location keys (`provider`, `organization`, `project`, `repo`) are fixed once the repository exists, because its history is stored under its name.
- **Remove a repository:** removes the entry from repos.yaml after a confirmation. Its findings, runs and coverage stay in the state database, and adding a repository with the same name later brings them back. The last repository cannot be removed.
- **Settings page:** a new Settings page in the sidebar, with four sections:
  - **Defaults:** the same editor as a repository, applied to `defaults`, showing how many repositories inherit each value;
  - **Jira:** the site and the credential variables, read-only, plus the default target, editable;
  - **Notifications:** each webhook with its `format`, `min_severity` and `on_failure`, editable;
  - **Credentials:** the checks `doctor` makes (Claude CLI, tokens set, the Jira credential accepted, webhook variables), never a value.
- **Read-only keys:** keys that decide what runs on the machine or where a credential goes are shown but never written by the dashboard. The page says to edit repos.yaml for them. These are `test_command`, `test_command_unsandboxed`, `provider: local` and `path`, `claude.auth`, every `*_env` key, `jira.site`, `jira.fields`, and identity and location keys.
- **Out of scope:**
  - editing `.env` or any credential;
  - adding or removing webhooks;
  - renaming a repository;
  - editing `suppressed` here, since findings already do that;
  - the dashboard's port and `REPOSCOUT_HOME`.

Roadmap stage: platform.

**Security model:** the boundary that matters is unchanged, but the dashboard's deliberate limits widen, and the README's security section and the audit-security spec say so.
- **Unchanged:** the dashboard still cannot change what a run executes (`test_command`, its sandbox opt-out, `claude.auth`, the local provider), cannot point a credential at another variable or site (`*_env`, `jira.site`), and never reads, shows or writes a secret.
- **Widened:** today it writes only a repository's `suppressed` list. It will write the keys listed above, append a repository entry and remove one.
- **A new read from a remote:** Test connection runs `git ls-remote` against Azure DevOps or GitHub with the same token a run would use, passed the same way, never on argv. Clone hosts are fixed by the provider, so a new entry can only send a token to `dev.azure.com` or `github.com`, as a run already does.

**Subscription usage:** none. Nothing here starts a Claude session. An edit only changes what the next run does.

## Capabilities

### New Capabilities

None. Configuration editing is a dashboard feature over the repos.yaml contract `repository-config` already defines.

### Modified Capabilities

- `dashboard`:
  - new: the Settings page; the effective configuration with origins; editing a repository and the defaults; adding and removing a repository; Test connection; the credential checks;
  - changed: Navigation gains Settings; the Repository page's Configuration tab becomes the editor; the deliberate limits name the keys the dashboard may write.
- `audit-security`: the keys the dashboard must never write, and Test connection passing the token as a run does and only to the provider's fixed host.

## Impact

- **Backend:**
  - `src/config/`: a resolver that returns each key's effective value with its origin, and the list of editable keys with the reason others are read-only.
  - `src/dashboard/actions.ts`: `config-set`, `config-unset`, `repo-add`, `repo-remove` and `repo-test` actions over the existing safe-edit path.
  - `src/dashboard/server.ts`: `GET /api/config` and `GET /api/checks`.
  - `src/commands/doctor.ts`: the checks move into a function that `doctor` and the dashboard share, with unchanged CLI output.
  - `src/dashboard/api.ts`: the configuration and check types.
- **Web:**
  - a Settings page and route;
  - the repository Configuration tab rebuilt as the editor;
  - Add repository on the Repositories page;
  - Remove repository in the repository page's menu.
- **Database:** none. State is untouched, including when a repository is removed.
- **Dependencies:** none.
- **Docs:** the README's dashboard and security sections, and a note that repos.yaml stays editable by hand.
