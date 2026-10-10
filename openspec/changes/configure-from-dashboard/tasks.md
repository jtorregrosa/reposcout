## 1. Configuration resolver

- [x] 1.1 Add the editable-key list to `src/config/`: dotted keys, the per-key schema each value is checked against, and, for every non-editable key, the reason shown in the UI
- [x] 1.2 Add the resolver: for `defaults` and each repository, every key's effective value from `parseConfig` with its origin (`repo`, `defaults`, `derived`, `built-in`), `excluded_paths` and `facts` split into `inherited` and `own`, and, for `defaults`, how many repositories inherit and override each key
- [x] 1.3 Unit tests: every origin, the recursive merge of `claude`, list replacement, the two appending lists, the derived `name`, `pat_env`, `project` and `analyzers`, and a parity test that the resolver's values equal `parseConfig`'s for every fixture

## 2. Write actions

- [x] 2.1 Add `config-set` and `config-unset` over `editConfig`: scope `defaults` or a repository, key from the editable list (400 otherwise, before reading the file), per-key validation naming the field, removal of objects left empty, 409 when the key's node is a YAML alias
- [x] 2.2 Accept webhook keys in `config-set` (`notifications.webhooks.<name>.format|min_severity|on_failure`), refusing `name` and `url_env`
- [x] 2.3 Add `repo-add`: providers `azure-devops` and `github` only, the identity and location keys only (400 naming any other key), 409 for a configured name, appended to `repos`
- [x] 2.4 Add `repo-remove`: deletes the entry only, 409 for the last one, state untouched
- [x] 2.5 Add `repo-test`: `git ls-remote --heads` with the run's auth header through `GIT_CONFIG_*`, a 20-second timeout, the five outcomes, and the error redacted
- [x] 2.6 Register the actions and their body fields in the server's action table, and log them in `dashboard-actions.jsonl` like every action
- [x] 2.7 Tests:
  - comments kept after each action;
  - refusal of every read-only key in set, unset and add;
  - Reset removing an emptied `claude`;
  - an edit after a hand edit keeping it;
  - the alias refusal;
  - removing a repository keeping its state, and adding it back restoring its history;
  - `repo-test` with a stubbed `git ls-remote` (the fixed provider hosts rule out a local bare repository) for every outcome, token missing with no process spawned, and argv and URL holding no token.

## 3. Read endpoints and checks

- [x] 3.1 Move the `doctor` checks into a function returning the checks, keeping `doctor`'s output and exit code byte for byte, and test both
- [x] 3.2 Add `GET /api/config` (resolver output and the editable-key reasons) and `GET /api/checks` (behind the session token, with the time `ui` loaded its environment)
- [x] 3.3 Add the configuration, check and test-connection types to `src/dashboard/api.ts`
- [x] 3.4 Tests: `/api/checks` refused without the token and sending nothing to Jira, the Jira check against the fake Jira showing the display name and no token, and `/api/config` never holding a secret value

## 4. Web

- [x] 4.1 Build a shared configuration editor: one row per key with its value, origin badge, the read-only reason or an editor matching the key's type, Reset to default, and the server's error shown on the field
- [x] 4.2 Replace the repository Configuration tab with the editor, with the analyzer and facts confirmations
- [x] 4.3 Add Remove repository to the repository page's menu, with the confirmation saying history is kept
- [x] 4.4 Add Add repository on the Repositories page: the form, Test connection with its outcome, and Save
- [x] 4.5 Add the Settings route and sidebar entry, with Defaults (inheritance counts), Jira, Notifications and Credentials (Run checks, the environment load time and the restart note)
- [x] 4.6 Add Settings to the command palette
- [x] 4.7 Component tests: origins and the split lists rendered, a field error shown, Reset, the analyzer confirmation, Add repository with each test outcome, and the Credentials section with a failing check

## 5. Docs and verification

- [x] 5.1 Update README.md: the dashboard section (Settings, editing a repository, adding and removing one), the configuration section noting that repos.yaml stays editable by hand and which keys only change there, and the security model's dashboard limits and Test connection
- [ ] 5.2 At archive, update the Purpose of `openspec/specs/dashboard/spec.md` so its list of writes includes configuration edits and repository entries
- [x] 5.3 Run `pnpm verify`
