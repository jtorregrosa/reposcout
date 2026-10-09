## Why

An open finding reaches `validated` with the source `reproduced` only if the verifier happens to reproduce it during the audit that reports it. That audit has many candidates to check and little time for each, so most confirmed findings stay at `detected` even in repositories with a working `test_command`. Since #4 an auditor can confirm them by hand, but nothing retries reproduction on its own. This change adds that pass, so the triage queue holds fewer findings whose reality is still in doubt.

## What Changes

- New run mode `run --mode validate`. For each repository with verification on, one Claude session runs only the verifier. The verifier tries to reproduce, with one test each, the open findings still at `detected`, in the verification worktree at the current head.
- **Which findings it takes:**
  - Eligible: findings that are `open` at `detected` and whose file still exists at the head.
  - Left out: any fingerprint with an auditor decision, any fingerprint pending suppression in `repos.yaml`, and any finding that already has two unsuccessful attempts.
  - Order: fewest attempts first, then most severe, then oldest.
  - Cap: at most 10 per repository, or `--max-files`, from 1 to 150.
- **A reproduced finding** keeps its status `open` and its text. It gains `verified: true` and the test and output in `reproduction`, and moves to `validated` with the source `reproduced`.
- **A finding the pass cannot reproduce** keeps its status, stage, confidence and text. The attempt is recorded with its outcome and the verifier's reason:
  - `not_reproduced`: the test ran and did not show the bug.
  - `not_testable`: no test the configured command runs could exercise it.

  The finding detail lists the attempts. After two unsuccessful attempts the pass stops picking the finding, and the auditor settles it with Confirm or Refute. A finding the verifier gave no answer for records no attempt.
- **Windows and no verification:** a repository whose verification is off is skipped before cloning, with the reason that verification is off and why. No session starts and no usage is spent. Verification is off when the repository has no `test_command`, or on native Windows without `test_command_unsandboxed: true`. With that opt-in, the pass runs the tests unsandboxed, and the log warns as audits do today.
- **Budget:** before each repository's session, the pass applies the same check sweeps use, and stops before a session that would cross `--session-limit` (default 90) or `--weekly-limit` (default 95). The remaining repositories are deferred and the run exits with code 5. Both flags are accepted with `--mode validate` as well as with `--until-covered`.
- **Like a speculative review**, the pass:
  - never advances the audited commit, the per-analyzer commits or the file audit times;
  - never resolves, refutes or reopens a finding;
  - never counts a miss;
  - never refreshes `last_seen`;
  - runs no specialists, so it records no yield.
- **Launching:**
  - `run --mode validate [--repo …] [--max-files n] [--session-limit p] [--weekly-limit p]`. `--analyzers` and `--until-covered` are refused with this mode.
  - In the dashboard, New audit offers the mode Validate. It disables the repositories whose verification is off and says why.
  - The Repository page gains a **Validate detected findings** button. It is shown when verification is on and the repository has open findings at `detected`.
  - A request that leaves no repository with verification on is refused with HTTP 400.
- **Runs and Usage:**
  - The Runs page shows the mode `validate` and, per repository, how many findings were tried, reproduced, not reproduced and not testable.
  - The Usage page lists the session as one row with the mode `validate`. It counts in the 7-day totals and in cost per finding like any other run, and it has no yield and no effect on precision.
  - The report gains a `validation` block, and `summary.md` gains a validation line per repository. Webhooks stay silent, since nothing is new.

## Roadmap stage, security and budget

- **Stage:** validate.
- **Security model:** unchanged in its rules: the same verification worktree, the same exact test command, the same sandbox, and the same native-Windows opt-in (`audit-security`). What changes is how often the rules apply: running tests is this mode's whole purpose. A repository that opted into `test_command_unsandboxed` therefore runs the verifier's tests with the user's rights and network on every validation pass. The README's security model section says so. Nothing is written to the audited repository, to `repos.yaml` or outside the worktree and the `.work/` directory.
- **Subscription usage:** yes, one verifier session per repository with verification on. Three things bound it: the per-repository cap, the per-session `claude.timeout_minutes`, and the sweep budget check before each session. Repositories with verification off cost nothing.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `audit-run`: new `validate` mode and what it leaves untouched; budget flags and their check apply to it; exit code 5 covers a validation budget stop.
- `detection`: the validation session, its candidates in the manifest, and the verifier's verdicts.
- `finding-lifecycle`: what a reproduction and an unsuccessful attempt do to a finding, and the attempt record that outlives the rewritten state.
- `dashboard`: Validate in New audit, the Validate detected findings button, attempts in the finding detail, validation outcomes on the Runs page.
- `reports`: the `validation` block in a report and the validation line in `summary.md`.
- `usage-metrics`: usage rows with the mode `validate`, and the budget estimate before each validation session.
- `state-store`: the database records validation attempts, and the export carries them.

## Impact

- **Code:**
  - Runs: `src/config/analyzers.ts` (mode), `src/commands/run.ts` and `src/cli.ts` (flags), `src/audit/plan.ts` (picking findings), `src/audit/run.ts` (budget check per repository), and `src/audit/repo.ts` (the validation branch).
  - Manifest and session: `src/audit/manifest.ts` and `src/audit/session.ts`.
  - Findings and reports: a new `src/findings/validation.ts` that applies the verdicts, `src/report/types.ts` and `src/report/summary.ts`.
  - State: `src/store/schema.ts`, `src/store/store.ts` and `src/store/backup.ts`.
  - Dashboard: `src/dashboard/actions.ts` and `src/dashboard/api.ts`.
  - Prompts and agents: `.claude/skills/audit/SKILL.md` and `.claude/agents/verifier.md`.
  - Web: `web/src/features/runs/start-audit-dialog.tsx`, `run-panels.tsx`, `web/src/features/repositories/repository-page.tsx` and `web/src/features/findings/finding-detail.tsx`.
- **Database:** one migration adds a `validation_attempts` table.
- **Export format:** a new optional `validation-attempts.json`. The format stays `reposcout/export@1`, and an export without the file restores no attempts.
- **HTTP contract:**
  - `StartRunBody.mode` gains `validate`.
  - A new read-only `GET /api/findings/<repo>/<fingerprint>/validations` serves a finding's attempts.
  - The repository counts gain `to_validate`, the open findings a validation pass would pick.
- **Prompts:** the skill and the verifier change, so the prompt version changes. Precision is split by prompt version, so later rows are told apart from earlier ones.
- **Docs:** the README sections on modes, verification and the security model, the dashboard, and usage.
