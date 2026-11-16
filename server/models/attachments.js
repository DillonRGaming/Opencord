const db = require('../db');

function toAttachment(row) {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    mime: row.mime,
    size: row.size,
    url: `/media/attachments/${row.id}/${encodeURIComponent(row.name)}`,
  };
}

function get(id) {
  return db.prepare('SELECT * FROM attachments WHERE id = ?').get(id);
}

function create({ id, uploaderId, kind, name, mime, size, path }) {
  db.prepare(`
    INSERT INTO attachments (id, uploader_id, kind, name, mime, size, path, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, uploaderId, kind, name, mime, size, path, Date.now());
  return get(id);
}

// Attaches unsent uploads to a message. Returns how many were attached.
function attach(ids, uploaderId, messageId) {
  return db.prepare(`
    UPDATE attachments SET message_id = ?
    WHERE uploader_id = ? AND message_id IS NULL AND id IN (SELECT value FROM json_each(?))
  `).run(messageId, uploaderId, JSON.stringify(ids)).changes;
}

// Map of messageId → Attachment JSON[].
function mapByMessageIds(messageIds) {
  const rows = db.prepare('SELECT * FROM attachments WHERE message_id IN (SELECT value FROM json_each(?)) ORDER BY id')
    .all(JSON.stringify(messageIds));
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.message_id)) map.set(row.message_id, []);
    map.get(row.message_id).push(toAttachment(row));
  }
  return map;
}

// File paths that must be deleted from disk along with a message, channel or server.
function pathsForMessage(messageId) {
  return db.prepare('SELECT path FROM attachments WHERE message_id = ?').all(messageId).map((row) => row.path);
}

function pathsForChannel(channelId) {
  return db.prepare(`
    SELECT attachments.path FROM attachments JOIN messages ON messages.id = attachments.message_id
    WHERE messages.channel_id = ?
  `).all(channelId).map((row) => row.path);
}

function pathsForServer(serverId) {
  return db.prepare(`
    SELECT attachments.path FROM attachments
    JOIN messages ON messages.id = attachments.message_id
    JOIN channels ON channels.id = messages.channel_id
    WHERE channels.server_id = ?
  `).all(serverId).map((row) => row.path);
}

// Uploaded but never sent in a message. Returns the removed rows' paths.
function removeUnsentBefore(time) {
  return db.prepare('DELETE FROM attachments WHERE message_id IS NULL AND created_at < ? RETURNING path')
    .all(time).map((row) => row.path);
}

// --- uploads still in progress ---

function createPending({ id, userId, name, mime, size }) {
  db.prepare('INSERT INTO pending_uploads (id, user_id, name, mime, size, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, userId, name, mime, size, Date.now());
}

function getPending(id, userId) {
  return db.prepare('SELECT * FROM pending_uploads WHERE id = ? AND user_id = ?').get(id, userId);
}

function setReceived(id, received) {
  db.prepare('UPDATE pending_uploads SET received = ? WHERE id = ?').run(received, id);
}

function removePending(id) {
  db.prepare('DELETE FROM pending_uploads WHERE id = ?').run(id);
}

// Bytes that in-progress uploads still expect to write, so disk space isn't promised twice.
// Bytes someone has uploaded (sent or not) plus what they're still uploading.
function bytesBy(userId) {
  return db.prepare('SELECT COALESCE(SUM(size), 0) AS n FROM attachments WHERE uploader_id = ?').get(userId).n
    + db.prepare('SELECT COALESCE(SUM(size), 0) AS n FROM pending_uploads WHERE user_id = ?').get(userId).n;
}

// Bytes of every upload, finished or still arriving.
function totalBytes() {
  return db.prepare('SELECT COALESCE(SUM(size), 0) AS n FROM attachments').get().n
    + db.prepare('SELECT COALESCE(SUM(size), 0) AS n FROM pending_uploads').get().n;
}

function pendingCount(userId) {
  return db.prepare('SELECT COUNT(*) AS n FROM pending_uploads WHERE user_id = ?').get(userId).n;
}

function pendingBytes() {
  return db.prepare('SELECT COALESCE(SUM(size - received), 0) AS n FROM pending_uploads').get().n;
}

function removePendingBefore(time) {
  return db.prepare('DELETE FROM pending_uploads WHERE created_at < ? RETURNING id').all(time).map((row) => row.id);
}

module.exports = {
  toAttachment, get, create, attach, mapByMessageIds,
  pathsForMessage, pathsForChannel, pathsForServer, removeUnsentBefore,
  createPending, getPending, setReceived, removePending, pendingBytes, removePendingBefore, bytesBy, totalBytes, pendingCount,
};
