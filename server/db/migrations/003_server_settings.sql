ALTER TABLE servers ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE servers ADD COLUMN banner_color TEXT;

ALTER TABLE channels ADD COLUMN slowmode INTEGER NOT NULL DEFAULT 0;
ALTER TABLE channels ADD COLUMN read_only INTEGER NOT NULL DEFAULT 0;

ALTER TABLE invites ADD COLUMN max_uses INTEGER;
ALTER TABLE invites ADD COLUMN expires_at INTEGER;

CREATE TABLE bans (
  server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason    TEXT NOT NULL DEFAULT '',
  banned_at INTEGER NOT NULL,
  PRIMARY KEY (server_id, user_id)
);

-- When each member last posted in a channel, for slowmode.
CREATE TABLE last_posts (
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  posted_at  INTEGER NOT NULL,
  PRIMARY KEY (channel_id, user_id)
);
