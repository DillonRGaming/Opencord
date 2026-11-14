-- Roles people can @mention (admins can always mention any role).
ALTER TABLE roles ADD COLUMN mentionable INTEGER NOT NULL DEFAULT 0;

-- Buttons under a bot's message: [{ label, style }]. Clicking one runs the bot's "when a button is clicked" scripts.
ALTER TABLE messages ADD COLUMN components TEXT;

-- Webhooks: a secret URL that posts into a channel (for GitHub, CI, home automation…). Each has its own
-- bot user, so its messages show its name.
CREATE TABLE webhooks (
  id         TEXT PRIMARY KEY,
  server_id  TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token      TEXT NOT NULL,
  creator_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX webhooks_server ON webhooks(server_id);

-- More server settings.
ALTER TABLE servers ADD COLUMN welcome_channel_id TEXT;   -- where to greet new members (NULL = don't)
ALTER TABLE servers ADD COLUMN welcome_message TEXT;      -- with {user} and {server}
ALTER TABLE servers ADD COLUMN member_wait INTEGER NOT NULL DEFAULT 0;   -- seconds new members wait before posting
ALTER TABLE servers ADD COLUMN invites_admin_only INTEGER NOT NULL DEFAULT 0;
ALTER TABLE servers ADD COLUMN pins_admin_only INTEGER NOT NULL DEFAULT 0;
