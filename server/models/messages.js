const db = require('../db');
const { newId } = require('../lib/ids');
const { fail } = require('../lib/http');
const users = require('./users');
const channels = require('./channels');
const attachments = require('./attachments');

function serializeAll(rows) {
  const authors = users.mapByIds(rows.map((row) => row.author_id));
  const files = attachments.mapByMessageIds(rows.map((row) => row.id));
  return rows.map((row) => ({
    id: row.id,
    channelId: row.channel_id,
    author: authors.get(row.author_id),
    content: row.content,
    attachments: files.get(row.id) || [],
    editedAt: row.edited_at,
    createdAt: row.created_at,
  }));
}

function serialize(row) {
  return serializeAll([row])[0];
}

function get(id) {
  return db.prepare('SELECT * FROM messages WHERE id = ?').get(id);
}

// A page of messages, returned oldest → newest.
function list(channelId, { before, limit }) {
  const rows = before
    ? db.prepare('SELECT * FROM messages WHERE channel_id = ? AND id < ? ORDER BY id DESC LIMIT ?').all(channelId, before, limit)
    : db.prepare('SELECT * FROM messages WHERE channel_id = ? ORDER BY id DESC LIMIT ?').all(channelId, limit);
  return serializeAll(rows.reverse());
}

const create = db.transaction((channelId, authorId, content, attachmentIds) => {
  const id = newId();
  db.prepare('INSERT INTO messages (id, channel_id, author_id, content, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, channelId, authorId, content, Date.now());
  if (attachments.attach(attachmentIds, authorId, id) !== attachmentIds.length) {
    fail(400, 'One of the attachments is missing or was already sent.');
  }
  db.prepare('UPDATE channels SET last_message_id = ? WHERE id = ?').run(id, channelId);
  channels.ack(authorId, channelId, id);
  return get(id);
});

function edit(id, content) {
  db.prepare('UPDATE messages SET content = ?, edited_at = ? WHERE id = ?').run(content, Date.now(), id);
  return get(id);
}

function hasAttachments(id) {
  return attachments.pathsForMessage(id).length > 0;
}

const remove = db.transaction((message) => {
  db.prepare('DELETE FROM messages WHERE id = ?').run(message.id);
  db.prepare(`
    UPDATE channels SET last_message_id = (SELECT MAX(id) FROM messages WHERE channel_id = ?)
    WHERE id = ? AND last_message_id = ?
  `).run(message.channel_id, message.channel_id, message.id);
});

module.exports = { serialize, get, list, create, edit, hasAttachments, remove };
