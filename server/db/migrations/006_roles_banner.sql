-- Custom roles: a name and colour shown on members, optionally listed separately in the member list
-- ("hoist") and optionally giving admin powers.
CREATE TABLE roles (
  id         TEXT PRIMARY KEY,
  server_id  TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  color      TEXT,
  position   INTEGER NOT NULL DEFAULT 0,
  hoist      INTEGER NOT NULL DEFAULT 0,
  admin      INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX roles_server ON roles(server_id);

CREATE TABLE member_roles (
  server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id   TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (server_id, user_id, role_id)
);

-- A picture across the top of the channel list.
ALTER TABLE servers ADD COLUMN banner TEXT;
