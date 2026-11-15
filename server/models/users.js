const db = require('../db');
const { newId } = require('../lib/ids');

function toUser(row) {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatar: row.avatar ? `/media/avatars/${row.avatar}` : null,
    bannerColor: row.banner_color,
    bio: row.bio,
    statusText: row.status_text,
    bot: Boolean(row.is_bot),
    lastSeen: row.last_seen && settingFrom(row, 'showLastSeen', false) ? row.last_seen : null,
  };
}

function settingFrom(row, key, fallback) {
  try {
    return JSON.parse(row.settings || '{}')[key] ?? fallback;
  } catch {
    return fallback;
  }
}

function toMe(row) {
  return { ...toUser(row), settings: JSON.parse(row.settings), createdAt: row.created_at, presence: row.presence || 'online' };
}

function create({ username, displayName, passwordHash }) {
  const id = newId();
  db.prepare('INSERT INTO users (id, username, display_name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, username, displayName, passwordHash, Date.now());
  return get(id);
}

function get(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function getByUsername(username) {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username);
}

// Map of id → User JSON, for attaching authors to a page of messages.
function mapByIds(ids) {
  const rows = db.prepare('SELECT * FROM users WHERE id IN (SELECT value FROM json_each(?))')
    .all(JSON.stringify([...new Set(ids)]));
  return new Map(rows.map((row) => [row.id, toUser(row)]));
}

const COLUMNS = {
  displayName: 'display_name',
  bio: 'bio',
  statusText: 'status_text',
  bannerColor: 'banner_color',
  settings: 'settings',
  avatar: 'avatar',
  passwordHash: 'password_hash',
  presence: 'presence',
};

function update(id, fields) {
  for (const [key, value] of Object.entries(fields)) {
    db.prepare(`UPDATE users SET ${COLUMNS[key]} = ? WHERE id = ?`).run(value, id);
  }
  return get(id);
}

// Everyone who should hear about this user's presence and profile changes: friends and server co-members.
function audienceIds(userId) {
  return db.prepare(`
    SELECT other_id AS id FROM relationships WHERE user_id = ? AND status = 'friend'
    UNION
    SELECT theirs.user_id FROM server_members mine
    JOIN server_members theirs ON theirs.server_id = mine.server_id
    WHERE mine.user_id = ? AND theirs.user_id != ?
  `).all(userId, userId, userId).map((row) => row.id);
}

// One of someone's settings (they're stored as JSON), or `fallback`.
function settingOf(userId, key, fallback) {
  const row = db.prepare('SELECT settings FROM users WHERE id = ?').get(userId);
  return row ? settingFrom(row, key, fallback) : fallback;
}

function touchLastSeen(id) {
  db.prepare('UPDATE users SET last_seen = ? WHERE id = ?').run(Date.now(), id);
}

module.exports = {
  settingOf, touchLastSeen, toUser, toMe, create, get, getByUsername, mapByIds, update, audienceIds };
