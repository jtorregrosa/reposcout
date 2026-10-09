## 1. Foundations

- [ ] 1.1 Add `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom` and `jsdom` as exact dev dependencies, and split `vitest.config.ts` into a node project and a `web` jsdom project for `web/src/**/*.test.tsx` with a setup file
- [ ] 1.2 Add the `renderWithProviders` test helper and a fixture overview covering every status, stage, verification state and a run in progress
- [ ] 1.3 Capture before-screenshots of every page against a copy of `state/reposcout.db` under `REPOSCOUT_HOME`
- [ ] 1.4 Add the stage colour tokens to `web/src/index.css` for light and dark themes

## 2. Shared patterns

- [ ] 2.1 Create `web/src/lib/queries.ts` (key registry and `queryOptions` factories) and move `use-overview`, `use-actions`, `live.tsx`, the stage timeline, the history and the validation attempts onto it
- [ ] 2.2 Create `web/src/lib/selectors.ts` (open and repository findings, queue counts, facet counts, matrix, cost headline) with unit tests
- [ ] 2.3 Add `queueOf` and `pipeline` in `web/src/lib/queues.ts`, with a test proving every status × stage pair maps to exactly one queue
- [ ] 2.4 Add `availableActions(finding)` in `web/src/lib/actions.ts` with tests mirroring the decide and suppress rules, plus the intersection used for a selection
- [ ] 2.5 Add the findings view codec, with round-trip and legacy-link tests, and the generic `useSearchParam` hook. Rebuild `useFindingFilters` and `findingsHref` on them
- [ ] 2.6 Add `useHotkeys` and the shortcut registry, with a component test of the field, dialog and modifier guards
- [ ] 2.7 Split `LiveProvider` into memoized connection and run-state contexts, keeping `useLive()`

## 3. App shell

- [ ] 3.1 Restructure the router: a pathless page route with its own `errorElement` under a `<Suspense>` in the layout, route `handle.crumb` for breadcrumbs, `/insights`, and the `/usage` redirect. Switch every page to `useSuspenseQuery` and drop its loading and error branches
- [ ] 3.2 Rebuild the sidebar (Work and Operate groups, Triage badge via a selector, live dot) and the header (breadcrumbs, run indicator popover with per-repository progress and Cancel run)
- [ ] 3.3 Build `CommandPalette` (shadcn `command`, exact `cmdk` version), with pages, repositories, findings by title or fingerprint, New audit and theme, opened with `Ctrl+K` / `⌘K`
- [ ] 3.4 Build `ShortcutsDialog` from the registry, opened with `?` and from the palette
- [ ] 3.5 Component tests:
  - the Triage badge;
  - breadcrumbs on a repository;
  - an error inside the shell;
  - the palette jumping to a finding and opening from a field;
  - `?` listing the shortcuts;
  - the `/usage` redirect.

## 4. Shared feature components

- [ ] 4.1 Build `StagePipeline`, including the muted Fix stage, and `MatrixCard`, with its category/type switch kept in the URL. Remove `KindMatrixCard` and the separate category card
- [ ] 4.2 Turn `StartAuditDialog` into `NewAuditDialog`, with a `preset` prop and the plain mode labels in `MODE_LABEL`
- [ ] 4.3 Build `RunLaunchDialog` for Validate detected findings and Review speculative candidates. It states the repositories, the findings tried, and the subscription usage and session limit. Replace `ValidateButton` with it
- [ ] 4.4 Component tests:
  - the pipeline counts and links;
  - the preset New audit;
  - the `startRun` bodies posted by validate and speculative launches;
  - both disabled while a run holds the lock.

## 5. Findings

- [ ] 5.1 Build `QueueTabs`, with counts and definition tooltips, and the Discarded by verifier link beside them
- [ ] 5.2 Build `FilterBar` (search, repository, severity and sort visible; one Filters menu for type, category, stage, status, new and personal data) and `FilterChips`
- [ ] 5.3 Build `TriageActions` on the Triage queue
- [ ] 5.4 Add selection to `FindingList` (checkbox, `Space`, shift-click range, pruned on filter change) and `BulkBar`:
  - Export selection;
  - Copy for tickets;
  - bulk Not a bug, run sequentially with a progress and outcome summary.
- [ ] 5.5 Split the detail into `FindingHeader` (with the stage progress bar), `FindingNotices`, `NextStepBar` with a More menu, and the Overview, Evidence and History tabs bound to `tab`
- [ ] 5.6 Build `NotABugDialog` and `ConfirmDialog` from `availableActions`, replacing `DecideDialog` and `SuppressDialog`
- [ ] 5.7 Register `J`/`K`/arrows, `Space`, `/`, `Esc`, `C`, `X` and `O` through the registry, and update the empty-detail hint
- [ ] 5.8 Component tests:
  - queue tabs and counts;
  - legacy `status=resolved` and `status=new` links;
  - chip removal;
  - Not a bug options for a speculative, an undecided open and a confirmed finding;
  - bulk refute of three candidates, a mixed selection and a partial failure;
  - `X` opening the dialog and `C` doing nothing on a resolved finding;
  - the tab kept across `J`.

## 6. Overview

- [ ] 6.1 Rebuild the Overview: failures alert, `StagePipeline` with its actions, Needs attention, run and subscription cards, `MatrixCard`. Drop the stat cards and the repositories table
- [ ] 6.2 Component tests: opening a stage, the Fix stage not linking, the matrix axis switch keeping totals, and nothing critical or high

## 7. Repositories

- [ ] 7.1 Rebuild the Repositories table, with Triage and To report counts, open by severity, coverage with runs left, last audit, health and a row menu (Audit this repository, Validate detected findings). Keep Count audits since, and move the all-repositories coverage summary to Insights
- [ ] 7.2 Rebuild the Repository page: header actions, a scoped `StagePipeline`, the verification notice, and the tabs Findings, Coverage, Runs and Configuration kept in the URL
- [ ] 7.3 Component tests: auditing from a row, the Triage count link, no `test_command`, no sandbox, an unknown repository, and the tab surviving a reload

## 8. Runs

- [ ] 8.1 Build `RunHistoryList` beside the selected run, with the run kept in the path, and split `run-panels.tsx` into one file per panel on `runEventsQuery`
- [ ] 8.2 Component tests: picking a past run updates the URL and replays it, and a run in progress is listed first and marked live

## 9. Insights

- [ ] 9.1 Move the Usage page to `web/src/features/insights/`, adding the cost headline and the coverage summary with Count audits since
- [ ] 9.2 Component test: the repository filter narrows the rows, totals and headline

## 10. Documentation and verification

- [ ] 10.1 Update the README dashboard section:
  - the pages table (Overview, Findings, Repositories, Repository, Runs, Insights);
  - the actions table (New audit presets, Validate and Review from Triage, bulk Not a bug, Suppress, Confirm/Refute);
  - keyboard shortcuts and the command palette;
  - the Discarded candidates reference.
- [ ] 10.2 Compare every page with the before-screenshots and check in the browser against a copy of the database: each queue, a legacy link, a refute, a suppress, a bulk refute, the palette, the shortcuts and `/usage`
- [ ] 10.3 Run `pnpm verify`
