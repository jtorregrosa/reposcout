# usage-metrics Specification

## Purpose
Defines what RepoScout records about each Claude run and what it derives from it: the usage row per run (with the prompt version defined by the detection capability), usage-limit detection, precision of what people kept, yield and cost per analyzer, cost per finding, and the subscription budget estimate that sweeps and backfills consult. How the Usage page lays these out belongs to the dashboard capability, and when a sweep stops belongs to audit-run.

## Requirements

### Requirement: Usage recorded for every Claude run
RepoScout SHALL record one usage row in `state/reposcout.db` for every audit's Claude session that ran, whether it succeeded, failed, timed out or hit the usage limit, with date and time, repository, mode, analyzers, number of files, whether it succeeded, the terminal reason, the run id, the prompt version and the specialists model.

#### Scenario: Timed-out session
- **WHEN** a Claude session is killed at its timeout
- **THEN** a usage row is still recorded for it with `ok` false

#### Scenario: Prepare-only
- **WHEN** `run --prepare-only` runs
- **THEN** no usage row is recorded, since no Claude session starts

### Requirement: Usage figures per run
Each usage row and each report's `usage` SHALL carry `duration_ms`, `wall_ms`, `num_turns` summed over every orchestrator wake-up, `cost_usd_equivalent`, tokens per model (input including cache reads and writes, and output), subagent launches per type, `subagent_runs`, tokens per subagent type, the number of permission denials and `window_cost`; a figure Claude did not report is null.

#### Scenario: Result without cost
- **WHEN** Claude's final result reports no total cost
- **THEN** `cost_usd_equivalent` is null for that run

### Requirement: Subscription window readings
RepoScout SHALL record with each run the latest subscription usage reading Claude reported (5-hour and weekly window use, status and reset time), and as `window_cost` the change in each window between the first and last reading of the session, or null when the window reset in between.

#### Scenario: Window reset during a session
- **WHEN** the first and last readings of a session have different reset times
- **THEN** that run's `window_cost` is null

### Requirement: Cost is an API equivalent
`cost_usd_equivalent` SHALL be the cost Claude reports the run would have had through the API; it MUST NOT be presented as a charge, since a subscription is not billed per run.

#### Scenario: Subscription run
- **WHEN** a run authenticated with a subscription reports a cost
- **THEN** it is stored and shown as `cost_usd_equivalent`

### Requirement: Usage limit detection
RepoScout SHALL treat a Claude session as having hit the subscription usage limit when the API error status is 429 or, for a session that did not succeed, when the latest subscription status is anything other than allowed or its result, errors or stderr mention a usage or rate limit, a reset, too many requests or being out of usage; such a repository is deferred and the run exits with code 3 (see audit-run).

#### Scenario: Rejected status
- **WHEN** a failed session's latest reading has a status that does not start with `allowed`
- **THEN** the repository is deferred with "subscription usage limit reached" as its error

#### Scenario: Successful session mentioning limits
- **WHEN** a session succeeds without error and its text mentions a rate limit
- **THEN** it is not treated as having hit the usage limit

### Requirement: Precision definitions
Precision SHALL count a finding as kept when it reached open at some point (resolved later still counts) and is not suppressed or refuted, and as dismissed when it is suppressed or was refuted after being speculative; precision is kept / (kept + dismissed), and candidates still speculative count in neither. Suppressions are read from `repos.yaml`, so a pending suppression counts already.

#### Scenario: Resolved finding
- **WHEN** a finding was open and later resolved
- **THEN** it counts as kept

#### Scenario: Pending suppression
- **WHEN** an auditor suppresses a finding in `repos.yaml` and no run has updated the database since
- **THEN** precision counts it as dismissed

### Requirement: Precision dimensions and samples
Precision SHALL be given per analyzer, per specialists model and per prompt version, over every finding people have judged, optionally for one repository; each finding counts for the run that first recorded it, findings with no such run show as not recorded, counts stay beside each percentage, and a row with fewer than 10 judged findings is marked.

#### Scenario: Small sample
- **WHEN** a prompt version has 3 kept and 1 dismissed finding
- **THEN** its row shows 75% marked as "4 judged"

#### Scenario: Imported findings
- **WHEN** a finding was imported from the earlier JSON state
- **THEN** its model and prompt version show as not recorded

### Requirement: Yield per analyzer recorded per run
For every audit outside a speculative review, RepoScout SHALL record each selected analyzer's yield in the database and the report: specialist instances, candidates proposed, kept, speculative and discarded counts, tokens, and cost; a speculative review records no yield.

#### Scenario: Speculative review
- **WHEN** a run in speculative mode completes
- **THEN** no yield is recorded for it

### Requirement: Candidates read from specialist replies
An analyzer's candidates SHALL be counted from its specialists' own replies; when any reply is not parseable JSON the count is unknown, unless the orchestrator reported a whole, non-negative count for that analyzer, which then stands in.

#### Scenario: Unparseable reply
- **WHEN** one of an analyzer's specialist replies is not JSON and the orchestrator gave no count
- **THEN** that analyzer's candidates for the run is null

### Requirement: Crediting kept, speculative and discarded
Kept and speculative counts SHALL credit each analyzer whose specialists the verifier names in `specialists`, or the finding's category when it names none, and discarded counts SHALL credit only the named specialists; a candidate several specialists proposed counts for each of them.

#### Scenario: Two specialists propose one finding
- **WHEN** a kept finding names both the security and logic specialists
- **THEN** it counts as kept for security and for logic

### Requirement: Proportional cost per analyzer
An analyzer's cost in a run SHALL be the run's `cost_usd_equivalent` multiplied by the analyzer's share of the run's tokens, capped at the whole cost and rounded to four decimals, or null when tokens or cost are unknown.

#### Scenario: Quarter of the tokens
- **WHEN** an analyzer's specialists used a quarter of a run's tokens and the run cost 2.00
- **THEN** that analyzer's cost for the run is 0.5

### Requirement: Seven-day totals and yield
The dashboard SHALL sum usage, cost and yield per analyzer over the last 7 days, optionally for one repository, where an analyzer's candidates sum only the runs whose count is known and the rest are counted as unparsed.

#### Scenario: Older run excluded
- **WHEN** a run happened 8 days ago
- **THEN** it is not in the 7-day totals or yield

### Requirement: Cost per finding
Over the last 7 days, cost per new finding SHALL be the total `cost_usd_equivalent` divided by the new confirmed findings (new, reopened or promoted) plus new speculative candidates, and cost per confirmed finding the total divided by the new confirmed findings; every run counts, including ones that found nothing or failed, and a ratio with a zero denominator is empty.

#### Scenario: Run that found nothing
- **WHEN** two runs cost 1.00 each and only one reported 2 new confirmed findings
- **THEN** the cost per confirmed finding is 1.00

### Requirement: Budget estimate for sweeps and backfills
Before each sweep pass or backfill batch, RepoScout SHALL take the latest subscription reading whose window has not reset, add the measured cost of the previous pass, or 8% of the 5-hour window and 2% of the weekly one before any was measured, and refuse to start when the 5-hour sum exceeds the session limit (default 90%) or the weekly sum the weekly limit (default 95%).

#### Scenario: First pass without a reading
- **WHEN** no current subscription reading exists
- **THEN** the pass proceeds, since it measures usage

#### Scenario: Estimate would cross the session limit
- **WHEN** the 5-hour window is at 85% and no pass has been measured
- **THEN** the next pass is not started because 85% + 8% exceeds 90%

#### Scenario: Status not allowed
- **WHEN** the latest reading's status does not start with `allowed`
- **THEN** the next pass is not started
