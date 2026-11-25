-- Phones that want push notifications (Firebase Cloud Messaging): one row per app install that's logged in.
-- Tied to the login, so logging out stops pushes to that phone.
CREATE TABLE push_tokens (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX push_tokens_user ON push_tokens(user_id);
