-- Book focus tags: closed vocabulary (nouns/verbs/adjectives) enforced in
-- the publish route, stored as JSON for forward-compatible filtering.
ALTER TABLE books ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]';
CREATE INDEX idx_books_level ON books(level);
