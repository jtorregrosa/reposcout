## Context

The dashboard is a React 19 SPA (Vite, React Router 8, TanStack Query 5, shadcn/ui, Tailwind 4). Every page reads one `/api/overview` payload, which the live event stream refreshes instead of polling. See proposal.md for why the whole interface changes. The requirements are in `specs/dashboard/spec.md`.

The code is sound but has grown page by page:
- Every page repeats the same `isLoading` / `error` / `Page` branches.
- Query keys are string literals scattered across `use-actions.ts`, `live.tsx` and the detail sections.
- Counts such as "open findings" are recomputed inline in the layout, the Overview and the Repository page.
- The Findings page holds a window `keydown` listener and nine `useMemo` counters.
- `finding-detail.tsx` (360 lines), `overview-page.tsx` (302) and `run-panels.tsx` (318) each mix data access, derivation and markup.
- The live context value is a fresh object on every render.
- Only `web/src/lib` has tests.

## Goals / Non-Goals

**Goals:**
- Deliver the new interface the spec describes across every page.
- Rest every page on the same patterns, so a page reads as wiring plus presentational pieces and its logic is testable without a DOM.
- Keep every existing contract: endpoints, actions, the action log and the deliberate limits. Old URLs keep working.

**Non-Goals:**
- No server, API, schema or CLI change. Queues, pipelines and bulk actions are derived or orchestrated in the browser from data and actions that already exist.
- No Report or Fix screens. They arrive with their own objects (work items, fix proposals) in later stage changes, and the Fix stage only shows as not available yet.
- No new state library: TanStack Query holds server state, the URL holds view state, and component state holds transient UI.

## Decisions

### 1. Information architecture follows objects, and stages are views

Pages stay one per object: findings, repositories, runs and insights. The lifecycle stages appear as queues in Findings and as a pipeline on the Overview and Repository pages, never as separate pages.

The alternative was one page per stage (Detect, Validate, Report, Fix). It was rejected because:
- a finding would jump between pages as it moves, and sometimes back;
- every page would need the same list, detail and filters;
- search across stages would break;
- two stages would be empty pages today.

### 2. Queues and pipelines are pure derivations

`queueOf(finding)` in `web/src/lib/queues.ts` maps status and stage to a queue:
- `speculative` → triage.
- `open` → triage, to report, reported or closed by stage.
- Anything else → closed.

It is total by construction, and a test over every status × stage pair proves it. `pipeline(findings, repos)` in the same module builds the four stage cards from those queues. The Overview and the Repository page both render it through one `StagePipeline` component, fed the whole set or one repository's findings.

Storing the queue server-side was rejected: it would duplicate state the stage machine already owns and need a migration for no gain.

### 3. URL state goes through typed codecs

`parseFindingsView` / `serializeFindingsView` in `web/src/lib/findings-view.ts` replace `filtersFromParams` and the hand-written setter. They are pure, and a round-trip test pins every key. Legacy mapping lives only in `parse`, and `serialize` writes the new form:
- `status=X` with no `queue` → All plus the status filter X.
- `status=new` → `new=1`.
- `status=all` → All.

`findingsHref(view)` takes the typed view, so every link from the Overview, the Repository page, the matrices and the palette is type-checked against the codec. Small one-key states use a generic `useSearchParam(key, allowed, fallback)` hook:
- the Repository page tab;
- the matrix axis;
- the Runs selection, which stays a path segment.

### 4. Server state: query option factories plus Suspense

`web/src/lib/queries.ts` holds one key registry and these `queryOptions` factories:
- `overviewQuery`
- `findingHistoryQuery`
- `stageHistoryQuery`
- `validationsQuery`
- `runEventsQuery`

Invalidation in `useAction` and the live context uses the registry, for example `queryKeys.finding.all`.

Pages read with `useSuspenseQuery`. The router nests every page under one pathless route with its own `errorElement`, inside a `<Suspense>` in the layout, so loading and failure render inside the shell with the sidebar intact (the Navigation requirement). That removes the six copies of the loading and error branches.

Only `overviewQuery` suspends at page level. Per-finding sections and run events use `useQuery` under an already-rendered header, so one slow request never blanks a page and no waterfall forms.

Route loaders were the alternative. They were rejected for now, because the overview is cached app-wide before any navigation; one can be added later without touching pages.

### 5. Derived data lives in pure selectors

`web/src/lib/selectors.ts` holds:
- `openFindings`
- `repoFindings`
- `queueCounts(findings, view)`
- `facetCounts(findings, view)`: each facet is counted with its own filter released.
- `matrix(findings, axis)`: the existing `severityMatrix`.
- `costHeadline(usage, results, since)`

Pages call them through `useMemo`, or through `useSuspenseQuery({ ...overviewQuery, select })` where a page needs only a slice. The sidebar badge, for instance, selects only the Triage count and re-renders only when it changes.

### 6. Components: a container, then presentational pieces

Each feature has one container that reads hooks and passes plain props. Presentational components take data and callbacks only.

- **Findings**:
  - `QueueTabs`
  - `FilterBar` with `FilterChips`
  - `BulkBar`
  - `FindingList`
  - `FindingDetail`, split into `FindingHeader`, `NextStepBar`, `FindingNotices` and three tab components
  - `NotABugDialog`
  - `ConfirmDialog`
  - `TriageActions`
- **Shared**:
  - `StagePipeline`
  - `MatrixCard`, with its axis switch, replacing `KindMatrixCard` plus the category card
  - `NewAuditDialog`, preset by props
  - `RunLaunchDialog`, the confirm step used by Validate and Review speculative
- **Runs**: `RunHistoryList` plus one file per panel.
- **App shell**:
  - `AppSidebar`
  - `HeaderBreadcrumbs`, built from route `handle.crumb`
  - `RunIndicator` with its popover
  - `CommandPalette`
  - `ShortcutsDialog`

`availableActions(finding)` in `web/src/lib/actions.ts` is the one source for which decide and suppress verdicts a finding allows. The Next step bar, the shortcuts, the Not a bug dialog and the bulk bar, which intersects it across the selection, all read it.

### 7. Bulk Not a bug runs the existing actions sequentially

The bulk bar calls `decide` or `suppress` once per selected finding, in sequence, and collects each outcome. It invalidates queries once at the end, then shows one summary: N done, plus each refused finding with its error.

Sequential, not parallel, because every suppression rewrites repos.yaml atomically on the server. Parallel writes would race to 409 or 500 for no gain at the sizes an auditor selects. A batch endpoint was rejected: it would add a new write path to the security model for a convenience the existing guarded actions already give.

A failure stops nothing: the remaining findings still run. Each call is logged by the server as today.

The selection lives in component state keyed by fingerprint, and is pruned whenever the listed findings change (the Selection and filters scenario).

### 8. Contextual launches reuse New audit

`NewAuditDialog` takes `preset` (repositories, mode) and opens from:
- the Runs page;
- the Overview;
- the Repository page;
- a Repositories row;
- the command palette.

The mode labels move to `MODE_LABEL` in `web/src/lib/domain.ts` as the plain wording the spec gives, and the CLI values stay as they are.

Validate and Review speculative from Triage, the Overview or a repository use `RunLaunchDialog`. It states:
- the repositories, computed from the scope;
- how many findings will be tried, with the CLI caps of 10 per repository for validate and 30 for speculative;
- that the pass spends subscription usage and stops at the session limit.

It then posts the same `startRun` body New audit posts.

### 9. One hotkeys hook and one palette

`useHotkeys(map, { enabled, allowInFields })` owns the guards: typing in a field, an open dialog and a modifier key. It registers one listener per mounted caller and reads the latest handlers through a ref. `Ctrl+K` and `⌘K` are registered with `allowInFields`, and the other keys are not.

A registry module lists every shortcut with its group and description. The `?` dialog renders that registry, and the hooks bind from it, so the list cannot drift from the bindings.

The palette uses shadcn's `command` component (`cmdk`). It searches over pages, repositories and findings from the cached overview, with no request per keystroke. A dependency was chosen here because fuzzy ranking, keyboard handling and accessibility of a combobox list are what `cmdk` provides, and shadcn already styles it with the theme tokens.

### 10. Live context split and memoized

`LiveProvider` exposes two memoized contexts:
- connection, which changes rarely;
- run state, which changes per animation frame during a run.

The sidebar dot and the palette read only the first. `useLive()` stays as a convenience that reads both.

### 11. Insights replaces Usage with a redirect

The route `/insights` renders the former Usage content plus a cost headline and `CoverageSummary`, which moves from the Repositories page header. The per-repository coverage column and the Count audits since control stay on Repositories. `/usage` is a route whose loader redirects to `/insights`, keeping any query.

### 12. Tests: unit for lib, components under jsdom

`vitest.config.ts` gains `projects`:
- the existing node project;
- a `web` project for `web/src/**/*.test.tsx` with jsdom and a setup file that registers the Testing Library cleanup.

A `renderWithProviders` helper seeds a `QueryClient` with a fixture overview and mounts a memory router. Tests drive the UI through roles and labels with `user-event`, and stub `fetch` for actions. Each spec scenario that the browser alone decides is covered by one component test. Scenarios that run the CLI, such as validate and speculative launches, assert the posted `startRun` body, which existing server tests already map to CLI arguments.

### 13. Visual language

The tokens in `web/src/index.css` stay the only source of colour, and no raw value enters a component.

- **Stage colours.** Stages get one token each (`--stage-detected`, `--stage-validated`, `--stage-reported`, `--stage-fixed`), shared by the pipeline, the progress bar and the queue tabs. The Fix stage renders muted while it is not available.
- **Severity.** It keeps its existing tokens and stays the dominant colour on a finding.
- **Empty states.** Every empty state names what would fill it and how to get there.

## Risks / Trade-offs

- **Auditors used to the Open tab land on Triage.** A finding they expected under Open may sit in To report. → Each queue tab carries a tooltip with its definition, and All is one click away. README documents the mapping.
- **A large change touching every page.** → Tasks go page by page, each ending green on its component tests and checked in the browser against a copy of the database, with before-screenshots to compare unchanged parts.
- **Bulk Not a bug on many findings is slow and can half-fail.** → Progress shows in the bar, every outcome is reported, and the action log has each call. Nothing is rolled back, matching how the single actions behave.
- **Single-letter shortcuts can fire by accident.** → `C` and `X` only open a dialog that still needs a reason. `O` is harmless. `Space` only toggles selection.
- **New dependencies.** → `cmdk` is small, maintained and already part of shadcn's set. The test libraries are dev-only. Every version is pinned exactly.
- **Repository page tabs hide content that was visible at once.** → The pipeline and actions stay above the tabs, the tab is kept in the URL, and Findings is the default tab.

## Migration Plan

There is no data migration, and the database schema is unchanged. A failed or cancelled run cannot leave partial state through this change, since it adds no write path. Bulk actions reuse the single, atomic server actions, and a half-finished bulk leaves each finding in a valid state of its own.

Old URLs keep working: `?status=` links resolve through the codec, and `/usage` redirects. Rolling back is reverting the commit.
