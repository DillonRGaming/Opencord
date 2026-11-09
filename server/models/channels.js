const db = require('../db');
const { newId } = require('../lib/ids');
const users = require('./users');

function toChannel(row) {
  return {
    id: row.id,
    type: 'text',
    serverId: row.server_id,
    name: row.name,
    topic: row.topic,
    position: row.position,
    lastMessageId: row.last_message_id,
  };
}

// A DM looks different to each member: `recipient` is the other person.
function toDm(row, viewerId) {
  const recipientId = dmMemberIds(row.id).find((id) => id !== viewerId);
  return { id: row.id, type: 'dm', recipient: users.toUser(users.get(recipientId)), lastMessageId: row.last_message_id };
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

function create(serverId, name) {
  const id = newId();
  db.prepare(`
    INSERT INTO channels (id, server_id, type, name, position, created_at)
    VALUES (?, ?, 'text', ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM channels WHERE server_id = ?), ?)
  `).run(id, serverId, name, serverId, Date.now());
  return get(id);
}

function update(id, { name, topic }) {
  if (name !== undefined) db.prepare('UPDATE channels SET name = ? WHERE id = ?').run(name, id);
  if (topic !== undefined) db.prepare('UPDATE channels SET topic = ? WHERE id = ?').run(topic, id);
  return get(id);
}

function remove(id) {
  db.prepare('DELETE FROM channels WHERE id = ?').run(id);
}

const getOrCreateDm = db.transaction((userId, otherId) => {
  const dmKey = [userId, otherId].sort().join(':');
  const existing = db.prepare('SELECT * FROM channels WHERE dm_key = ?').get(dmKey);
  if (existing) return existing;
  const id = newId();
  db.prepare("INSERT INTO channels (id, type, dm_key, created_at) VALUES (?, 'dm', ?, ?)").run(id, dmKey, Date.now());
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
    WHERE dm_members.user_id = ? AND channels.last_message_id IS NOT NULL
    ORDER BY channels.last_message_id DESC
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
  toChannel, serialize, get, forServer, create, update, remove,
  getOrCreateDm, dmMemberIds, dmsForUser, canAccess, readStates, ack,
};
