-- When someone was last online (shown only if they turn on "Show when I was last online").
ALTER TABLE users ADD COLUMN last_seen INTEGER;

-- Private notes moderators keep about a member. Only people who can moderate members see them.
CREATE TABLE member_notes (
  id         TEXT PRIMARY KEY,
  server_id  TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  author_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content    TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX member_notes_member ON member_notes(server_id, user_id, id);
