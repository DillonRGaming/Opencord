const db = require('../db');
const { newId, inviteCode } = require('../lib/ids');
const users = require('./users');
const channels = require('./channels');
const emojis = require('./emojis');

function toServer(row) {
  return {
    id: row.id,
    name: row.name,
    icon: row.icon ? `/media/icons/${row.icon}` : null,
    description: row.description,
    bannerColor: row.banner_color,
    banner: row.banner ? `/media/icons/${row.banner}` : null,
    ownerId: row.owner_id,
    createdAt: row.created_at,
    channels: channels.forServer(row.id).map(channels.toChannel),
    emojis: emojis.forServer(row.id),
    adminIds: db.prepare(`SELECT user_id FROM server_members WHERE server_id = ? AND (role = 'admin'
      OR user_id IN (SELECT member_roles.user_id FROM member_roles JOIN roles ON roles.id = member_roles.role_id WHERE member_roles.server_id = ? AND roles.admin = 1))`)
      .all(row.id, row.id).map((r) => r.user_id),
    roles: roles(row.id),
    welcomeChannelId: row.welcome_channel_id || null,
    welcomeMessage: row.welcome_message || '',
    memberWait: row.member_wait || 0,
    invitesAdminOnly: Boolean(row.invites_admin_only),
    pinsAdminOnly: Boolean(row.pins_admin_only),
    commands: botCommands(row.id),
  };
}

// The !commands (also usable as /commands) of the server's switched-on bots, for the / list in the message box.
function botCommands(serverId) {
  const out = [];
  const rows = db.prepare('SELECT bots.program, users.display_name FROM bots JOIN users ON users.id = bots.user_id WHERE bots.server_id = ? AND bots.enabled = 1')
    .all(serverId);
  for (const row of rows) {
    for (const script of JSON.parse(row.program)) {
      const t = script.trigger;
      if (t?.type === 'command' && t.name && !out.some((c) => c.name === t.name)) out.push({ name: t.name, description: t.description || '', bot: row.display_name });
    }
  }
  return out;
}

function get(id) {
  return db.prepare('SELECT * FROM servers WHERE id = ?').get(id);
}

const create = db.transaction((ownerId, name) => {
  const id = newId();
  db.prepare('INSERT INTO servers (id, name, owner_id, created_at) VALUES (?, ?, ?, ?)').run(id, name, ownerId, Date.now());
  addMember(id, ownerId);
  channels.create(id, 'general');
  return get(id);
});

function forUser(userId) {
  return db.prepare(`
    SELECT servers.* FROM server_members JOIN servers ON servers.id = server_members.server_id
    WHERE server_members.user_id = ? ORDER BY server_members.joined_at
  `).all(userId);
}

function idsForUser(userId) {
  return db.prepare('SELECT server_id FROM server_members WHERE user_id = ?').all(userId).map((row) => row.server_id);
}

const COLUMNS = {
  name: 'name', icon: 'icon', banner: 'banner', description: 'description', bannerColor: 'banner_color', ownerId: 'owner_id',
  welcomeChannelId: 'welcome_channel_id', welcomeMessage: 'welcome_message', memberWait: 'member_wait',
  invitesAdminOnly: 'invites_admin_only', pinsAdminOnly: 'pins_admin_only',
};

function update(id, fields) {
  for (const [key, column] of Object.entries(COLUMNS)) {
    if (fields[key] !== undefined) db.prepare(`UPDATE servers SET ${column} = ? WHERE id = ?`).run(fields[key], id);
  }
  return get(id);
}

// --- bans ---

function isBanned(serverId, userId) {
  return Boolean(db.prepare('SELECT 1 FROM bans WHERE server_id = ? AND user_id = ?').get(serverId, userId));
}

function ban(serverId, userId, reason) {
  db.prepare('INSERT OR REPLACE INTO bans (server_id, user_id, reason, banned_at) VALUES (?, ?, ?, ?)').run(serverId, userId, reason, Date.now());
}

function unban(serverId, userId) {
  return db.prepare('DELETE FROM bans WHERE server_id = ? AND user_id = ?').run(serverId, userId).changes > 0;
}

function bans(serverId) {
  return db.prepare(`
    SELECT users.*, bans.reason, bans.banned_at FROM bans JOIN users ON users.id = bans.user_id
    WHERE bans.server_id = ? ORDER BY bans.banned_at DESC
  `).all(serverId).map((row) => ({ user: users.toUser(row), reason: row.reason, bannedAt: row.banned_at }));
}

// --- invites ---

function invites(serverId) {
  return db.prepare(`
    SELECT invites.*, users.id AS uid FROM invites JOIN users ON users.id = invites.creator_id
    WHERE invites.server_id = ? ORDER BY invites.created_at DESC
  `).all(serverId).map((row) => ({
    code: row.code, uses: row.uses, maxUses: row.max_uses, expiresAt: row.expires_at, createdAt: row.created_at,
    creator: users.toUser(users.get(row.uid)), expired: inviteDead(row),
  }));
}

function inviteDead(invite) {
  return (invite.expires_at != null && invite.expires_at <= Date.now()) || (invite.max_uses != null && invite.uses >= invite.max_uses);
}

function removeInvite(serverId, code) {
  return db.prepare('DELETE FROM invites WHERE server_id = ? AND code = ?').run(serverId, code).changes > 0;
}

function remove(id) {
  db.prepare('DELETE FROM servers WHERE id = ?').run(id);
}

function isMember(serverId, userId) {
  return Boolean(db.prepare('SELECT 1 FROM server_members WHERE server_id = ? AND user_id = ?').get(serverId, userId));
}

// New members start with every channel marked as read.
function addMember(serverId, userId) {
  db.prepare('INSERT INTO server_members (server_id, user_id, joined_at) VALUES (?, ?, ?)').run(serverId, userId, Date.now());
  db.prepare(`
    INSERT OR REPLACE INTO read_states (user_id, channel_id, last_read_id)
    SELECT ?, id, last_message_id FROM channels WHERE server_id = ? AND last_message_id IS NOT NULL
  `).run(userId, serverId);
}

function removeMember(serverId, userId) {
  db.prepare('DELETE FROM member_roles WHERE server_id = ? AND user_id = ?').run(serverId, userId);
  db.prepare('DELETE FROM server_members WHERE server_id = ? AND user_id = ?').run(serverId, userId);
}

function memberCount(serverId) {
  return db.prepare('SELECT COUNT(*) AS n FROM server_members WHERE server_id = ?').get(serverId).n;
}

function toMember(row) {
  const timedOut = row.timeout_until && row.timeout_until > Date.now() ? row.timeout_until : null;
  return { user: users.toUser(row), joinedAt: row.joined_at, role: row.role, timeoutUntil: timedOut, roleIds: memberRoleIds(row.server_id, row.id) };
}

// --- custom roles ---

function toRole(row) {
  return {
    id: row.id, name: row.name, color: row.color, position: row.position, hoist: Boolean(row.hoist), admin: Boolean(row.admin),
    mentionable: Boolean(row.mentionable),
  };
}

function roles(serverId) {
  return db.prepare('SELECT * FROM roles WHERE server_id = ? ORDER BY position, created_at').all(serverId).map(toRole);
}

function getRole(serverId, roleId) {
  return db.prepare('SELECT * FROM roles WHERE server_id = ? AND id = ?').get(serverId, roleId);
}

// New roles go to the top of the list (position 0 is the highest).
function createRole(serverId, { name, color = null, hoist = false, admin = false }) {
  const id = newId();
  db.prepare('UPDATE roles SET position = position + 1 WHERE server_id = ?').run(serverId);
  db.prepare('INSERT INTO roles (id, server_id, name, color, position, hoist, admin, created_at) VALUES (?, ?, ?, ?, 0, ?, ?, ?)')
    .run(id, serverId, name, color, hoist ? 1 : 0, admin ? 1 : 0, Date.now());
  return getRole(serverId, id);
}

const ROLE_COLUMNS = { name: 'name', color: 'color', hoist: 'hoist', admin: 'admin', mentionable: 'mentionable' };

function updateRole(serverId, roleId, fields) {
  for (const [key, column] of Object.entries(ROLE_COLUMNS)) {
    if (fields[key] === undefined) continue;
    const value = typeof fields[key] === 'boolean' ? Number(fields[key]) : fields[key];
    db.prepare(`UPDATE roles SET ${column} = ? WHERE server_id = ? AND id = ?`).run(value, serverId, roleId);
  }
  return getRole(serverId, roleId);
}

function removeRole(serverId, roleId) {
  db.prepare('DELETE FROM roles WHERE server_id = ? AND id = ?').run(serverId, roleId);
}

const orderRoles = db.transaction((serverId, ids) => {
  ids.forEach((id, index) => db.prepare('UPDATE roles SET position = ? WHERE server_id = ? AND id = ?').run(index, serverId, id));
});

function memberRoleIds(serverId, userId) {
  if (!serverId) return [];
  return db.prepare(`SELECT member_roles.role_id FROM member_roles JOIN roles ON roles.id = member_roles.role_id
    WHERE member_roles.server_id = ? AND member_roles.user_id = ? ORDER BY roles.position`).all(serverId, userId).map((r) => r.role_id);
}

function setMemberRole(serverId, userId, roleId, on) {
  if (on) db.prepare('INSERT OR IGNORE INTO member_roles (server_id, user_id, role_id) VALUES (?, ?, ?)').run(serverId, userId, roleId);
  else db.prepare('DELETE FROM member_roles WHERE server_id = ? AND user_id = ? AND role_id = ?').run(serverId, userId, roleId);
}

// 'owner' / 'admin' / 'member', or null when not in the server. A role with admin powers counts as admin.
function roleOf(serverId, userId) {
  const row = db.prepare(`SELECT server_members.role, servers.owner_id FROM server_members JOIN servers ON servers.id = server_members.server_id
    WHERE server_members.server_id = ? AND server_members.user_id = ?`).get(serverId, userId);
  if (!row) return null;
  if (row.owner_id === userId) return 'owner';
  if (row.role === 'admin') return 'admin';
  const viaRole = db.prepare(`SELECT 1 FROM member_roles JOIN roles ON roles.id = member_roles.role_id
    WHERE member_roles.server_id = ? AND member_roles.user_id = ? AND roles.admin = 1`).get(serverId, userId);
  return viaRole ? 'admin' : 'member';
}

function setRole(serverId, userId, role) {
  db.prepare('UPDATE server_members SET role = ? WHERE server_id = ? AND user_id = ?').run(role, serverId, userId);
}

function setMemberTimeout(serverId, userId, until) {
  db.prepare('UPDATE server_members SET timeout_until = ? WHERE server_id = ? AND user_id = ?').run(until, serverId, userId);
}

function timeoutUntil(serverId, userId) {
  const row = db.prepare('SELECT timeout_until FROM server_members WHERE server_id = ? AND user_id = ?').get(serverId, userId);
  return row?.timeout_until && row.timeout_until > Date.now() ? row.timeout_until : null;
}

function memberIds(serverId) {
  return db.prepare('SELECT user_id FROM server_members WHERE server_id = ?').all(serverId).map((r) => r.user_id);
}

function members(serverId) {
  return db.prepare(`
    SELECT users.*, server_members.server_id, server_members.joined_at, server_members.role, server_members.timeout_until FROM server_members JOIN users ON users.id = server_members.user_id
    WHERE server_members.server_id = ? ORDER BY users.display_name COLLATE NOCASE
  `).all(serverId).map(toMember);
}

function member(serverId, userId) {
  return toMember(db.prepare(`
    SELECT users.*, server_members.server_id, server_members.joined_at, server_members.role, server_members.timeout_until FROM server_members JOIN users ON users.id = server_members.user_id
    WHERE server_members.server_id = ? AND server_members.user_id = ?
  `).get(serverId, userId));
}

function shareServer(userId, otherId) {
  return Boolean(db.prepare(`
    SELECT 1 FROM server_members mine JOIN server_members theirs ON theirs.server_id = mine.server_id
    WHERE mine.user_id = ? AND theirs.user_id = ?
  `).get(userId, otherId));
}

function createInvite(serverId, creatorId, { maxUses = null, expiresAt = null } = {}) {
  const code = inviteCode();
  db.prepare('INSERT INTO invites (code, server_id, creator_id, created_at, max_uses, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(code, serverId, creatorId, Date.now(), maxUses, expiresAt);
  return code;
}

function getInvite(code) {
  return db.prepare('SELECT * FROM invites WHERE code = ?').get(code);
}

function countInviteUse(code) {
  db.prepare('UPDATE invites SET uses = uses + 1 WHERE code = ?').run(code);
}

function toInvite(code, server) {
  return {
    code,
    server: {
      id: server.id,
      name: server.name,
      icon: server.icon ? `/media/icons/${server.icon}` : null,
      memberCount: memberCount(server.id),
    },
  };
}

module.exports = {
  toServer, get, create, forUser, idsForUser, update, remove,
  isMember, addMember, removeMember, members, member, shareServer,
  createInvite, getInvite, countInviteUse, toInvite, invites, inviteDead, removeInvite,
  isBanned, ban, unban, bans, roleOf, setRole, setMemberTimeout, timeoutUntil, memberIds,
  roles, getRole, toRole, createRole, updateRole, removeRole, orderRoles, memberRoleIds, setMemberRole,
};
