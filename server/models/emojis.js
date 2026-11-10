const db = require('../db');
const { newId } = require('../lib/ids');

function toEmoji(row) {
  return { id: row.id, name: row.name, url: `/media/emojis/${row.id}`, serverId: row.server_id };
}

function forServer(serverId) {
  return db.prepare('SELECT * FROM emojis WHERE server_id = ? ORDER BY name').all(serverId).map(toEmoji);
}

function get(id) {
  return db.prepare('SELECT * FROM emojis WHERE id = ?').get(id);
}

function create(serverId, name, file, creatorId) {
  const id = newId();
  db.prepare('INSERT INTO emojis (id, server_id, name, file, creator_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, serverId, name, file, creatorId, Date.now());
  return get(id);
}

function nameTaken(serverId, name) {
  return Boolean(db.prepare('SELECT 1 FROM emojis WHERE server_id = ? AND name = ?').get(serverId, name));
}

function rename(id, name) {
  db.prepare('UPDATE emojis SET name = ? WHERE id = ?').run(name, id);
  return get(id);
}

function remove(id) {
  db.prepare('DELETE FROM emojis WHERE id = ?').run(id);
}

function count(serverId) {
  return db.prepare('SELECT COUNT(*) AS n FROM emojis WHERE server_id = ?').get(serverId).n;
}

module.exports = { toEmoji, forServer, get, create, nameTaken, rename, remove, count };
