CREATE TABLE panels (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  scene_number INTEGER NOT NULL,
  image_key    TEXT NOT NULL,
  mask_key     TEXT,
  created_at   TEXT NOT NULL,
  UNIQUE (project_id, scene_number)
);
