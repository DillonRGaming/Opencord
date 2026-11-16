-- Video channels use the same shared queue and player as music channels, so the queue also takes video files.
CREATE TABLE music_queue_new (
  id         TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  added_by   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('youtube', 'audio', 'video')),
  source     TEXT NOT NULL,   -- a YouTube video id, or an audio/video file URL on this server
  title      TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
INSERT INTO music_queue_new (id, channel_id, added_by, kind, source, title, created_at)
  SELECT id, channel_id, added_by, kind, source, title, created_at FROM music_queue;
DROP TABLE music_queue;
ALTER TABLE music_queue_new RENAME TO music_queue;
CREATE INDEX music_queue_channel ON music_queue(channel_id, id);
