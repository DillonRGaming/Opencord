const db = require('../db');
const { toUser } = require('./users');

function get(userId, otherId) {
  return db.prepare('SELECT * FROM relationships WHERE user_id = ? AND other_id = ?').get(userId, otherId);
}

function set(userId, otherId, status) {
  db.prepare(`
    INSERT INTO relationships (user_id, other_id, status, created_at) VALUES (?, ?, ?, ?)
    ON CONFLICT (user_id, other_id) DO UPDATE SET status = excluded.status, created_at = excluded.created_at
  `).run(userId, otherId, status, Date.now());
}

function remove(userId, otherId) {
  db.prepare('DELETE FROM relationships WHERE user_id = ? AND other_id = ?').run(userId, otherId);
}

const setBoth = db.transaction((userId, otherId, mine, theirs) => {
  set(userId, otherId, mine);
  set(otherId, userId, theirs);
});

const removeBoth = db.transaction((userId, otherId) => {
  remove(userId, otherId);
  remove(otherId, userId);
});

// Blocks otherId. Their side is removed too, unless they have blocked this user themselves.
// Returns true if their side was removed.
const block = db.transaction((userId, otherId) => {
  const theirs = get(otherId, userId);
  const removeTheirs = Boolean(theirs && theirs.status !== 'blocked');
  if (removeTheirs) remove(otherId, userId);
  set(userId, otherId, 'blocked');
  return removeTheirs;
});

function eitherBlocked(userId, otherId) {
  return Boolean(db.prepare(`
    SELECT 1 FROM relationships
    WHERE status = 'blocked' AND ((user_id = ? AND other_id = ?) OR (user_id = ? AND other_id = ?))
  `).get(userId, otherId, otherId, userId));
}

function areFriends(userId, otherId) {
  return get(userId, otherId)?.status === 'friend';
}

const RELATION_SQL = `
  SELECT users.*, relationships.status AS rel_status, relationships.created_at AS rel_since
  FROM relationships JOIN users ON users.id = relationships.other_id
  WHERE relationships.user_id = ?`;

function toRelation(row) {
  return { user: toUser(row), status: row.rel_status, since: row.rel_since };
}

function list(userId) {
  return db.prepare(`${RELATION_SQL} ORDER BY users.username`).all(userId).map(toRelation);
}

function relation(userId, otherId) {
  return toRelation(db.prepare(`${RELATION_SQL} AND relationships.other_id = ?`).get(userId, otherId));
}

// Friend requests waiting for this person to accept (for the account switcher's count).
function incomingCount(userId) {
  return db.prepare("SELECT COUNT(*) AS n FROM relationships WHERE user_id = ? AND status = 'incoming'").get(userId).n;
}

module.exports = { get, setBoth, removeBoth, remove, block, eitherBlocked, areFriends, list, relation, incomingCount };
