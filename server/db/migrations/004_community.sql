-- Channel kinds beyond plain text. `type` keeps its old meaning ('text' = in a server, 'dm' = private);
-- `kind` says what it is: text / voice / category for servers, dm / group for private ones.
ALTER TABLE channels ADD COLUMN kind TEXT NOT NULL DEFAULT 'text';
ALTER TABLE channels ADD COLUMN parent_id TEXT;   -- the category a server channel sits in
ALTER TABLE channels ADD COLUMN icon TEXT;        -- group DM icon
ALTER TABLE channels ADD COLUMN owner_id TEXT;    -- group DM owner
UPDATE channels SET kind = 'dm' WHERE type = 'dm';

-- Server roles: 'member' or 'admin' (the owner is servers.owner_id). Timeouts stop someone posting until a time.
ALTER TABLE server_members ADD COLUMN role TEXT NOT NULL DEFAULT 'member';
ALTER TABLE server_members ADD COLUMN timeout_until INTEGER;

ALTER TABLE users ADD COLUMN is_bot INTEGER NOT NULL DEFAULT 0;

CREATE TABLE notifications (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,                 -- mention / everyone / reply
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  actor_id   TEXT REFERENCES users(id) ON DELETE CASCADE,
  read_at    INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX notifications_user ON notifications(user_id, id);

CREATE TABLE emojis (
  id         TEXT PRIMARY KEY,
  server_id  TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  file       TEXT NOT NULL,
  creator_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (server_id, name)
);

CREATE TABLE audit_log (
  id         TEXT PRIMARY KEY,
  server_id  TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  actor_id   TEXT REFERENCES users(id) ON DELETE SET NULL,
  action     TEXT NOT NULL,
  target     TEXT NOT NULL DEFAULT '',      -- a readable name: "#general", "@sam"
  details    TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX audit_log_server ON audit_log(server_id, id);

-- Bots built with blocks. Each bot is also a user (is_bot = 1) that is a member of its server.
CREATE TABLE bots (
  id         TEXT PRIMARY KEY,
  server_id  TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  creator_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  enabled    INTEGER NOT NULL DEFAULT 1,
  program    TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL
);

CREATE TABLE bot_vars (
  bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  key    TEXT NOT NULL,
  value  TEXT NOT NULL,
  PRIMARY KEY (bot_id, key)
);
