-- Posts channels hold posts: each post is a channel of kind 'post' (its parent is the posts channel, its
-- name is the title and owner_id is who started it), so replies are ordinary messages.
CREATE INDEX IF NOT EXISTS channels_parent ON channels(parent_id);

-- Whiteboard channels: every pen stroke anyone has drawn, in order.
CREATE TABLE whiteboard_strokes (
  id         TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  data       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX whiteboard_strokes_channel ON whiteboard_strokes(channel_id, id);
