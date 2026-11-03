-- Per-book word map for the publishing pipeline: which scenes teach which
-- words, and whether the dictionary defines them at the book's level.
-- Written incrementally (only new/edited scenes re-sync); read by the
-- owner words endpoint and future tap-a-word features.
CREATE TABLE book_words (
  id           TEXT PRIMARY KEY,
  book_id      TEXT NOT NULL,
  scene_number INTEGER NOT NULL,
  word         TEXT NOT NULL,
  level        TEXT NOT NULL,
  defined      INTEGER NOT NULL DEFAULT 0,
  updated_at   TEXT NOT NULL
);

CREATE INDEX idx_book_words_book ON book_words(book_id);
CREATE INDEX idx_book_words_word ON book_words(word, level);
