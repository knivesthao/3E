CREATE TABLE class_words (
  class_id  TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  word      TEXT NOT NULL,
  position  INTEGER NOT NULL,
  PRIMARY KEY (class_id, word),
  UNIQUE (class_id, position)
);
CREATE INDEX idx_class_words_class ON class_words(class_id);
