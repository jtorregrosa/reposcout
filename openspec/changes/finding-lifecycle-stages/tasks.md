## 1. Stage model

- [x] 1.1 Add `src/findings/stage.ts` with the ordered stages, the sources and the pure transition function described in design.md, plus the `Stage`, `StageSource` and `StageEvent` types
- [x] 1.2 Add `test/stage.test.ts` covering every transition in the finding-lifecycle delta: initial stages, reproduction, auditor confirmation, withdrawal (including after a reproduction), resolution, reopening to the earlier stage and to `detected`, frozen stage on suppressed, refuted and duplicate, and `reported` never reached

## 2. Database

- [x] 2.1 Append a migration to `src/store/schema.ts` that creates `finding_stages` and `finding_stage_events` and assigns initial stages with the source `upgrade` to existing findings, in SQL
- [x] 2.2 Compute and record stages in `writeRepoState`, in its transaction: initial stage for new fingerprints, transitions for existing ones, and deletion of the current stage for fingerprints that leave the state
- [x] 2.3 Compute and record stages in `decide` and `undecide`, with the auditor as actor and no run id
- [x] 2.4 Add store reads for the current stages of a repository and for one finding's stage history
- [x] 2.5 Extend `test/store.test.ts` and `test/triage.test.ts`: the upgrade from the previous schema version assigns `fixed`, `validated` and `detected` with one `upgrade` event each, a rewrite keeps the stage, a leaving fingerprint drops it, the legacy import records `initial` stages, and decide/undecide record their stage events

## 3. Export

- [x] 3.1 Write `finding-stages.json` with every stage event in `db export` (`src/commands/db.ts`)
- [x] 3.2 Cover it in the existing `db export` test, or add one

## 4. Dashboard API

- [x] 4.1 Add `stage`, `stage_since` and `stage_source` to `FindingView`, and export the stage types from `src/dashboard/api.ts`
- [x] 4.2 Fill them where the overview builds `FindingView` (`src/dashboard/overview.ts`)
- [x] 4.3 Serve `GET /api/findings/:repo/:fingerprint/stages` in `src/dashboard/server.ts`, behind the existing guards, and add the client call in `web/src/lib/api.ts`
- [x] 4.4 Add a dashboard server test for the endpoint, including an unknown fingerprint and a request failing the guards

## 5. Web app

- [x] 5.1 Add stage labels and help text to `web/src/lib/domain.ts`
- [x] 5.2 Add `stages` to `FindingFilters`, `matchesScope`, `describeScope` and the URL handling in `use-finding-filters.ts` (`stage` parameter, unknown values ignored), and to `findingsHref`
- [x] 5.3 Add the stage control to `finding-filters.tsx`, using the same component pattern as the severity filter
- [x] 5.4 Add the stage timeline component and render it in `finding-detail.tsx`, using theme tokens only; add a stage token per stage in `web/src/index.css` only if the existing tokens do not fit
- [x] 5.5 Extend `web/src/lib/findings.test.ts` for the stage filter, its effect on status-tab counts, and the URL parsing

## 6. Documentation and verification

- [x] 6.1 Update README.md: the finding fields and statuses in "The database", the Findings page row (stage filter and timeline), `db export` contents, and a short explanation of stages versus statuses
- [x] 6.2 Run `openspec validate finding-lifecycle-stages --strict`
- [x] 6.3 Run `pnpm verify` and fix anything it reports, then run it again in full
