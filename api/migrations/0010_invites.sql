-- Admin-issued role invites: teachers and creators only. The plaintext
-- code is returned once at issuance and never stored; only its sha256 hash
-- is persisted. Redemption is single-use via invite_redemptions.
CREATE TABLE invites (
  id          TEXT PRIMARY KEY,
  code_hash   TEXT NOT NULL UNIQUE,
  email       TEXT,
  role        TEXT NOT NULL CHECK (role IN ('teacher','creator')),
  created_by  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  INTEGER NOT NULL,
  used_at     TEXT,
  created_at  TEXT NOT NULL
);

CREATE INDEX idx_invites_email ON invites(email);

-- Single-use guard: the redemption insert fails if the same code hash was
-- already consumed, even under concurrent requests.
CREATE TABLE invite_redemptions (
  code_hash  TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  used_at    TEXT NOT NULL
);
