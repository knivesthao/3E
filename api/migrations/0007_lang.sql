-- Language tracks (Phase 5): books and projects carry their language so the
-- reader can switch TTS/recognition voices and the dictionary stays split
-- by lang. English-first: everything existing defaults to 'en'.
ALTER TABLE books ADD COLUMN lang TEXT NOT NULL DEFAULT 'en';
ALTER TABLE projects ADD COLUMN lang TEXT NOT NULL DEFAULT 'en';
CREATE INDEX idx_books_lang ON books(lang);
