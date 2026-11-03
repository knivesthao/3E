-- Reader progress + word-miss loop (user data stays in the app DB;
-- published books live in the shared library DB and are only referenced).
-- Counters only: no per-tap rows, no timestamps beyond last_seen.

-- Per-reader flashcard deck totals, by deck key
-- ('letters' | 'names' | 'teams' | A1..C2 | 'mine').
CREATE TABLE user_flash_progress (
  user_id    TEXT NOT NULL,
  set_key    TEXT NOT NULL,
  seen       INTEGER NOT NULL DEFAULT 0,
  known      INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, set_key)
);

-- Words the reader stumbled on: tapped in the Reader, or tested by a
-- missed exam item. One row per reader per word; repeats bump `misses`.
-- 'Got it' in the My Words deck deletes the row.
CREATE TABLE user_word_misses (
  user_id   TEXT NOT NULL,
  word      TEXT NOT NULL,
  level     TEXT NOT NULL,
  source    TEXT NOT NULL,
  misses    INTEGER NOT NULL DEFAULT 1,
  last_seen TEXT NOT NULL,
  PRIMARY KEY (user_id, word)
);

CREATE INDEX idx_word_misses_user ON user_word_misses(user_id, misses DESC);
