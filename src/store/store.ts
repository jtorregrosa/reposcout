import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { ANALYZERS, type Analyzer } from '../config/analyzers.js';
import { nextStage, type Stage, type StageChange, type StageEvent, type StageState, withdrawnStage } from '../findings/stage.js';
import type { Finding, FindingEntry, FindingStatus, FindingsState, Kind, Repro } from '../findings/types.js';
import type { AnalyzerYield, Failures, RepoReport, RunResult, YieldRow } from '../report/types.js';
import type { AuditsByAnalyzer, Census, Decision, FindingEvent, IssueLink, LabelOverride, RepoState, UsageRow, ValidationAttempt } from '../state/types.js';
import { MIGRATIONS } from './schema.js';

// What precision needs to know of one finding: how it ended and which run first proposed it, with that run's
// prompts and specialist model when its report recorded them.
export interface PrecisionFact {
  repo: string;
  fingerprint: string;
  status: FindingStatus;
  category: string;
  ever_open: boolean;
  prompt_version: string | null;
  model: string | null;
}

export interface DatedReport {
  date: string;
  run: string | null;
  r: RepoReport;
}

interface RepoRow {
  name: string;
  branch: string;
  fingerprint_version: number | null;
  last_commit: string | null;
  last_run_at: string | null;
  last_full_run_at: string | null;
  last_speculative_review_at: string | null;
  eligible_files: number | null;
  unread_once: string;
  unread_once_by_analyzer: string | null;
}

interface FindingRow {
  fingerprint: string;
  status: FindingStatus;
  first_seen: string;
  last_seen: string;
  reason: string | null;
  resolved_at: string | null;
  refuted_at: string | null;
  resolution: string | null;
  review_note: string | null;
  status_before_suppression: FindingStatus | null;
  missed_runs: number;
  reopened_at: string | null;
  finding: string;
}

// SQLite keeps NULL where the JSON state had no key; reading leaves the key out again, so callers see the shape
// they always did.
const optional = <K extends string>(key: K, value: string | null | undefined): Partial<Record<K, string>> =>
  value == null ? {} : ({ [key]: value } as Record<K, string>);

function entryOf(row: FindingRow): FindingEntry {
  return {
    status: row.status,
    first_seen: row.first_seen,
    last_seen: row.last_seen,
    finding: JSON.parse(row.finding) as Finding,
    ...optional('reason', row.reason),
    ...optional('resolved_at', row.resolved_at),
    ...optional('refuted_at', row.refuted_at),
    ...optional('resolution', row.resolution),
    ...optional('review_note', row.review_note),
    ...(row.status_before_suppression == null ? {} : { status_before_suppression: row.status_before_suppression }),
    ...(row.missed_runs ? { missed_runs: row.missed_runs } : {}),
    ...optional('reopened_at', row.reopened_at),
  };
}

export class IssueError extends Error {
  override name = 'IssueError';
  constructor(
    readonly kind: 'not-found' | 'not-reportable' | 'already-reported' | 'no-issue',
    message: string,
  ) {
    super(message);
  }
}

export class DecisionError extends Error {
  override name = 'DecisionError';
  constructor(
    readonly kind: 'not-found' | 'not-decidable' | 'already-decided' | 'already-validated' | 'no-decision',
    message: string,
  ) {
    super(message);
  }
}

// What a decision does to the entry a run writes. A decision on a speculative candidate acts only while the run still
// sees it as speculative: a run that has since confirmed or refuted it on its own evidence keeps its result. A
// refutation of an open finding acts whatever the run thinks of it, as a suppression does.
function applyDecision(e: FindingEntry, d: Decision | undefined): FindingEntry {
  if (!d) return e;
  const applies = d.decided_on === 'open' ? d.verdict === 'refuted' && (e.status === 'open' || e.status === 'speculative') : e.status === 'speculative';
  if (!applies) return e;
  if (d.verdict === 'confirmed') return { ...e, status: 'open' };
  return { ...e, status: 'refuted', refuted_at: d.decided_at, resolution: `Refuted by ${d.decided_by}: ${d.reason}` };
}

function applyLabels(f: Finding, o: LabelOverride | undefined): Finding {
  if (!o) return f;
  return { ...f, ...(o.kind ? { kind: o.kind } : {}), ...(o.personal_data == null ? {} : { personal_data: o.personal_data }) };
}

const KIND_NAMES: Record<Kind, string> = { bug: 'Bug', vulnerability: 'Vulnerability', chore: 'Chore' };

type Keyed<T> = T & { repo: string; fingerprint: string };

export interface Snapshot {
  schemaVersion: number;
  states: RepoState[];
  census: Census;
  usage: UsageRow[];
  history: Keyed<FindingEvent>[];
  stages: Keyed<StageEvent>[];
  decisions: Keyed<Decision>[];
  labels: Keyed<LabelOverride>[];
  attempts: Keyed<ValidationAttempt>[];
  issues: Keyed<IssueLink>[];
  yields: YieldRow[];
  reports: { date: string; report: RepoReport }[];
  failures: { date: string; repo: string; error: string; deferred: boolean; at: string }[];
}

export interface WriteContext {
  runId: string | null;
  at: string;
}

// One database per RepoScout directory. Writes happen in transactions, so a run that dies mid-write leaves the
// previous state whole; WAL lets the dashboard read while a run writes.
export class Store {
  readonly db: Database.Database;

  constructor(readonly file: string) {
    if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
    this.db = new Database(file);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');
    this.db.pragma('foreign_keys = ON');
    this.migrate();
  }

  private migrate(): void {
    const current = this.db.pragma('user_version', { simple: true }) as number;
    for (let v = current; v < MIGRATIONS.length; v++) {
      this.db.transaction(() => {
        this.db.exec(MIGRATIONS[v] as string);
        this.db.pragma(`user_version = ${v + 1}`);
      })();
    }
  }

  get schemaVersion(): number {
    return this.db.pragma('user_version', { simple: true }) as number;
  }

  // Changes whenever another connection commits: the dashboard's cheap "did anything change" check.
  dataVersion(): number {
    return this.db.pragma('data_version', { simple: true }) as number;
  }

  close(): void {
    this.db.close();
  }

  getMeta(key: string): string | null {
    return (this.db.prepare('SELECT value FROM meta WHERE key = ?').pluck().get(key) as string | undefined) ?? null;
  }

  setMeta(key: string, value: string): void {
    this.db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(key, value);
  }

  repoNames(): string[] {
    return this.db.prepare('SELECT name FROM repos ORDER BY name').pluck().all() as string[];
  }

  readRepoState(repo: string): RepoState | null {
    const row = this.db.prepare('SELECT * FROM repos WHERE name = ?').get(repo) as RepoRow | undefined;
    if (!row) return null;
    const commits = this.db.prepare('SELECT analyzer, commit_sha FROM analyzer_commits WHERE repo = ?').all(repo) as {
      analyzer: Analyzer;
      commit_sha: string | null;
    }[];
    const audits = Object.fromEntries(ANALYZERS.map((a) => [a, {} as Record<string, string>])) as AuditsByAnalyzer;
    for (const a of this.db.prepare('SELECT analyzer, path, audited_at FROM file_audits WHERE repo = ?').iterate(repo) as Iterable<{
      analyzer: Analyzer;
      path: string;
      audited_at: string;
    }>) {
      const map = audits[a.analyzer] ?? {};
      map[a.path] = a.audited_at;
      audits[a.analyzer] = map;
    }
    const findings: FindingsState = {};
    for (const f of this.db.prepare('SELECT * FROM findings WHERE repo = ? ORDER BY rowid').iterate(repo) as Iterable<FindingRow>) {
      findings[f.fingerprint] = entryOf(f);
    }
    return {
      repo: row.name,
      branch: row.branch,
      ...(row.fingerprint_version == null ? {} : { fingerprint_version: row.fingerprint_version }),
      last_commit: row.last_commit,
      ...optional('last_run_at', row.last_run_at),
      ...(commits.length ? { last_commit_by_analyzer: Object.fromEntries(commits.map((c) => [c.analyzer, c.commit_sha])) } : {}),
      last_full_run_at: row.last_full_run_at,
      ...optional('last_speculative_review_at', row.last_speculative_review_at),
      eligible_files: row.eligible_files,
      file_audits_by_analyzer: audits,
      unread_once: JSON.parse(row.unread_once) as string[],
      ...(row.unread_once_by_analyzer == null
        ? {}
        : { unread_once_by_analyzer: JSON.parse(row.unread_once_by_analyzer) as NonNullable<RepoState['unread_once_by_analyzer']> }),
      findings,
    };
  }

  // Replaces a repository's state in one transaction, and records every finding whose status changed. IMMEDIATE,
  // like every transaction here that reads before it writes: a deferred one starts as a reader, and a dashboard
  // write committed in between makes its upgrade fail with SQLITE_BUSY_SNAPSHOT, which no busy timeout retries.
  writeRepoState(repo: string, state: RepoState, ctx: WriteContext): void {
    this.db
      .transaction(() => {
        const before = new Map(
          (
            this.db.prepare('SELECT fingerprint, status, review_note FROM findings WHERE repo = ?').all(repo) as {
              fingerprint: string;
              status: FindingStatus;
              review_note: string | null;
            }[]
          ).map((r) => [r.fingerprint, r]),
        );
        this.db
          .prepare(
            `INSERT INTO repos (name, branch, fingerprint_version, last_commit, last_run_at, last_full_run_at, last_speculative_review_at, eligible_files, unread_once,
             unread_once_by_analyzer)
           VALUES (@name, @branch, @fingerprint_version, @last_commit, @last_run_at, @last_full_run_at, @last_speculative_review_at, @eligible_files, @unread_once,
             @unread_once_by_analyzer)
           ON CONFLICT (name) DO UPDATE SET branch = excluded.branch, fingerprint_version = excluded.fingerprint_version,
             last_commit = excluded.last_commit, last_run_at = excluded.last_run_at, last_full_run_at = excluded.last_full_run_at,
             last_speculative_review_at = excluded.last_speculative_review_at, eligible_files = excluded.eligible_files,
             unread_once = excluded.unread_once, unread_once_by_analyzer = excluded.unread_once_by_analyzer`,
          )
          .run({
            name: repo,
            branch: state.branch,
            fingerprint_version: state.fingerprint_version ?? null,
            last_commit: state.last_commit ?? null,
            last_run_at: state.last_run_at ?? null,
            last_full_run_at: state.last_full_run_at ?? null,
            last_speculative_review_at: state.last_speculative_review_at ?? null,
            eligible_files: state.eligible_files ?? null,
            unread_once: JSON.stringify(state.unread_once ?? []),
            unread_once_by_analyzer: state.unread_once_by_analyzer ? JSON.stringify(state.unread_once_by_analyzer) : null,
          });

        this.db.prepare('DELETE FROM analyzer_commits WHERE repo = ?').run(repo);
        const commit = this.db.prepare('INSERT INTO analyzer_commits (repo, analyzer, commit_sha) VALUES (?, ?, ?)');
        for (const [a, sha] of Object.entries(state.last_commit_by_analyzer ?? {})) commit.run(repo, a, sha ?? null);

        this.db.prepare('DELETE FROM file_audits WHERE repo = ?').run(repo);
        const audit = this.db.prepare('INSERT INTO file_audits (repo, analyzer, path, audited_at) VALUES (?, ?, ?, ?)');
        for (const [a, files] of Object.entries(state.file_audits_by_analyzer ?? {})) {
          for (const [path, at] of Object.entries(files ?? {})) audit.run(repo, a, path, at);
        }

        this.db.prepare('DELETE FROM findings WHERE repo = ?').run(repo);
        const finding = this.db.prepare(
          `INSERT INTO findings (repo, fingerprint, status, severity, category, file, first_seen, last_seen, reason, resolved_at, refuted_at, resolution, review_note,
           status_before_suppression, missed_runs, reopened_at, finding)
         VALUES (@repo, @fingerprint, @status, @severity, @category, @file, @first_seen, @last_seen, @reason, @resolved_at, @refuted_at, @resolution, @review_note,
           @status_before_suppression, @missed_runs, @reopened_at, @finding)`,
        );
        const event = this.db.prepare('INSERT INTO finding_events (repo, fingerprint, at, run_id, from_status, to_status, note) VALUES (?, ?, ?, ?, ?, ?, ?)');
        // An auditor's decision wins over a run that still sees the candidate as speculative, including a run that
        // started before the decision was made.
        const decisions = this.decisionsFor(repo);
        const overrides = this.labelsFor(repo);
        const stages = this.stagesFor(repo);
        for (const [fingerprint, written] of Object.entries(state.findings ?? {})) {
          const decided = applyDecision(written, decisions.get(fingerprint));
          const e = { ...decided, finding: applyLabels(decided.finding, overrides.get(fingerprint)) };
          const current = stages.get(fingerprint);
          const previousStatus = before.get(fingerprint)?.status;
          const reopening = previousStatus === 'resolved' && current?.stage === 'fixed';
          const stage = nextStage({
            current,
            previousStatus,
            entry: e,
            confirmedByAuditor: e.status === 'open' && decisions.get(fingerprint)?.verdict === 'confirmed',
            lookback: reopening ? { beforeFixed: this.stageBefore(repo, fingerprint, 'fixed') } : {},
          });
          if (stage) this.recordStage(repo, fingerprint, current, stage, { at: ctx.at, runId: ctx.runId, actor: null });
          finding.run({
            repo,
            fingerprint,
            status: e.status,
            severity: e.finding.severity,
            category: e.finding.category,
            file: e.finding.file,
            first_seen: e.first_seen,
            last_seen: e.last_seen,
            reason: e.reason ?? null,
            resolved_at: e.resolved_at ?? null,
            refuted_at: e.refuted_at ?? null,
            resolution: e.resolution ?? null,
            review_note: e.review_note ?? null,
            status_before_suppression: e.status_before_suppression ?? null,
            missed_runs: e.missed_runs ?? 0,
            reopened_at: e.reopened_at ?? null,
            finding: JSON.stringify(e.finding),
          });
          const was = before.get(fingerprint);
          // A resolved finding reported again by this write is reopened, not seen for the first time.
          if (was?.status === 'resolved' && e.status === 'open' && e.reopened_at === ctx.at)
            event.run(repo, fingerprint, ctx.at, ctx.runId, was.status, e.status, 'Reopened: reported again after it was resolved');
          else if (was?.status !== e.status) event.run(repo, fingerprint, ctx.at, ctx.runId, was?.status ?? null, e.status, e.resolution ?? e.reason ?? null);
          // A review that leaves the status as it was still happened: it is recorded with what the reviewer said.
          else if (e.review_note && e.review_note !== was?.review_note) event.run(repo, fingerprint, ctx.at, ctx.runId, e.status, e.status, e.review_note);
          before.delete(fingerprint);
        }
        // A fingerprint can leave state when its file is deleted or an older fingerprint is migrated.
        for (const [fingerprint, was] of before) event.run(repo, fingerprint, ctx.at, ctx.runId, was.status, 'removed', null);
        this.db.prepare('DELETE FROM finding_stages WHERE repo = ? AND fingerprint NOT IN (SELECT fingerprint FROM findings WHERE repo = ?)').run(repo, repo);
        this.db.prepare('DELETE FROM finding_issues WHERE repo = ? AND fingerprint NOT IN (SELECT fingerprint FROM findings WHERE repo = ?)').run(repo, repo);
      })
      .immediate();
  }

  findingHistory(repo: string, fingerprint: string): FindingEvent[] {
    return this.db
      .prepare('SELECT at, run_id, from_status, to_status, note, actor FROM finding_events WHERE repo = ? AND fingerprint = ? ORDER BY id')
      .all(repo, fingerprint) as FindingEvent[];
  }

  decisionsFor(repo: string): Map<string, Decision> {
    const rows = this.db
      .prepare('SELECT fingerprint, verdict, reason, decided_by, decided_at, decided_on FROM triage WHERE repo = ?')
      .all(repo) as (Decision & {
      fingerprint: string;
    })[];
    return new Map(rows.map(({ fingerprint, ...d }) => [fingerprint, d]));
  }

  // Records an auditor's decision on a speculative candidate or an open finding and applies it to the state at once.
  decide(repo: string, fingerprint: string, d: Omit<Decision, 'decided_on'>): FindingEntry {
    return this.db
      .transaction(() => {
        const row = this.db.prepare('SELECT * FROM findings WHERE repo = ? AND fingerprint = ?').get(repo, fingerprint) as FindingRow | undefined;
        if (!row) throw new DecisionError('not-found', 'no such finding in this repository');
        if (row.status !== 'speculative' && row.status !== 'open') {
          throw new DecisionError('not-decidable', `only a speculative candidate or an open finding can be decided; this one is ${row.status}`);
        }
        if (this.db.prepare('SELECT 1 FROM triage WHERE repo = ? AND fingerprint = ?').get(repo, fingerprint)) {
          throw new DecisionError('already-decided', 'this finding already has a decision; undo it first');
        }
        const current = this.stagesFor(repo).get(fingerprint);
        if (row.status === 'open' && d.verdict === 'confirmed' && current && current.stage !== 'detected') {
          throw new DecisionError('already-validated', `this finding is already ${current.stage}`);
        }
        const decision: Decision = { ...d, decided_on: row.status };
        this.db
          .prepare('INSERT INTO triage (repo, fingerprint, verdict, reason, decided_by, decided_at, decided_on) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(repo, fingerprint, d.verdict, d.reason, d.decided_by, d.decided_at, decision.decided_on);
        const next = applyDecision(entryOf(row), decision);
        if (next.status !== row.status) {
          this.setStatus(repo, fingerprint, next);
          this.event(
            repo,
            fingerprint,
            d.decided_at,
            row.status,
            next.status,
            `${d.verdict === 'confirmed' ? 'Confirmed' : 'Refuted'} by ${d.decided_by}: ${d.reason}`,
            d.decided_by,
          );
        }
        const stage = nextStage({ current, previousStatus: row.status, entry: next, confirmedByAuditor: d.verdict === 'confirmed' });
        if (stage) this.recordStage(repo, fingerprint, current, stage, { at: d.decided_at, runId: null, actor: d.decided_by });
        return next;
      })
      .immediate();
  }

  // Withdraws a decision; a finding the decision moved goes back to the status it was decided on.
  undecide(repo: string, fingerprint: string, by: string, at: string): FindingEntry {
    return this.db
      .transaction(() => {
        const d = this.decisionsFor(repo).get(fingerprint);
        if (!d) throw new DecisionError('no-decision', 'there is no decision on this finding to undo');
        this.db.prepare('DELETE FROM triage WHERE repo = ? AND fingerprint = ?').run(repo, fingerprint);
        const row = this.db.prepare('SELECT * FROM findings WHERE repo = ? AND fingerprint = ?').get(repo, fingerprint) as FindingRow | undefined;
        if (!row) throw new DecisionError('not-found', 'no such finding in this repository');
        const entry = entryOf(row);
        const moved = (d.verdict === 'confirmed' && entry.status === 'open') || (d.verdict === 'refuted' && entry.status === 'refuted');
        if (!moved) return entry;
        const { refuted_at: _at, resolution: _resolution, ...rest } = entry;
        const back: FindingEntry = d.verdict === 'refuted' ? { ...rest, status: d.decided_on } : { ...entry, status: d.decided_on };
        if (back.status !== entry.status) {
          this.setStatus(repo, fingerprint, back);
          this.event(repo, fingerprint, at, entry.status, back.status, `Decision withdrawn by ${by}`, by);
        }
        if (d.verdict === 'confirmed') {
          const current = this.stagesFor(repo).get(fingerprint);
          const stage = withdrawnStage(current, entry, { beforeAuditor: this.stageBefore(repo, fingerprint, 'auditor') });
          if (stage) this.recordStage(repo, fingerprint, current, stage, { at, runId: null, actor: by });
        }
        return back;
      })
      .immediate();
  }

  private setStatus(repo: string, fingerprint: string, e: FindingEntry): void {
    this.db
      .prepare('UPDATE findings SET status = ?, refuted_at = ?, resolution = ? WHERE repo = ? AND fingerprint = ?')
      .run(e.status, e.refuted_at ?? null, e.resolution ?? null, repo, fingerprint);
  }

  private event(repo: string, fingerprint: string, at: string, from: string | null, to: string, note: string | null, actor: string): void {
    this.db
      .prepare('INSERT INTO finding_events (repo, fingerprint, at, run_id, from_status, to_status, note, actor) VALUES (?, ?, ?, NULL, ?, ?, ?, ?)')
      .run(repo, fingerprint, at, from, to, note, actor);
  }

  stagesFor(repo: string): Map<string, StageState> {
    const rows = this.db.prepare('SELECT fingerprint, stage, source, since FROM finding_stages WHERE repo = ?').all(repo) as (StageState & {
      fingerprint: string;
    })[];
    return new Map(rows.map(({ fingerprint, ...s }) => [fingerprint, s]));
  }

  stageHistory(repo: string, fingerprint: string): StageEvent[] {
    return this.db
      .prepare('SELECT at, run_id, from_stage, to_stage, source, note, actor FROM finding_stage_events WHERE repo = ? AND fingerprint = ? ORDER BY id')
      .all(repo, fingerprint) as StageEvent[];
  }

  // Everything an export holds, read in one transaction so a run committing meanwhile cannot split it.
  snapshot(): Snapshot {
    return this.db.transaction(
      (): Snapshot => ({
        schemaVersion: this.schemaVersion,
        states: this.repoNames().flatMap((r) => this.readRepoState(r) ?? []),
        census: this.census(),
        usage: this.usage(Number.MAX_SAFE_INTEGER),
        history: this.db
          .prepare('SELECT repo, fingerprint, at, run_id, from_status, to_status, note, actor FROM finding_events ORDER BY id')
          .all() as Snapshot['history'],
        stages: this.db
          .prepare('SELECT repo, fingerprint, at, run_id, from_stage, to_stage, source, note, actor FROM finding_stage_events ORDER BY id')
          .all() as Snapshot['stages'],
        decisions: this.db
          .prepare('SELECT repo, fingerprint, verdict, reason, decided_by, decided_at, decided_on FROM triage ORDER BY repo, fingerprint')
          .all() as Snapshot['decisions'],
        labels: (
          this.db.prepare('SELECT repo, fingerprint, kind, personal_data, set_by, set_at FROM labels ORDER BY repo, fingerprint').all() as (Omit<
            Snapshot['labels'][number],
            'personal_data'
          > & { personal_data: number | null })[]
        ).map((l) => ({ ...l, personal_data: l.personal_data == null ? null : l.personal_data === 1 })),
        attempts: this.db
          .prepare('SELECT repo, fingerprint, at, run_id, outcome, reason FROM validation_attempts ORDER BY repo, fingerprint, at')
          .all() as Snapshot['attempts'],
        issues: this.db
          .prepare('SELECT repo, fingerprint, key, url, project, reported_by, reported_at FROM finding_issues ORDER BY repo, fingerprint')
          .all() as Snapshot['issues'],
        yields: this.yields(Number.MAX_SAFE_INTEGER),
        reports: (this.db.prepare('SELECT date, data FROM reports ORDER BY date, generated_at, run_id').all() as { date: string; data: string }[]).map((r) => ({
          date: r.date,
          report: JSON.parse(r.data) as RepoReport,
        })),
        failures: (
          this.db.prepare('SELECT date, repo, error, deferred, at FROM failures ORDER BY date, repo').all() as {
            date: string;
            repo: string;
            error: string;
            deferred: number;
            at: string;
          }[]
        ).map((f) => ({ ...f, deferred: f.deferred === 1 })),
      }),
    )();
  }

  // Replaces a repository's status history with entries from an export, which carry their actors.
  restoreHistory(repo: string, events: Keyed<FindingEvent>[]): void {
    this.db.prepare('DELETE FROM finding_events WHERE repo = ?').run(repo);
    const insert = this.db.prepare(
      'INSERT INTO finding_events (repo, fingerprint, at, run_id, from_status, to_status, note, actor) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    );
    for (const e of events) insert.run(repo, e.fingerprint, e.at, e.run_id, e.from_status, e.to_status, e.note, e.actor);
  }

  // Replaces a repository's stage history with entries from an export. Each fingerprint in the state takes its stage
  // from its latest entry; one with none keeps the stage the state write gave it.
  restoreStages(repo: string, events: Keyed<StageEvent>[]): void {
    this.db.prepare('DELETE FROM finding_stage_events WHERE repo = ?').run(repo);
    const insert = this.db.prepare(
      'INSERT INTO finding_stage_events (repo, fingerprint, at, run_id, from_stage, to_stage, source, note, actor) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    const latest = new Map<string, StageEvent>();
    for (const e of events) {
      insert.run(repo, e.fingerprint, e.at, e.run_id, e.from_stage, e.to_stage, e.source, e.note, e.actor);
      latest.set(e.fingerprint, e);
    }
    const current = this.db.prepare(`UPDATE finding_stages SET stage = ?, source = ?, since = ? WHERE repo = ? AND fingerprint = ?`);
    for (const [fingerprint, e] of latest) current.run(e.to_stage, e.source, e.at, repo, fingerprint);
  }

  restoreDecision(repo: string, fingerprint: string, d: Decision): void {
    this.db
      .prepare('INSERT INTO triage (repo, fingerprint, verdict, reason, decided_by, decided_at, decided_on) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(repo, fingerprint, d.verdict, d.reason, d.decided_by, d.decided_at, d.decided_on);
  }

  restoreLabels(repo: string, fingerprint: string, o: LabelOverride): void {
    this.db
      .prepare('INSERT INTO labels (repo, fingerprint, kind, personal_data, set_by, set_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(repo, fingerprint, o.kind, o.personal_data == null ? null : Number(o.personal_data), o.set_by, o.set_at);
  }

  issuesFor(repo: string): Map<string, IssueLink> {
    const rows = this.db
      .prepare('SELECT fingerprint, key, url, project, reported_by, reported_at FROM finding_issues WHERE repo = ?')
      .all(repo) as (IssueLink & { fingerprint: string })[];
    return new Map(rows.map(({ fingerprint, ...link }) => [fingerprint, link]));
  }

  // Why a finding cannot be reported now, or null when it can: only a validated open finding with no issue can.
  notReportable(repo: string, fingerprint: string): IssueError | null {
    const row = this.db.prepare('SELECT status FROM findings WHERE repo = ? AND fingerprint = ?').get(repo, fingerprint) as { status: string } | undefined;
    if (!row) return new IssueError('not-found', 'no such finding in this repository');
    const link = this.issuesFor(repo).get(fingerprint);
    if (link) return new IssueError('already-reported', `this finding is already reported as ${link.key}`);
    const stage = this.stagesFor(repo).get(fingerprint)?.stage ?? 'detected';
    if (row.status !== 'open' || stage !== 'validated') {
      return new IssueError('not-reportable', `only a validated open finding can be reported; this one is ${row.status} at ${stage}`);
    }
    return null;
  }

  // Records the issue a finding was reported as and moves it to reported, in one transaction.
  linkIssue(repo: string, fingerprint: string, link: IssueLink): void {
    this.db
      .transaction(() => {
        const refused = this.notReportable(repo, fingerprint);
        if (refused) throw refused;
        this.db
          .prepare('INSERT INTO finding_issues (repo, fingerprint, key, url, project, reported_by, reported_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(repo, fingerprint, link.key, link.url, link.project, link.reported_by, link.reported_at);
        const current = this.stagesFor(repo).get(fingerprint);
        this.recordStage(
          repo,
          fingerprint,
          current,
          { stage: 'reported', source: 'reported', note: link.key },
          { at: link.reported_at, runId: null, actor: link.reported_by },
        );
      })
      .immediate();
  }

  // Forgets a finding's issue, which stays in Jira as it is, and returns the finding from reported to validated.
  unlinkIssue(repo: string, fingerprint: string, by: string, at: string): IssueLink {
    return this.db
      .transaction(() => {
        const link = this.issuesFor(repo).get(fingerprint);
        if (!link) throw new IssueError('no-issue', 'this finding has no linked issue');
        this.db.prepare('DELETE FROM finding_issues WHERE repo = ? AND fingerprint = ?').run(repo, fingerprint);
        const current = this.stagesFor(repo).get(fingerprint);
        if (current?.stage === 'reported') {
          this.recordStage(repo, fingerprint, current, { stage: 'validated', source: 'unlinked', note: link.key }, { at, runId: null, actor: by });
        }
        return link;
      })
      .immediate();
  }

  restoreIssue(repo: string, fingerprint: string, link: IssueLink): void {
    this.db
      .prepare('INSERT INTO finding_issues (repo, fingerprint, key, url, project, reported_by, reported_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(repo, fingerprint, link.key, link.url, link.project, link.reported_by, link.reported_at);
  }

  // The stage a finding had before its latest move to fixed, or before its latest auditor confirmation.
  private stageBefore(repo: string, fingerprint: string, move: 'fixed' | 'auditor'): Stage | null {
    const where = move === 'fixed' ? "to_stage = 'fixed'" : "source = 'auditor'";
    return (
      (this.db
        .prepare(`SELECT from_stage FROM finding_stage_events WHERE repo = ? AND fingerprint = ? AND ${where} ORDER BY id DESC LIMIT 1`)
        .pluck()
        .get(repo, fingerprint) as Stage | null | undefined) ?? null
    );
  }

  private recordStage(
    repo: string,
    fingerprint: string,
    current: StageState | undefined,
    change: StageChange,
    { at, runId, actor }: { at: string; runId: string | null; actor: string | null },
  ): void {
    this.db
      .prepare(
        `INSERT INTO finding_stages (repo, fingerprint, stage, source, since) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (repo, fingerprint) DO UPDATE SET stage = excluded.stage, source = excluded.source, since = excluded.since`,
      )
      .run(repo, fingerprint, change.stage, change.source, at);
    this.db
      .prepare('INSERT INTO finding_stage_events (repo, fingerprint, at, run_id, from_stage, to_stage, source, note, actor) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(repo, fingerprint, at, runId, current?.stage ?? null, change.stage, change.source, change.note, actor);
  }

  allDecisions(): Map<string, Map<string, Decision>> {
    const out = new Map<string, Map<string, Decision>>();
    for (const repo of this.db.prepare('SELECT DISTINCT repo FROM triage').pluck().all() as string[]) out.set(repo, this.decisionsFor(repo));
    return out;
  }

  // Findings in the given statuses that lack a field, most severe first, open before speculative.
  findingsWithout(
    field: 'repro' | 'kind',
    repos: string[],
    statuses: FindingStatus[],
  ): { repo: string; fingerprint: string; finding: Finding; status: FindingStatus }[] {
    if (!repos.length || !statuses.length) return [];
    const rows = this.db
      .prepare(
        `SELECT repo, fingerprint, status, finding FROM findings
         WHERE repo IN (SELECT value FROM json_each(?)) AND status IN (SELECT value FROM json_each(?)) AND json_extract(finding, ?) IS NULL
         ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
                  CASE status WHEN 'open' THEN 0 ELSE 1 END, repo, file`,
      )
      .all(JSON.stringify(repos), JSON.stringify(statuses), `$.${field}`) as { repo: string; fingerprint: string; status: FindingStatus; finding: string }[];
    return rows.map((r) => ({ ...r, finding: JSON.parse(r.finding) as Finding }));
  }

  // Adds reproduction steps to findings that have none, leaving everything else about them as it is.
  setRepro(repo: string, entries: { fingerprint: string; repro: Repro }[]): number {
    const update = this.db.prepare(
      "UPDATE findings SET finding = json_set(finding, '$.repro', json(?)) WHERE repo = ? AND fingerprint = ? AND json_extract(finding, '$.repro') IS NULL",
    );
    return this.db.transaction(() => entries.reduce((n, e) => n + update.run(JSON.stringify(e.repro), repo, e.fingerprint).changes, 0))();
  }

  // Labels findings that have no kind yet; a finding an auditor already labelled is left alone, and a personal-data
  // mark an auditor corrected wins over the backfill's.
  setKinds(repo: string, entries: { fingerprint: string; kind: Kind; personal_data: boolean }[]): number {
    const update = this.db.prepare(
      "UPDATE findings SET finding = json_set(finding, '$.kind', ?, '$.personal_data', json(?)) WHERE repo = ? AND fingerprint = ? AND json_extract(finding, '$.kind') IS NULL",
    );
    const overrides = this.labelsFor(repo);
    return this.db.transaction(() =>
      entries.reduce((n, e) => n + update.run(e.kind, String(overrides.get(e.fingerprint)?.personal_data ?? e.personal_data), repo, e.fingerprint).changes, 0),
    )();
  }

  labelsFor(repo: string): Map<string, LabelOverride> {
    const rows = this.db.prepare('SELECT fingerprint, kind, personal_data, set_by, set_at FROM labels WHERE repo = ?').all(repo) as {
      fingerprint: string;
      kind: Kind | null;
      personal_data: number | null;
      set_by: string;
      set_at: string;
    }[];
    return new Map(
      rows.map(({ fingerprint, personal_data, ...o }) => [fingerprint, { ...o, personal_data: personal_data == null ? null : personal_data === 1 }]),
    );
  }

  // Records an auditor's correction of a finding's labels and applies it at once. A field left out keeps its value.
  setLabels(repo: string, fingerprint: string, change: { kind?: Kind; personal_data?: boolean }, by: string, at: string): FindingEntry {
    return this.db
      .transaction(() => {
        const row = this.db.prepare('SELECT * FROM findings WHERE repo = ? AND fingerprint = ?').get(repo, fingerprint) as FindingRow | undefined;
        if (!row) throw new DecisionError('not-found', 'no such finding in this repository');
        const was = this.labelsFor(repo).get(fingerprint);
        const o: LabelOverride = {
          kind: change.kind ?? was?.kind ?? null,
          personal_data: change.personal_data ?? was?.personal_data ?? null,
          set_by: by,
          set_at: at,
        };
        this.db
          .prepare(
            `INSERT INTO labels (repo, fingerprint, kind, personal_data, set_by, set_at) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT (repo, fingerprint) DO UPDATE SET kind = excluded.kind, personal_data = excluded.personal_data, set_by = excluded.set_by, set_at = excluded.set_at`,
          )
          .run(repo, fingerprint, o.kind, o.personal_data == null ? null : Number(o.personal_data), by, at);
        const entry = entryOf(row);
        const finding = applyLabels(entry.finding, o);
        this.db.prepare('UPDATE findings SET finding = ? WHERE repo = ? AND fingerprint = ?').run(JSON.stringify(finding), repo, fingerprint);
        const before = entry.finding;
        const said = [
          change.kind && change.kind !== before.kind ? `type ${before.kind ? KIND_NAMES[before.kind] : 'unset'} to ${KIND_NAMES[change.kind]}` : null,
          change.personal_data != null && change.personal_data !== (before.personal_data ?? false)
            ? change.personal_data
              ? 'marked as involving personal data'
              : 'personal data mark removed'
            : null,
        ].filter(Boolean);
        if (said.length) this.event(repo, fingerprint, at, entry.status, entry.status, `Labels changed by ${by}: ${said.join('; ')}`, by);
        return { ...entry, finding };
      })
      .immediate();
  }

  // Every validation attempt of a repository, oldest first per fingerprint.
  attemptsFor(repo: string): Map<string, ValidationAttempt[]> {
    const rows = this.db
      .prepare('SELECT fingerprint, at, run_id, outcome, reason FROM validation_attempts WHERE repo = ? ORDER BY at, run_id')
      .all(repo) as (ValidationAttempt & { fingerprint: string })[];
    const out = new Map<string, ValidationAttempt[]>();
    for (const { fingerprint, ...a } of rows) out.set(fingerprint, [...(out.get(fingerprint) ?? []), a]);
    return out;
  }

  validationAttempts(repo: string, fingerprint: string): ValidationAttempt[] {
    return this.attemptsFor(repo).get(fingerprint) ?? [];
  }

  recordAttempts(repo: string, attempts: (ValidationAttempt & { fingerprint: string })[]): void {
    const insert = this.db.prepare('INSERT OR REPLACE INTO validation_attempts (repo, fingerprint, at, run_id, outcome, reason) VALUES (?, ?, ?, ?, ?, ?)');
    for (const a of attempts) insert.run(repo, a.fingerprint, a.at, a.run_id, a.outcome, a.reason);
  }

  findingExists(repo: string, fingerprint: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM findings WHERE repo = ? AND fingerprint = ?').get(repo, fingerprint);
  }

  recordCensus(repo: string, { eligible, head, at = new Date().toISOString() }: { eligible: number; head: string; at?: string }): void {
    this.db
      .prepare(
        'INSERT INTO census (repo, eligible, head, at) VALUES (?, ?, ?, ?) ON CONFLICT (repo) DO UPDATE SET eligible = excluded.eligible, head = excluded.head, at = excluded.at',
      )
      .run(repo, eligible, head, at);
  }

  census(): Census {
    const rows = this.db.prepare('SELECT repo, eligible, head, at FROM census').all() as { repo: string; eligible: number; head: string; at: string }[];
    return Object.fromEntries(rows.map(({ repo, ...rest }) => [repo, rest]));
  }

  // The row is stored whole; the columns only index it. Rows written by early versions carry a date but no time.
  appendUsage(row: UsageRow): void {
    const at = row.at ?? (row.date ? `${row.date}T00:00:00.000Z` : new Date(0).toISOString());
    this.db
      .prepare('INSERT INTO usage (at, repo, mode, ok, data) VALUES (?, ?, ?, ?, ?)')
      .run(at, row.repo ?? '', row.mode ?? '', row.ok ? 1 : 0, JSON.stringify(row));
  }

  // The most recent rows, oldest first, as the JSONL file read them.
  usage(limit = 200): UsageRow[] {
    const rows = this.db.prepare('SELECT data FROM usage ORDER BY id DESC LIMIT ?').pluck().all(limit) as string[];
    return rows.reverse().map((d) => JSON.parse(d) as UsageRow);
  }

  saveYield(
    run: { runId: string; repo: string; at: string; mode: string; promptVersion: string | null; model: string | null },
    rows: readonly AnalyzerYield[],
  ): void {
    const insert = this.db.prepare(
      `INSERT INTO analyzer_yield (run_id, repo, analyzer, at, mode, prompt_version, model, instances, candidates, kept, speculative, discarded, tokens, cost_usd)
       VALUES (@run_id, @repo, @analyzer, @at, @mode, @prompt_version, @model, @instances, @candidates, @kept, @speculative, @discarded, @tokens, @cost_usd)
       ON CONFLICT (run_id, repo, analyzer) DO UPDATE SET at = excluded.at, mode = excluded.mode, prompt_version = excluded.prompt_version,
         model = excluded.model, instances = excluded.instances, candidates = excluded.candidates, kept = excluded.kept,
         speculative = excluded.speculative, discarded = excluded.discarded, tokens = excluded.tokens, cost_usd = excluded.cost_usd`,
    );
    this.db.transaction(() => {
      for (const y of rows) {
        insert.run({ ...y, run_id: run.runId, repo: run.repo, at: run.at, mode: run.mode, prompt_version: run.promptVersion, model: run.model });
      }
    })();
  }

  // Yield rows, newest first, from the most recent `limit` rows.
  yields(limit = 1000): YieldRow[] {
    return this.db.prepare('SELECT * FROM analyzer_yield ORDER BY at DESC, run_id DESC, analyzer LIMIT ?').all(limit) as YieldRow[];
  }

  // Every finding with how it ended and the run that first recorded it. A finding imported from the JSON state has
  // no run, so its prompts and model are unknown.
  precisionFacts(): PrecisionFact[] {
    const rows = this.db
      .prepare(
        `SELECT f.repo, f.fingerprint, f.status, f.category,
           EXISTS (SELECT 1 FROM finding_events e WHERE e.repo = f.repo AND e.fingerprint = f.fingerprint AND e.to_status = 'open') AS ever_open,
           json_extract(r.data, '$.prompt_version') AS prompt_version,
           json_extract(r.data, '$.specialist_model') AS model
         FROM findings f
         LEFT JOIN reports r ON r.repo = f.repo AND r.run_id = (
           SELECT e.run_id FROM finding_events e WHERE e.repo = f.repo AND e.fingerprint = f.fingerprint ORDER BY e.id LIMIT 1)`,
      )
      .all() as (Omit<PrecisionFact, 'ever_open'> & { ever_open: number })[];
    return rows.map((r) => ({ ...r, ever_open: r.ever_open === 1 }));
  }

  // What each recent run reported for the first time: confirmed findings (new, reopened or promoted) and new
  // speculative candidates. The cost of a finding is measured against these.
  runResults(limit = 500): RunResult[] {
    return this.db
      .prepare(
        `SELECT run_id, repo, generated_at,
           (SELECT COUNT(*) FROM json_each(data, '$.findings') WHERE json_extract(value, '$.status') = 'new') AS new_findings,
           COALESCE(json_array_length(data, '$.speculative_new'), 0) AS new_speculative
         FROM reports ORDER BY generated_at DESC LIMIT ?`,
      )
      .all(limit) as RunResult[];
  }

  saveReport(report: RepoReport, date: string): void {
    this.db
      .prepare(
        'INSERT INTO reports (run_id, repo, date, generated_at, data) VALUES (?, ?, ?, ?, ?) ON CONFLICT (run_id, repo) DO UPDATE SET date = excluded.date, generated_at = excluded.generated_at, data = excluded.data',
      )
      .run(report.run_id, report.repo, date, report.generated_at, JSON.stringify(report));
  }

  private reportsWhere(where: string, ...params: unknown[]): DatedReport[] {
    const rows = this.db.prepare(`SELECT run_id, date, data FROM reports WHERE ${where}`).all(...params) as { run_id: string; date: string; data: string }[];
    return rows.map((r) => ({ date: r.date, run: r.run_id, r: JSON.parse(r.data) as RepoReport }));
  }

  latestReport(repo: string): DatedReport | null {
    return this.reportsWhere('repo = ? ORDER BY date DESC, generated_at DESC, run_id DESC LIMIT 1', repo)[0] ?? null;
  }

  // Every report of the repository on the most recent `days` dates that have any report, newest run first.
  recentReports(repo: string, days = 7): DatedReport[] {
    return this.reportsWhere('repo = ? AND date IN (SELECT DISTINCT date FROM reports ORDER BY date DESC LIMIT ?) ORDER BY run_id DESC', repo, days);
  }

  // Every report of the day, by repository and oldest first. summary.md aggregates a repository's runs and sweep
  // passes, so what an early pass found is not hidden by a later one.
  reportsForDate(date: string): RepoReport[] {
    return this.reportsWhere('date = ? ORDER BY repo, generated_at, run_id', date).map((d) => d.r);
  }

  failuresFor(date: string): Failures {
    const rows = this.db.prepare('SELECT repo, error, deferred, at FROM failures WHERE date = ?').all(date) as {
      repo: string;
      error: string;
      deferred: number;
      at: string;
    }[];
    return Object.fromEntries(rows.map((r) => [r.repo, { error: r.error, ...(r.deferred ? { deferred: true } : {}), at: r.at }]));
  }

  replaceFailures(date: string, failures: Failures): void {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM failures WHERE date = ?').run(date);
      const insert = this.db.prepare('INSERT INTO failures (date, repo, error, deferred, at) VALUES (?, ?, ?, ?, ?)');
      for (const [repo, f] of Object.entries(failures)) insert.run(date, repo, f.error, f.deferred ? 1 : 0, f.at);
    })();
  }

  // Failures on the most recent `days` dates that have any, newest date first.
  recentFailures(days = 7): (Failures[string] & { date: string; repo: string })[] {
    const rows = this.db
      .prepare(
        'SELECT date, repo, error, deferred, at FROM failures WHERE date IN (SELECT DISTINCT date FROM failures ORDER BY date DESC LIMIT ?) ORDER BY date DESC',
      )
      .all(days) as { date: string; repo: string; error: string; deferred: number; at: string }[];
    return rows.map((r) => ({ date: r.date, repo: r.repo, error: r.error, ...(r.deferred ? { deferred: true } : {}), at: r.at }));
  }

  // IMMEDIATE for the reason given at writeRepoState. The store's own transactions inside it become savepoints, so
  // everything fn writes commits together or not at all.
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn).immediate();
  }
}
