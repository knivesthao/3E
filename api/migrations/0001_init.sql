CREATE TABLE users (
  id         TEXT PRIMARY KEY,
  email      TEXT UNIQUE NOT NULL,
  name       TEXT NOT NULL DEFAULT '',
  role       TEXT NOT NULL CHECK (role IN ('creator','teacher','admin','student')),
  created_at TEXT NOT NULL
);

CREATE TABLE sessions (
  id_hash    TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE TABLE projects (
  id          TEXT PRIMARY KEY,
  creator_id  TEXT NOT NULL REFERENCES users(id),
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  level       TEXT NOT NULL CHECK (level IN ('A1','A2','B1','B2')),
  purpose     TEXT NOT NULL DEFAULT 'learning' CHECK (purpose IN ('learning','reading')),
  status      TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  cast_json   TEXT NOT NULL DEFAULT '{"characters":[],"places":[]}',
  quiz_json   TEXT NOT NULL DEFAULT '[]',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE scenes (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  scene_number INTEGER NOT NULL,
  data_json    TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  UNIQUE (project_id, scene_number)
);

CREATE TABLE books (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  creator_id    TEXT NOT NULL,
  title         TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  level         TEXT NOT NULL,
  reading_level TEXT NOT NULL CHECK (reading_level IN ('beginner','intermediate','advanced')),
  cover_url     TEXT,
  manifest_json TEXT NOT NULL,
  published_at  TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE jobs (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('scene','finish','package')),
  payload    TEXT NOT NULL DEFAULT '{}',
  status     TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','complete','failed')),
  result     TEXT,
  error      TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE ai_usage (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id    TEXT,
  user_id       TEXT,
  op_id         TEXT NOT NULL,
  attempt       INTEGER NOT NULL DEFAULT 1,
  task          TEXT NOT NULL,
  provider      TEXT NOT NULL DEFAULT 'meta-model-api',
  model         TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('text','image','segment','vision')),
  input_tokens  INTEGER,
  output_tokens INTEGER,
  cost_usd      REAL NOT NULL DEFAULT 0,
  ms            INTEGER NOT NULL,
  ok            INTEGER NOT NULL,
  error         TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX idx_ai_usage_project ON ai_usage (project_id, created_at);
CREATE INDEX idx_ai_usage_model ON ai_usage (model, created_at);
CREATE INDEX idx_ai_usage_task ON ai_usage (task, created_at);
CREATE INDEX idx_ai_usage_op ON ai_usage (op_id, attempt);

CREATE TABLE shelves (
  id         TEXT PRIMARY KEY,
  owner_id   TEXT NOT NULL REFERENCES users(id),
  name       TEXT NOT NULL DEFAULT 'My Shelf',
  created_at TEXT NOT NULL
);

CREATE TABLE shelf_books (
  shelf_id TEXT NOT NULL REFERENCES shelves(id) ON DELETE CASCADE,
  book_id  TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  added_at TEXT NOT NULL,
  PRIMARY KEY (shelf_id, book_id)
);
