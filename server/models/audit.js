const db = require('../db');
const { newId } = require('../lib/ids');
const users = require('./users');

function log(serverId, actorId, action, target = '', details = '') {
  db.prepare('INSERT INTO audit_log (id, server_id, actor_id, action, target, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(newId(), serverId, actorId, action, String(target).slice(0, 200), String(details).slice(0, 500), Date.now());
}

function list(serverId, { before, limit = 100 } = {}) {
  const rows = before
    ? db.prepare('SELECT * FROM audit_log WHERE server_id = ? AND id < ? ORDER BY id DESC LIMIT ?').all(serverId, before, limit)
    : db.prepare('SELECT * FROM audit_log WHERE server_id = ? ORDER BY id DESC LIMIT ?').all(serverId, limit);
  const actors = users.mapByIds(rows.map((r) => r.actor_id).filter(Boolean));
  return rows.map((row) => ({
    id: row.id, action: row.action, target: row.target, details: row.details, createdAt: row.created_at,
    actor: actors.get(row.actor_id) || null,
  }));
}

module.exports = { log, list };
