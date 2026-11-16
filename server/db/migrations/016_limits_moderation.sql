-- How often each limit stopped someone, per day (UTC). Shown on the dashboard.
CREATE TABLE daily_limit_hits (
  day  TEXT NOT NULL,
  kind TEXT NOT NULL,
  hits INTEGER NOT NULL,
  PRIMARY KEY (day, kind)
) WITHOUT ROWID;

-- App-wide switches the owner sets from the dashboard (e.g. who may sign up).
CREATE TABLE app_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Accounts the owner or an admin suspended: they can't log in and their sessions are gone.
ALTER TABLE users ADD COLUMN suspended_at INTEGER;
ALTER TABLE users ADD COLUMN suspended_reason TEXT;
