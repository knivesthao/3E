-- Hot-read indexes (Phase 2): cut scanned D1 rows on the paths the
-- edge cache misses and the polls that never cache. ai_usage is already
-- covered by 0001_init.sql; the dictionary reads straight off its PRIMARY
-- KEY(word, level, lang), so these two cover publish + scene ordering only.
CREATE INDEX idx_books_project ON books(project_id);
CREATE INDEX idx_scenes_project ON scenes(project_id, scene_number);
