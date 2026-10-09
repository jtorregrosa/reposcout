## 1. Foundations

- [x] 1.1 Add `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom` and `jsdom` as exact dev dependencies, and split `vitest.config.ts` into a node project and a `web` jsdom project for `web/src/**/*.test.tsx` with a setup file
- [x] 1.2 Add the `renderWithProviders` test helper and a fixture overview covering every status, stage, verification state and a run in progress
- [x] 1.3 Prepare a copy of `state/reposcout.db`, `repos.yaml` and `reports/` under a scratch `REPOSCOUT_HOME` to check the pages against (every page changes, so there is no before to compare with)
- [x] 1.4 Add the stage colour tokens to `web/src/index.css` for light and dark themes

## 2. Shared patterns

- [x] 2.1 Create `web/src/lib/queries.ts` (key registry and `queryOptions` factories) and move `use-overview`, `use-actions`, `live.tsx`, the stage timeline, the history and the validation attempts onto it
- [x] 2.2 Create `web/src/lib/selectors.ts` (open and repository findings, queue counts, facet counts, matrix, cost headline) with unit tests
- [x] 2.3 Add `queueOf` and `pipeline` in `web/src/lib/queues.ts`, with a test proving every status × stage pair maps to exactly one queue
- [x] 2.4 Add `availableActions(finding)` in `web/src/lib/actions.ts` with tests mirroring the decide and suppress rules, plus the intersection used for a selection
- [x] 2.5 Add the findings view codec, with round-trip and legacy-link tests, and the generic `useSearchParam` hook. Rebuild `useFindingFilters` and `findingsHref` on them
- [x] 2.6 Add `useHotkeys` and the shortcut registry, with a component test of the field, dialog and modifier guards
- [x] 2.7 Split `LiveProvider` into memoized connection and run-state contexts, keeping `useLive()`

## 3. App shell

- [x] 3.1 Restructure the router: a pathless page route with its own `errorElement` under a `<Suspense>` in the layout, route `handle.crumb` for breadcrumbs, `/insights`, and the `/usage` redirect. Switch every page to `useSuspenseQuery` and drop its loading and error branches
- [x] 3.2 Rebuild the sidebar (Work and Operate groups, Triage badge via a selector, live dot) and the header (breadcrumbs, run indicator popover with per-repository progress and Cancel run)
- [x] 3.3 Build `CommandPalette` (shadcn `command`, exact `cmdk` version), with pages, repositories, findings by title or fingerprint, New audit and theme, opened with `Ctrl+K` / `⌘K`
- [x] 3.4 Build `ShortcutsDialog` from the registry, opened with `?` and from the palette
- [x] 3.5 Component tests:
  - the Triage badge;
  - breadcrumbs on a repository;
  - an error inside the shell;
  - the palette jumping to a finding and opening from a field;
  - `?` listing the shortcuts;
  - the `/usage` redirect.

## 4. Shared feature components

- [x] 4.1 Build `StagePipeline`, including the muted Fix stage, and `MatrixCard`, with its category/type switch kept in the URL. Remove `KindMatrixCard` and the separate category card
- [x] 4.2 Turn `StartAuditDialog` into `NewAuditDialog`, with a `preset` prop and the plain mode labels in `MODE_LABEL`
- [x] 4.3 Build `RunLaunchDialog` for Validate detected findings and Review speculative candidates. It states the repositories, the findings tried, and the subscription usage and session limit. Replace `ValidateButton` with it
- [x] 4.4 Component tests:
  - the pipeline counts and links;
  - the preset New audit;
  - the `startRun` bodies posted by validate and speculative launches;
  - both disabled while a run holds the lock.

## 5. Findings

- [x] 5.1 Build `QueueTabs`, with counts and definition tooltips, and the Discarded by verifier link beside them
- [x] 5.2 Build `FilterBar` (search, repository, severity and sort visible; one Filters menu for type, category, stage, status, new and personal data) and `FilterChips`
- [x] 5.3 Build `TriageActions` on the Triage queue
- [x] 5.4 Add selection to `FindingList` (checkbox, `Space`, shift-click range, pruned on filter change) and `BulkBar`:
  - Export selection;
  - Copy for tickets;
  - bulk Not a bug, run sequentially with a progress and outcome summary.
- [x] 5.5 Split the detail into `FindingHeader` (with the stage progress bar), `FindingNotices`, `NextStepBar` with a More menu, and the Overview, Evidence and History tabs bound to `tab`
- [x] 5.6 Build `NotABugDialog` and `ConfirmDialog` from `availableActions`, replacing `DecideDialog` and `SuppressDialog`
- [x] 5.7 Register `J`/`K`/arrows, `Space`, `/`, `Esc`, `C`, `X` and `O` through the registry, and update the empty-detail hint
- [x] 5.8 Component tests:
  - queue tabs and counts;
  - legacy `status=resolved` and `status=new` links;
  - chip removal;
  - Not a bug options for a speculative, an undecided open and a confirmed finding;
  - bulk refute of three candidates, a mixed selection and a partial failure;
  - `X` opening the dialog and `C` doing nothing on a resolved finding;
  - the tab kept across `J`.

## 6. Overview

- [x] 6.1 Rebuild the Overview: failures alert, `StagePipeline` with its actions, Needs attention, run and subscription cards, `MatrixCard`. Drop the stat cards and the repositories table
- [x] 6.2 Component tests: opening a stage, the Fix stage not linking, the matrix axis switch keeping totals, and nothing critical or high

## 7. Repositories

- [x] 7.1 Rebuild the Repositories table, with Triage and To report counts, open by severity, coverage with runs left, last audit, health and a row menu (Audit this repository, Validate detected findings). Keep Count audits since, and move the all-repositories coverage summary to Insights
- [x] 7.2 Rebuild the Repository page: header actions, a scoped `StagePipeline`, the verification notice, and the tabs Findings, Coverage, Runs and Configuration kept in the URL
- [x] 7.3 Component tests: auditing from a row, the Triage count link, no `test_command`, no sandbox, an unknown repository, and the tab surviving a reload

## 8. Runs

- [x] 8.1 Build `RunHistoryList` beside the selected run, with the run kept in the path, and split `run-panels.tsx` into one file per panel on `runEventsQuery`
- [x] 8.2 Component tests: picking a past run updates the URL and replays it, and a run in progress is listed first and marked live

## 9. Insights

- [x] 9.1 Move the Usage page to `web/src/features/insights/`, adding the cost headline and the coverage summary with Count audits since
- [x] 9.2 Component test: the repository filter narrows the rows, totals and headline

## 10. Documentation and verification

- [x] 10.1 Update the README dashboard section:
  - the pages table (Overview, Findings, Repositories, Repository, Runs, Insights);
  - the actions table (New audit presets, Validate and Review from Triage, bulk Not a bug, Suppress, Confirm/Refute);
  - keyboard shortcuts and the command palette;
  - the Discarded candidates reference.
- [x] 10.2 Check every page in the browser against the copy of the database: the queues, the detail and its shortcuts, the palette and `/usage`; refute, suppress and bulk refute are proved by the component tests against the stubbed API
- [x] 10.3 Run `pnpm verify`
