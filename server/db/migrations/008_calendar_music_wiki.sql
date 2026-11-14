-- Calendar channels: events people can say they're going to.
CREATE TABLE events (
  id          TEXT PRIMARY KEY,
  channel_id  TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  creator_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  location    TEXT NOT NULL DEFAULT '',
  starts_at   INTEGER NOT NULL,
  ends_at     INTEGER,
  all_day     INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);
CREATE INDEX events_channel ON events(channel_id, starts_at);

CREATE TABLE event_rsvps (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status   TEXT NOT NULL CHECK (status IN ('going', 'maybe', 'no')),
  PRIMARY KEY (event_id, user_id)
);

-- Music channels: a shared queue that plays in sync for everyone listening.
CREATE TABLE music_queue (
  id         TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  added_by   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('youtube', 'audio')),
  source     TEXT NOT NULL,   -- a YouTube video id, or an audio file URL on this server
  title      TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX music_queue_channel ON music_queue(channel_id, id);

-- What's playing: the track, when it started (as if never paused), and when it was paused (NULL = playing).
CREATE TABLE music_state (
  channel_id TEXT PRIMARY KEY REFERENCES channels(id) ON DELETE CASCADE,
  item_id    TEXT,
  started_at INTEGER,
  paused_at  INTEGER
);

-- Wiki channels: pages anyone in the server can write, with their history.
CREATE TABLE wiki_pages (
  id         TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  content    TEXT NOT NULL DEFAULT '',
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX wiki_pages_channel ON wiki_pages(channel_id);

CREATE TABLE wiki_revisions (
  id         TEXT PRIMARY KEY,
  page_id    TEXT NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
  user_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  title      TEXT NOT NULL,
  content    TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX wiki_revisions_page ON wiki_revisions(page_id, id);
