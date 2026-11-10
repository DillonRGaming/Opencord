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
    ownerId: row.owner_id,
    createdAt: row.created_at,
    channels: channels.forServer(row.id).map(channels.toChannel),
    emojis: emojis.forServer(row.id),
    adminIds: db.prepare("SELECT user_id FROM server_members WHERE server_id = ? AND role = 'admin'").all(row.id).map((r) => r.user_id),
  };
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

const COLUMNS = { name: 'name', icon: 'icon', description: 'description', bannerColor: 'banner_color', ownerId: 'owner_id' };

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
  db.prepare('DELETE FROM server_members WHERE server_id = ? AND user_id = ?').run(serverId, userId);
}

function memberCount(serverId) {
  return db.prepare('SELECT COUNT(*) AS n FROM server_members WHERE server_id = ?').get(serverId).n;
}

function toMember(row) {
  const timedOut = row.timeout_until && row.timeout_until > Date.now() ? row.timeout_until : null;
  return { user: users.toUser(row), joinedAt: row.joined_at, role: row.role, timeoutUntil: timedOut };
}

// 'owner' / 'admin' / 'member', or null when not in the server.
function roleOf(serverId, userId) {
  const row = db.prepare(`SELECT server_members.role, servers.owner_id FROM server_members JOIN servers ON servers.id = server_members.server_id
    WHERE server_members.server_id = ? AND server_members.user_id = ?`).get(serverId, userId);
  if (!row) return null;
  return row.owner_id === userId ? 'owner' : row.role;
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
    SELECT users.*, server_members.joined_at, server_members.role, server_members.timeout_until FROM server_members JOIN users ON users.id = server_members.user_id
    WHERE server_members.server_id = ? ORDER BY users.display_name COLLATE NOCASE
  `).all(serverId).map(toMember);
}

function member(serverId, userId) {
  return toMember(db.prepare(`
    SELECT users.*, server_members.joined_at, server_members.role, server_members.timeout_until FROM server_members JOIN users ON users.id = server_members.user_id
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
};
