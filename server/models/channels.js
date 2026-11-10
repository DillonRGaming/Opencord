const db = require('../db');
const { newId } = require('../lib/ids');
const users = require('./users');

function toChannel(row) {
  return {
    id: row.id,
    type: 'text',
    kind: row.kind,
    parentId: row.parent_id,
    serverId: row.server_id,
    name: row.name,
    topic: row.topic,
    position: row.position,
    slowmode: row.slowmode,
    readOnly: Boolean(row.read_only),
    lastMessageId: row.last_message_id,
  };
}

// A DM looks different to each member: `recipient` is the other person. Group DMs list everyone else.
function toDm(row, viewerId) {
  const others = dmMemberIds(row.id).filter((id) => id !== viewerId);
  if (row.kind === 'group') {
    const people = users.mapByIds(others);
    return {
      id: row.id, type: 'dm', kind: 'group', name: row.name || '', icon: row.icon ? `/media/icons/${row.icon}` : null,
      ownerId: row.owner_id, recipients: others.map((id) => people.get(id)).filter(Boolean), lastMessageId: row.last_message_id,
      createdAt: row.created_at,
    };
  }
  return { id: row.id, type: 'dm', kind: 'dm', recipient: users.toUser(users.get(others[0])), lastMessageId: row.last_message_id };
}

const createGroup = db.transaction((ownerId, memberIds, name = '') => {
  const id = newId();
  db.prepare("INSERT INTO channels (id, type, kind, name, owner_id, last_message_id, created_at) VALUES (?, 'dm', 'group', ?, ?, NULL, ?)")
    .run(id, name, ownerId, Date.now());
  const add = db.prepare('INSERT OR IGNORE INTO dm_members (channel_id, user_id) VALUES (?, ?)');
  for (const userId of new Set([ownerId, ...memberIds])) add.run(id, userId);
  return get(id);
});

function addDmMember(channelId, userId) {
  db.prepare('INSERT OR IGNORE INTO dm_members (channel_id, user_id) VALUES (?, ?)').run(channelId, userId);
}

function removeDmMember(channelId, userId) {
  db.prepare('DELETE FROM dm_members WHERE channel_id = ? AND user_id = ?').run(channelId, userId);
}

function setGroup(id, { name, icon, ownerId }) {
  if (name !== undefined) db.prepare('UPDATE channels SET name = ? WHERE id = ?').run(name, id);
  if (icon !== undefined) db.prepare('UPDATE channels SET icon = ? WHERE id = ?').run(icon, id);
  if (ownerId !== undefined) db.prepare('UPDATE channels SET owner_id = ? WHERE id = ?').run(ownerId, id);
  return get(id);
}

function serialize(row, viewerId) {
  return row.type === 'dm' ? toDm(row, viewerId) : toChannel(row);
}

function get(id) {
  return db.prepare('SELECT * FROM channels WHERE id = ?').get(id);
}

function forServer(serverId) {
  return db.prepare('SELECT * FROM channels WHERE server_id = ? ORDER BY position, id').all(serverId);
}

function create(serverId, name, { kind = 'text', parentId = null } = {}) {
  const id = newId();
  db.prepare(`
    INSERT INTO channels (id, server_id, type, kind, parent_id, name, position, created_at)
    VALUES (?, ?, 'text', ?, ?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM channels WHERE server_id = ?), ?)
  `).run(id, serverId, kind, parentId, name, serverId, Date.now());
  return get(id);
}

const COLUMNS = { name: 'name', topic: 'topic', slowmode: 'slowmode', readOnly: 'read_only', parentId: 'parent_id' };

function update(id, fields) {
  for (const [key, column] of Object.entries(COLUMNS)) {
    if (fields[key] !== undefined) db.prepare(`UPDATE channels SET ${column} = ? WHERE id = ?`).run(fields[key], id);
  }
  return get(id);
}

// `ids` is the server's channels in their new order; any it leaves out keep their place at the end.
const reorder = db.transaction((serverId, ids) => {
  const rest = forServer(serverId).map((c) => c.id).filter((id) => !ids.includes(id));
  [...ids, ...rest].forEach((id, position) => {
    db.prepare('UPDATE channels SET position = ? WHERE id = ? AND server_id = ?').run(position, id, serverId);
  });
});

// Seconds the user still has to wait before posting again, 0 when they can post.
function slowmodeWait(channel, userId) {
  if (!channel.slowmode) return 0;
  const row = db.prepare('SELECT posted_at FROM last_posts WHERE channel_id = ? AND user_id = ?').get(channel.id, userId);
  if (!row) return 0;
  return Math.max(0, Math.ceil((row.posted_at + channel.slowmode * 1000 - Date.now()) / 1000));
}

function notePost(channelId, userId) {
  db.prepare('INSERT OR REPLACE INTO last_posts (channel_id, user_id, posted_at) VALUES (?, ?, ?)').run(channelId, userId, Date.now());
}

function remove(id) {
  db.prepare('DELETE FROM channels WHERE id = ?').run(id);
}

const getOrCreateDm = db.transaction((userId, otherId) => {
  const dmKey = [userId, otherId].sort().join(':');
  const existing = db.prepare('SELECT * FROM channels WHERE dm_key = ?').get(dmKey);
  if (existing) return existing;
  const id = newId();
  db.prepare("INSERT INTO channels (id, type, kind, dm_key, created_at) VALUES (?, 'dm', 'dm', ?, ?)").run(id, dmKey, Date.now());
  const addMember = db.prepare('INSERT INTO dm_members (channel_id, user_id) VALUES (?, ?)');
  addMember.run(id, userId);
  addMember.run(id, otherId);
  return get(id);
});

function dmMemberIds(channelId) {
  return db.prepare('SELECT user_id FROM dm_members WHERE channel_id = ?').all(channelId).map((row) => row.user_id);
}

// DMs that have at least one message, newest first.
function dmsForUser(userId) {
  return db.prepare(`
    SELECT channels.* FROM dm_members JOIN channels ON channels.id = dm_members.channel_id
    WHERE dm_members.user_id = ? AND (channels.last_message_id IS NOT NULL OR channels.kind = 'group')
    ORDER BY COALESCE(channels.last_message_id, channels.id) DESC
  `).all(userId).map((row) => toDm(row, userId));
}

function canAccess(userId, channel) {
  const sql = channel.type === 'dm'
    ? 'SELECT 1 FROM dm_members WHERE channel_id = ? AND user_id = ?'
    : 'SELECT 1 FROM server_members WHERE server_id = ? AND user_id = ?';
  return Boolean(db.prepare(sql).get(channel.type === 'dm' ? channel.id : channel.server_id, userId));
}

function readStates(userId) {
  const rows = db.prepare('SELECT channel_id, last_read_id FROM read_states WHERE user_id = ?').all(userId);
  return Object.fromEntries(rows.map((row) => [row.channel_id, row.last_read_id]));
}

// Read states only move forwards.
function ack(userId, channelId, messageId) {
  db.prepare(`
    INSERT INTO read_states (user_id, channel_id, last_read_id) VALUES (?, ?, ?)
    ON CONFLICT (user_id, channel_id) DO UPDATE SET last_read_id = MAX(last_read_id, excluded.last_read_id)
  `).run(userId, channelId, messageId);
}

module.exports = {
  createGroup, addDmMember, removeDmMember, setGroup,
  reorder, slowmodeWait, notePost,
  toChannel, serialize, get, forServer, create, update, remove,
  getOrCreateDm, dmMemberIds, dmsForUser, canAccess, readStates, ack,
};
