const db = require('../db');
const { newId } = require('../lib/ids');

// Built-in avatars (the logo on a colour) live in public/avatars/<n>.svg and are stored as "@default/<n>".
// Everyone starts with a random one.
const DEFAULT_AVATARS = 10;
const DEFAULT_PREFIX = '@default/';

// Patterns that can be drawn over a profile banner (public/js/patterns.js draws them).
const BANNER_PATTERNS = ['dots', 'lines', 'chainlink', 'checks', 'waves', 'zigzag', 'plus'];

function isDefaultAvatar(value) {
  return typeof value === 'string' && value.startsWith(DEFAULT_PREFIX);
}

function avatarUrl(value) {
  if (!value) return null;
  return isDefaultAvatar(value) ? `/avatars/${value.slice(DEFAULT_PREFIX.length)}.svg` : `/media/avatars/${value}`;
}

function defaultAvatar(n = 1 + Math.floor(Math.random() * DEFAULT_AVATARS)) {
  return `${DEFAULT_PREFIX}${n}`;
}

function toUser(row) {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatar: avatarUrl(row.avatar),
    bannerColor: row.banner_color,
    bannerPattern: row.banner_pattern,
    bannerPatternColor: row.banner_pattern_color,
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
  return {
    ...toUser(row), settings: JSON.parse(row.settings), createdAt: row.created_at, presence: row.presence || 'online',
    appRole: row.app_role || null,
  };
}

function create({ username, displayName, passwordHash }) {
  const id = newId();
  db.prepare('INSERT INTO users (id, username, display_name, password_hash, avatar, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, username, displayName, passwordHash, defaultAvatar(), Date.now());
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
  bannerPattern: 'banner_pattern',
  bannerPatternColor: 'banner_pattern_color',
  settings: 'settings',
  avatar: 'avatar',
  passwordHash: 'password_hash',
  presence: 'presence',
  appRole: 'app_role',
  suspendedAt: 'suspended_at',
  suspendedReason: 'suspended_reason',
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

// The profile parts of a request body (name, bio, status, banner), checked. Used for people and for bots.
function profileFields({ displayName, bio, statusText, bannerColor, bannerPattern, bannerPatternColor }) {
  const { fail, text } = require('../lib/http');
  const fields = {};
  if (displayName !== undefined) fields.displayName = text(displayName, 'Display name', { min: 1, max: 32 });
  if (bio !== undefined) fields.bio = text(bio, 'Bio', { max: 190 });
  if (statusText !== undefined) fields.statusText = text(statusText, 'Status', { max: 128 });
  if (bannerColor !== undefined) {
    if (bannerColor !== null && !/^#[0-9a-f]{6}$/i.test(bannerColor)) fail(400, 'Banner colour must look like #rrggbb.');
    fields.bannerColor = bannerColor;
  }
  if (bannerPattern !== undefined) {
    if (bannerPattern !== null && !BANNER_PATTERNS.includes(bannerPattern)) fail(400, 'No such banner pattern.');
    fields.bannerPattern = bannerPattern;
  }
  if (bannerPatternColor !== undefined) {
    if (bannerPatternColor !== null && !/^#[0-9a-f]{6}$/i.test(bannerPatternColor)) fail(400, 'Pattern colour must look like #rrggbb.');
    fields.bannerPatternColor = bannerPatternColor;
  }
  return fields;
}

function touchLastSeen(id) {
  db.prepare('UPDATE users SET last_seen = ? WHERE id = ?').run(Date.now(), id);
}

module.exports = {
  DEFAULT_AVATARS, BANNER_PATTERNS, isDefaultAvatar, avatarUrl, defaultAvatar,
  settingOf, touchLastSeen, profileFields, toUser, toMe, create, get, getByUsername, mapByIds, update, audienceIds };
