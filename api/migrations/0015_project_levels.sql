-- Widen projects.level to every ProjectLevel the API validates
-- (validate.ts: CEFR A1-C2 + HSK1-6). The 0001 CHECK capped it at B2, so
-- C1/C2/HSK creation passed validation then blew up at D1 -> generic 500.
-- SQLite cannot ALTER a CHECK: rebuild the table, preserving all columns
-- added since (lang in 0007, tags_json in 0013) and all existing rows.
CREATE TABLE projects_new (
  id          TEXT PRIMARY KEY,
  creator_id  TEXT NOT NULL REFERENCES users(id),
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  level       TEXT NOT NULL CHECK (level IN ('A1','A2','B1','B2','C1','C2','HSK1','HSK2','HSK3','HSK4','HSK5','HSK6')),
  purpose     TEXT NOT NULL DEFAULT 'learning' CHECK (purpose IN ('learning','reading')),
  status      TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  cast_json   TEXT NOT NULL DEFAULT '{"characters":[],"places":[]}',
  quiz_json   TEXT NOT NULL DEFAULT '[]',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  lang        TEXT NOT NULL DEFAULT 'en',
  tags_json   TEXT NOT NULL DEFAULT '[]'
);
INSERT INTO projects_new
  (id, creator_id, title, description, level, purpose, status, cast_json, quiz_json, created_at, updated_at, lang, tags_json)
  SELECT id, creator_id, title, description, level, purpose, status, cast_json, quiz_json, created_at, updated_at, lang, tags_json
  FROM projects;
DROP TABLE projects;
ALTER TABLE projects_new RENAME TO projects;
