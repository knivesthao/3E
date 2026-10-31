-- Hot-read indexes (Phase 2): cut scanned D1 rows on the paths the
-- edge cache misses and the polls that never cache.
CREATE INDEX idx_definitions_lookup ON definitions(lang, word, level);
CREATE INDEX idx_ai_usage_project ON ai_usage(project_id);
CREATE INDEX idx_books_project ON books(project_id);
CREATE INDEX idx_scenes_project ON scenes(project_id, scene_number);
