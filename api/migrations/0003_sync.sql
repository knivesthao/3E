CREATE TABLE reading_sync (
  book_id      TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
  scene_number INTEGER NOT NULL DEFAULT 1,
  updated_by   TEXT,
  updated_at   TEXT NOT NULL
);
