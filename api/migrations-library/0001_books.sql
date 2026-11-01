-- Published-books library (3e-books): the books table ONLY. Drafts
-- (projects/scenes), users, reading_sync, and definitions stay in the app
-- DB. No cross-DB foreign keys: book_id is an opaque string everywhere
-- else, and deleting a draft never deletes a published book.
CREATE TABLE books (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL UNIQUE,
  creator_id    TEXT NOT NULL,
  title         TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  level         TEXT NOT NULL,
  reading_level TEXT NOT NULL CHECK (reading_level IN ('beginner','intermediate','advanced')),
  lang          TEXT NOT NULL DEFAULT 'en',
  cover_url     TEXT,
  manifest_json TEXT NOT NULL,
  published_at  TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE INDEX idx_books_project ON books(project_id);
CREATE INDEX idx_books_lang ON books(lang);
