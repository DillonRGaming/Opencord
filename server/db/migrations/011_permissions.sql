-- Role permissions: a JSON list of what the role lets people do (see PERMISSIONS in models/servers.js).
ALTER TABLE roles ADD COLUMN perms TEXT NOT NULL DEFAULT '[]';

-- Channel permissions. view_roles: NULL = everyone can see the channel, else only these roles (and admins).
-- post_roles: who can post besides admins when the channel is admins-only (read_only = 1).
ALTER TABLE channels ADD COLUMN view_roles TEXT;
ALTER TABLE channels ADD COLUMN post_roles TEXT;
