// Moderator notes: private notes a server's moderators keep about a member.
const db = require('../db');
const { newId } = require('../lib/ids');
const users = require('./users');

function toNote(row, authors) {
  return { id: row.id, userId: row.user_id, content: row.content, createdAt: row.created_at, author: authors.get(row.author_id) || null };
}

function list(serverId, userId) {
  const rows = db.prepare('SELECT * FROM member_notes WHERE server_id = ? AND user_id = ? ORDER BY id DESC').all(serverId, userId);
  const authors = users.mapByIds(rows.map((r) => r.author_id));
  return rows.map((row) => toNote(row, authors));
}

function add(serverId, userId, authorId, content) {
  const id = newId();
  db.prepare('INSERT INTO member_notes (id, server_id, user_id, author_id, content, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, serverId, userId, authorId, content, Date.now());
  const row = db.prepare('SELECT * FROM member_notes WHERE id = ?').get(id);
  return toNote(row, users.mapByIds([authorId]));
}

function remove(serverId, noteId) {
  return db.prepare('DELETE FROM member_notes WHERE id = ? AND server_id = ?').run(noteId, serverId).changes > 0;
}

module.exports = { list, add, remove };
