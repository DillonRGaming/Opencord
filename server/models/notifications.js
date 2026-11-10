const db = require('../db');
const { newId } = require('../lib/ids');

// Who a new message should notify, and how: { userId → kind }. Mentions beat @everyone, which beats replies.
function recipients(content, audienceIds, authorId, replyAuthorId) {
  const out = new Map();
  const audience = new Set(audienceIds);
  audience.delete(authorId);
  if (replyAuthorId && audience.has(replyAuthorId)) out.set(replyAuthorId, 'reply');
  if (/(?<![\w@])@(everyone|here)(?![a-z0-9_.])/i.test(content)) for (const id of audience) out.set(id, 'everyone');
  const names = [...content.matchAll(/(?<![\w@])@([a-z0-9_.]{2,32})/gi)].map((m) => m[1].toLowerCase());
  if (names.length) {
    const rows = db.prepare('SELECT id FROM users WHERE username IN (SELECT value FROM json_each(?))').all(JSON.stringify(names));
    for (const { id } of rows) if (audience.has(id)) out.set(id, 'mention');
  }
  return out;
}

function create(userId, kind, messageId, actorId) {
  const id = newId();
  db.prepare('INSERT INTO notifications (id, user_id, kind, message_id, actor_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, userId, kind, messageId, actorId, Date.now());
  return get(id);
}

function get(id) {
  return db.prepare('SELECT * FROM notifications WHERE id = ?').get(id);
}

function list(userId, limit = 100) {
  return db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT ?').all(userId, limit);
}

function unreadCount(userId) {
  return db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL').get(userId).n;
}

function markRead(userId, ids) {
  const now = Date.now();
  if (!ids) return db.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL').run(now, userId);
  return db.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND id IN (SELECT value FROM json_each(?))')
    .run(now, userId, JSON.stringify(ids));
}

// Opening a channel clears its notifications.
function markChannelRead(userId, channelId) {
  db.prepare(`UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL
    AND message_id IN (SELECT id FROM messages WHERE channel_id = ?)`).run(Date.now(), userId, channelId);
}

function remove(userId, id) {
  return db.prepare('DELETE FROM notifications WHERE user_id = ? AND id = ?').run(userId, id).changes > 0;
}

module.exports = { recipients, create, list, unreadCount, markRead, markChannelRead, remove };
