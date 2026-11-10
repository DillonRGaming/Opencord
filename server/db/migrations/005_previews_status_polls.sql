-- Link previews worked out on the server after a message is sent, stored with it as JSON.
ALTER TABLE messages ADD COLUMN embeds TEXT;

-- What someone has chosen to appear as: online / idle / dnd / invisible.
ALTER TABLE users ADD COLUMN presence TEXT NOT NULL DEFAULT 'online';

CREATE TABLE polls (
  message_id TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
  question   TEXT NOT NULL,
  options    TEXT NOT NULL,              -- JSON list of option texts
  multi      INTEGER NOT NULL DEFAULT 0, -- 1: people can pick more than one
  closes_at  INTEGER
);

CREATE TABLE poll_votes (
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  option     INTEGER NOT NULL,
  PRIMARY KEY (message_id, user_id, option)
);

-- Cached page details for link previews, so a popular link is only fetched once a day.
CREATE TABLE link_cache (
  url        TEXT PRIMARY KEY,
  data       TEXT,
  fetched_at INTEGER NOT NULL
);
