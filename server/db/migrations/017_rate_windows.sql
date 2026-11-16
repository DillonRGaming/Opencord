-- Rate limits with long windows (sign-ups per day, wrong passwords…), kept here so they hold across restarts
-- and while a Cloudflare Durable Object sleeps. Short ones (seconds, a minute) stay in memory.
CREATE TABLE rate_windows (
  key      TEXT PRIMARY KEY,
  count    INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
) WITHOUT ROWID;
