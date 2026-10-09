// Each entry upgrades the database by one version, recorded in PRAGMA user_version. Entries are never edited
// once released: a change to the schema is a new entry.
export const MIGRATIONS: string[] = [
  `
  CREATE TABLE meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE repos (
    name TEXT PRIMARY KEY,
    branch TEXT NOT NULL,
    fingerprint_version INTEGER,
    last_commit TEXT,
    last_run_at TEXT,
    last_full_run_at TEXT,
    last_speculative_review_at TEXT,
    eligible_files INTEGER,
    unread_once TEXT NOT NULL DEFAULT '[]'
  );

  CREATE TABLE analyzer_commits (
    repo TEXT NOT NULL,
    analyzer TEXT NOT NULL,
    commit_sha TEXT,
    PRIMARY KEY (repo, analyzer)
  ) WITHOUT ROWID;

  CREATE TABLE file_audits (
    repo TEXT NOT NULL,
    analyzer TEXT NOT NULL,
    path TEXT NOT NULL,
    audited_at TEXT NOT NULL,
    PRIMARY KEY (repo, analyzer, path)
  ) WITHOUT ROWID;

  CREATE TABLE findings (
    repo TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    status TEXT NOT NULL,
    severity TEXT NOT NULL,
    category TEXT NOT NULL,
    file TEXT NOT NULL,
    first_seen TEXT NOT NULL,
    last_seen TEXT NOT NULL,
    reason TEXT,
    resolved_at TEXT,
    refuted_at TEXT,
    resolution TEXT,
    review_note TEXT,
    finding TEXT NOT NULL,
    PRIMARY KEY (repo, fingerprint)
  );
  CREATE INDEX findings_by_status ON findings (repo, status);

  -- Every status a finding has had, so its history survives the state that overwrites it.
  CREATE TABLE finding_events (
    id INTEGER PRIMARY KEY,
    repo TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    at TEXT NOT NULL,
    run_id TEXT,
    from_status TEXT,
    to_status TEXT NOT NULL,
    note TEXT
  );
  CREATE INDEX finding_events_by_finding ON finding_events (repo, fingerprint, id);

  CREATE TABLE census (
    repo TEXT PRIMARY KEY,
    eligible INTEGER NOT NULL,
    head TEXT NOT NULL,
    at TEXT NOT NULL
  );

  CREATE TABLE usage (
    id INTEGER PRIMARY KEY,
    at TEXT NOT NULL,
    repo TEXT NOT NULL,
    mode TEXT NOT NULL,
    ok INTEGER NOT NULL,
    data TEXT NOT NULL
  );

  CREATE TABLE reports (
    run_id TEXT NOT NULL,
    repo TEXT NOT NULL,
    date TEXT NOT NULL,
    generated_at TEXT NOT NULL,
    data TEXT NOT NULL,
    PRIMARY KEY (run_id, repo)
  );
  CREATE INDEX reports_by_repo ON reports (repo, date);

  CREATE TABLE failures (
    date TEXT NOT NULL,
    repo TEXT NOT NULL,
    error TEXT NOT NULL,
    deferred INTEGER NOT NULL DEFAULT 0,
    at TEXT NOT NULL,
    PRIMARY KEY (date, repo)
  );
  `,
  `
  -- An auditor's decision on a speculative candidate. It outlives the state a run rewrites, so it is applied again
  -- whenever that state is written.
  CREATE TABLE triage (
    repo TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    verdict TEXT NOT NULL CHECK (verdict IN ('confirmed', 'refuted')),
    reason TEXT NOT NULL,
    decided_by TEXT NOT NULL,
    decided_at TEXT NOT NULL,
    PRIMARY KEY (repo, fingerprint)
  );

  -- Who made a change by hand; NULL for changes a run made.
  ALTER TABLE finding_events ADD COLUMN actor TEXT;
  `,
  `
  -- An auditor's correction of a finding's labels. Like a triage decision, it outlives the state a run rewrites.
  CREATE TABLE labels (
    repo TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    kind TEXT CHECK (kind IN ('bug', 'vulnerability', 'chore')),
    personal_data INTEGER CHECK (personal_data IN (0, 1)),
    set_by TEXT NOT NULL,
    set_at TEXT NOT NULL,
    PRIMARY KEY (repo, fingerprint)
  );
  `,
  `
  -- What a suppressed finding was before, so unsuppressing it restores that instead of promoting it to open.
  ALTER TABLE findings ADD COLUMN status_before_suppression TEXT;
  -- Consecutive re-audits that read the file and did not report the finding; it is resolved after two.
  ALTER TABLE findings ADD COLUMN missed_runs INTEGER NOT NULL DEFAULT 0;
  -- When a resolved finding was last reported again.
  ALTER TABLE findings ADD COLUMN reopened_at TEXT;
  -- Files each analyzer was given and did not open, retried once by the next run. NULL for state written before
  -- it, whose unread_once list counts for every analyzer.
  ALTER TABLE repos ADD COLUMN unread_once_by_analyzer TEXT;
  `,
  `
  -- What each analyzer's specialists yielded in one run: the candidates they proposed (NULL when their replies could
  -- not be parsed), what the verifier kept, left speculative or discarded, and the tokens and cost they spent.
  CREATE TABLE analyzer_yield (
    run_id TEXT NOT NULL,
    repo TEXT NOT NULL,
    analyzer TEXT NOT NULL,
    at TEXT NOT NULL,
    mode TEXT NOT NULL,
    prompt_version TEXT,
    model TEXT,
    instances INTEGER NOT NULL,
    candidates INTEGER,
    kept INTEGER NOT NULL,
    speculative INTEGER NOT NULL,
    discarded INTEGER NOT NULL,
    tokens INTEGER,
    cost_usd REAL,
    PRIMARY KEY (run_id, repo, analyzer)
  );
  CREATE INDEX analyzer_yield_by_time ON analyzer_yield (at);
  `,
  `
  -- How far each finding has progressed: detected, validated, reported or fixed. Kept apart from findings, which a run
  -- rewrites, and dropped when the fingerprint leaves the state.
  CREATE TABLE finding_stages (
    repo TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    stage TEXT NOT NULL CHECK (stage IN ('detected', 'validated', 'reported', 'fixed')),
    source TEXT NOT NULL,
    since TEXT NOT NULL,
    PRIMARY KEY (repo, fingerprint)
  );

  -- Every stage a finding has had, kept like finding_events after the fingerprint leaves the state.
  CREATE TABLE finding_stage_events (
    id INTEGER PRIMARY KEY,
    repo TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    at TEXT NOT NULL,
    run_id TEXT,
    from_stage TEXT,
    to_stage TEXT NOT NULL,
    source TEXT NOT NULL,
    note TEXT,
    actor TEXT
  );
  CREATE INDEX finding_stage_events_by_finding ON finding_stage_events (repo, fingerprint, id);

  INSERT INTO finding_stages (repo, fingerprint, stage, source, since)
  SELECT f.repo, f.fingerprint,
    CASE
      WHEN f.status = 'resolved' THEN 'fixed'
      WHEN f.status = 'open' AND (json_extract(f.finding, '$.verified') = 1
        OR EXISTS (SELECT 1 FROM triage t WHERE t.repo = f.repo AND t.fingerprint = f.fingerprint AND t.verdict = 'confirmed')) THEN 'validated'
      ELSE 'detected'
    END,
    'upgrade', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM findings f;

  INSERT INTO finding_stage_events (repo, fingerprint, at, run_id, from_stage, to_stage, source, note, actor)
  SELECT repo, fingerprint, since, NULL, NULL, stage, source, NULL, NULL FROM finding_stages ORDER BY repo, fingerprint;
  `,
];
