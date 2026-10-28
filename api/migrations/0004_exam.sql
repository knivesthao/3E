CREATE TABLE exam_attempts (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  score       INTEGER NOT NULL,
  total       INTEGER NOT NULL,
  answers_json TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_exam_attempts_user ON exam_attempts(user_id);
