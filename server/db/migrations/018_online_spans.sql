-- When each person had Opencord open: one row per stretch of being online (ended_at NULL while it lasts).
-- Feeds the owner's per-person charts in the Dev server.
CREATE TABLE online_spans (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  started_at INTEGER NOT NULL,
  ended_at   INTEGER
);
CREATE INDEX online_spans_user ON online_spans(user_id, started_at);
