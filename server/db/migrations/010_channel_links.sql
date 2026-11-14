-- Linked channels: text channels (in servers with the same owner) that share their messages. A message
-- posted in one is copied into the others; relay_of points a copy at the original.
CREATE TABLE channel_links (
  channel_id TEXT PRIMARY KEY REFERENCES channels(id) ON DELETE CASCADE,
  group_id   TEXT NOT NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX channel_links_group ON channel_links(group_id);

ALTER TABLE messages ADD COLUMN relay_of TEXT;   -- the original message, for a copy in a linked channel
ALTER TABLE messages ADD COLUMN relay TEXT;      -- where the original was: { server, channel }
CREATE INDEX messages_relay_of ON messages(relay_of);
