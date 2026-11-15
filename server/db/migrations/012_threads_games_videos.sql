-- Threads: a reply in a thread keeps the id of the message the thread hangs off, and stays out of the main chat.
ALTER TABLE messages ADD COLUMN thread_id TEXT;
CREATE INDEX messages_thread ON messages(thread_id, id) WHERE thread_id IS NOT NULL;

-- Games played in chat (/chess @someone …). One per message; state is the game's own JSON.
CREATE TABLE games (
  message_id TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
  game       TEXT NOT NULL,
  players    TEXT NOT NULL,   -- JSON [userId, userId]
  state      TEXT NOT NULL,   -- JSON, see server/lib/games.js
  updated_at INTEGER NOT NULL
);

-- Video channels: the shared library of links and uploaded videos people added.
CREATE TABLE channel_videos (
  id         TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  added_by   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('youtube', 'file')),
  source     TEXT NOT NULL,   -- a YouTube video id, or an attachment URL on this server
  title      TEXT NOT NULL,
  author     TEXT NOT NULL DEFAULT '',
  message_id TEXT REFERENCES messages(id) ON DELETE CASCADE, -- uploads hang off a hidden message, for access and clean-up
  created_at INTEGER NOT NULL
);
CREATE INDEX channel_videos_channel ON channel_videos(channel_id, id);

-- Music channels: shared playback speed.
ALTER TABLE music_state ADD COLUMN rate REAL NOT NULL DEFAULT 1;
