-- Dictionary seed job ledger: which scopes ran, what finished, what missed.
-- Lives next to definitions so resume = level words MINUS rows present here.
-- DEV-only routes read/write it (mirrors /api/admin/definitions); the SQL
-- dump stays the promotion path to shared/prod.
CREATE TABLE seed_jobs (
  id            TEXT PRIMARY KEY,
  scope         TEXT NOT NULL UNIQUE,
  levels        TEXT NOT NULL,
  shard         TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'running',
  total         INTEGER NOT NULL DEFAULT 0,
  done          INTEGER NOT NULL DEFAULT 0,
  missed_json   TEXT NOT NULL DEFAULT '[]',
  error         TEXT,
  run_url       TEXT,
  started_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
