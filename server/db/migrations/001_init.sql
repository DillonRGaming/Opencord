CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  display_name  TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  avatar        TEXT,
  banner_color  TEXT,
  bio           TEXT NOT NULL DEFAULT '',
  status_text   TEXT NOT NULL DEFAULT '',
  settings      TEXT NOT NULL DEFAULT '{}',
  created_at    INTEGER NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

-- One row per side, like Discord: a friendship is two 'friend' rows,
-- a request is 'outgoing' for the sender and 'incoming' for the receiver.
CREATE TABLE relationships (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  other_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status     TEXT NOT NULL CHECK (status IN ('friend', 'incoming', 'outgoing', 'blocked')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, other_id)
);

CREATE TABLE servers (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  icon       TEXT,
  owner_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);

CREATE TABLE server_members (
  server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (server_id, user_id)
);
CREATE INDEX server_members_user ON server_members(user_id);

CREATE TABLE channels (
  id              TEXT PRIMARY KEY,
  server_id       TEXT REFERENCES servers(id) ON DELETE CASCADE,
  type            TEXT NOT NULL CHECK (type IN ('text', 'dm')),
  name            TEXT,
  topic           TEXT NOT NULL DEFAULT '',
  position        INTEGER NOT NULL DEFAULT 0,
  dm_key          TEXT UNIQUE,
  last_message_id TEXT,
  created_at      INTEGER NOT NULL
);
CREATE INDEX channels_server ON channels(server_id);

CREATE TABLE dm_members (
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (channel_id, user_id)
);
CREATE INDEX dm_members_user ON dm_members(user_id);

CREATE TABLE invites (
  code       TEXT PRIMARY KEY,
  server_id  TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  creator_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  uses       INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE messages (
  id         TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  author_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content    TEXT NOT NULL DEFAULT '',
  edited_at  INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX messages_channel ON messages(channel_id, id);

-- path is relative to uploads/, e.g. images/<id>.png. message_id is NULL until the message is sent.
CREATE TABLE attachments (
  id          TEXT PRIMARY KEY,
  message_id  TEXT REFERENCES messages(id) ON DELETE CASCADE,
  uploader_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('image', 'video', 'audio', 'file')),
  name        TEXT NOT NULL,
  mime        TEXT NOT NULL,
  size        INTEGER NOT NULL,
  path        TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX attachments_message ON attachments(message_id);

CREATE TABLE pending_uploads (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  mime       TEXT NOT NULL,
  size       INTEGER NOT NULL,
  received   INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE read_states (
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_id   TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  last_read_id TEXT NOT NULL,
  PRIMARY KEY (user_id, channel_id)
);
