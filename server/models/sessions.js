const db = require('../db');

function create(tokenHash, userId, expiresAt) {
  db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .run(tokenHash, userId, Date.now(), expiresAt);
}

function findUser(tokenHash) {
  return db.prepare(`
    SELECT users.* FROM sessions JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ? AND users.suspended_at IS NULL
  `).get(tokenHash, Date.now());
}

function remove(tokenHash) {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
}

// Returns the hashes that were removed so their sockets can be disconnected.
function removeOthers(userId, keepHash) {
  return db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ? RETURNING token_hash')
    .all(userId, keepHash).map((row) => row.token_hash);
}

// Ends every session of a user. Returns the hashes so their sockets can be disconnected.
function removeAll(userId) {
  return db.prepare('DELETE FROM sessions WHERE user_id = ? RETURNING token_hash').all(userId).map((row) => row.token_hash);
}

function removeExpired() {
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
}

module.exports = { create, findUser, remove, removeOthers, removeAll, removeExpired };
