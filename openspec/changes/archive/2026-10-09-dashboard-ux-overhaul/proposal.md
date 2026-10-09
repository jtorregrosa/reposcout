## Why

The dashboard grew page by page as each roadmap stage shipped, and it shows:
- The pages report data rather than guide work, so the auditor has to work out what to do next.
- The four stages a finding moves through (detect, validate, report, fix) appear nowhere as a whole.
- Findings asks the auditor to think in nine raw status tabs plus a separate stage filter.
- Actions of very different weight sit side by side.
- Runs that serve validation are launched from a generic "mode" dialog far from the findings they act on.

The code repeats loading and error handling, query keys and derived counts on every page. Now that every finding carries a lifecycle stage, the whole application can be organized around that lifecycle and what it asks of the auditor.

## What Changes

**Navigation and global elements**
- The sidebar groups pages into Work (Overview, Findings, Repositories) and Operate (Runs, Insights). Findings carries the Triage count and Runs a live dot.
- The header shows breadcrumbs. The run indicator opens a popover with each repository's progress and Cancel run.
- A command palette (`Ctrl+K` / `⌘K`) jumps to any page, repository or finding by title or fingerprint, starts New audit and switches the theme.
- `?` opens a list of every keyboard shortcut.
- **BREAKING (dashboard)**: the Usage page becomes Insights at `/insights`, and `/usage` redirects there.

**Overview**
- A pipeline of the four stages leads the page:
  - Detect: open findings and new ones from the last run, with New audit.
  - Validate: the Triage count, with Validate and Review speculative.
  - Report: the To report count, with Export.
  - Fix: shown as not available yet, with no link.

  Each stage opens its queue in Findings.
- Needs attention, the run card and the subscription card stay. The two matrices merge into one with a Category / Type switch. The repositories table leaves the Overview, and the failed-repositories alert stays.

**Findings**
- **BREAKING (dashboard)**: the status tabs give way to work queues derived from status and stage:
  - Triage (default): speculative candidates and open findings at `detected`.
  - To report: open at `validated`.
  - Reported: open at `reported`.
  - Closed: everything else.
  - All: every finding.

  The raw status and "new in the last run" become filters. Discarded by verifier moves to a link beside the queues.
- The filter bar shows search, repository, severity and sort. The other filters move to one Filters menu with removable chips.
- Old links with `status=` keep working.
- The Triage queue offers Validate detected findings and Review speculative candidates for its scope, with what the pass will try and its subscription cost stated first.
- The list gains selection, by checkbox, `Space` and shift-click. A bulk bar offers Export selection, Copy for tickets and Not a bug for every selected finding.
- The finding detail leads with a Next step bar that matches its queue, with secondary actions in a More menu.
- One "Not a bug…" dialog offers Refute (a decision in the database) or Suppress (permanent, in repos.yaml).
- The detail body splits into the tabs Overview, Evidence and History, with a compact stage progress bar in the header.
- Shortcuts `C`, `X` and `O` act on the selected finding.

**Repositories**
- The Repositories table shows per repository its Triage and To report counts beside open by severity, coverage, last audit and health.
- A row menu offers Audit this repository and, where verification is on, Validate detected findings.
- The Repository page opens with the same stage pipeline scoped to the repository, plus Audit this repository, Validate detected findings and Review findings. Its matrices merge as on the Overview, and its sections become the tabs Findings, Coverage, Runs and Configuration.

**Runs**
- The run picker becomes a history list beside the run: date, mode, status and duration. The panels of the selected run show to its right.
- New audit opens from the Runs page, the Overview, the Repository page and the command palette, preset to its context. Its options are described in plain words: "Changes since the last audit", "Whole repository", "Settle speculative candidates", "Reproduce detected findings with a test".

**Insights** (formerly Usage)
- The same content: cost per run, 7-day totals, yield and precision. It gains a cost-per-finding headline and coverage across repositories, which moves here from the Repositories page header.

**Code**
- The whole dashboard moves onto one set of React patterns:
  - Query option factories with one key registry.
  - Suspense data loading with a route-level error boundary inside the shell.
  - Pure, tested selectors for every derived count.
  - A typed URL-state codec.
  - A shared hotkeys hook.
  - Container and presentational components.
  - Memoized split live contexts.
  - Component tests with Testing Library.

Roadmap stage: platform (dashboard UX).

Security model: the change adds no endpoint and no new write.
- Bulk Not a bug calls the existing decide and suppress actions once per finding, so each passes the same guards and lands in the action log.
- The contextual launches call the existing New audit action.
- The dashboard's deliberate limits are unchanged.

Subscription usage: the change spends none by itself. Validate, Review speculative and Audit this repository start the same runs New audit starts today, only from more places. Each says before starting what it will try and that it spends subscription usage, and keeps the existing session limit.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `dashboard`: the Overview, Findings, Repositories, Repository, Runs and Usage (now Insights) page requirements change. New requirements cover navigation, the command palette, the shortcut list, work queues, bulk actions, contextual launches, the Next step bar, the Not a bug dialog and the detail tabs. The decide, suppress, New audit, Validate detected findings and keyboard requirements change where these offer them.

## Impact

- `web/src/**`: every page, the layout, router and live context, the shared hooks and components.
- New dependencies, pinned exactly:
  - runtime: `cmdk`, through shadcn's `command` component;
  - development: `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom` and `jsdom`.
- `vitest.config.ts` gains a jsdom project for `web/src/**/*.test.tsx`.
- No change to `src/dashboard/api.ts`, the server, the database schema or the CLI.
- README.md: the dashboard section, its pages and actions tables, and the Discarded candidates reference.
