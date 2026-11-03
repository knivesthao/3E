-- Leveled dictionary (Phase 1): one gloss per word per level per language.
-- Readers hit this instead of a model call per tap; misses fall back to AI
-- and cache back here. UNIQUE makes reseeds idempotent: existing rows win.
CREATE TABLE definitions (
  word       TEXT NOT NULL,
  level      TEXT NOT NULL,
  lang       TEXT NOT NULL DEFAULT 'en',
  gloss      TEXT NOT NULL,
  source     TEXT NOT NULL DEFAULT 'baseten',
  verified   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  PRIMARY KEY (word, level, lang)
);
CREATE INDEX idx_definitions_level_lang ON definitions(level, lang);
