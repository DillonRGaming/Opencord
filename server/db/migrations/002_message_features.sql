-- Replies, pins and reactions.
ALTER TABLE messages ADD COLUMN reply_to_id TEXT;
ALTER TABLE messages ADD COLUMN pinned_at INTEGER;
CREATE INDEX messages_pinned ON messages(channel_id, pinned_at) WHERE pinned_at IS NOT NULL;

CREATE TABLE reactions (
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji      TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (message_id, user_id, emoji)
);
