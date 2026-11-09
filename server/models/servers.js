const db = require('../db');
const { newId, inviteCode } = require('../lib/ids');
const users = require('./users');
const channels = require('./channels');

function toServer(row) {
  return {
    id: row.id,
    name: row.name,
    icon: row.icon ? `/media/icons/${row.icon}` : null,
    ownerId: row.owner_id,
    channels: channels.forServer(row.id).map(channels.toChannel),
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

function update(id, { name, icon }) {
  if (name !== undefined) db.prepare('UPDATE servers SET name = ? WHERE id = ?').run(name, id);
  if (icon !== undefined) db.prepare('UPDATE servers SET icon = ? WHERE id = ?').run(icon, id);
  return get(id);
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
  return { user: users.toUser(row), joinedAt: row.joined_at };
}

function members(serverId) {
  return db.prepare(`
    SELECT users.*, server_members.joined_at FROM server_members JOIN users ON users.id = server_members.user_id
    WHERE server_members.server_id = ? ORDER BY users.display_name COLLATE NOCASE
  `).all(serverId).map(toMember);
}

function member(serverId, userId) {
  return toMember(db.prepare(`
    SELECT users.*, server_members.joined_at FROM server_members JOIN users ON users.id = server_members.user_id
    WHERE server_members.server_id = ? AND server_members.user_id = ?
  `).get(serverId, userId));
}

function shareServer(userId, otherId) {
  return Boolean(db.prepare(`
    SELECT 1 FROM server_members mine JOIN server_members theirs ON theirs.server_id = mine.server_id
    WHERE mine.user_id = ? AND theirs.user_id = ?
  `).get(userId, otherId));
}

function createInvite(serverId, creatorId) {
  const code = inviteCode();
  db.prepare('INSERT INTO invites (code, server_id, creator_id, created_at) VALUES (?, ?, ?, ?)')
    .run(code, serverId, creatorId, Date.now());
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
  createInvite, getInvite, countInviteUse, toInvite,
};
