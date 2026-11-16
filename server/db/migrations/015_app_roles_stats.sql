-- Opencord-wide roles (not server roles): 'owner' or 'admin' can open the dashboard. NULL for everyone else.
ALTER TABLE users ADD COLUMN app_role TEXT;

-- Who used the app on which day (UTC), one row per person per day. Feeds the dashboard's active-user counts.
CREATE TABLE daily_activity (
  day     TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (day, user_id)
) WITHOUT ROWID;

-- API and media requests per day (UTC). Static files aren't counted.
CREATE TABLE daily_requests (
  day      TEXT PRIMARY KEY,
  requests INTEGER NOT NULL
);
