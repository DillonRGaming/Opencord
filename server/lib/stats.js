// Usage counting for the dashboard: who was active each day and how many requests came in.
// Both are kept in memory and written in small batches so normal use costs (almost) no writes.
const db = require('../db');
const platform = require('../platform');
const limits = require('./limits');
const appSettings = require('../models/appSettings');

const DAY_MS = 86400000;
const FREE_STORAGE_BYTES = 5 * 1024 ** 3; // Cloudflare's free plan: 5 GB for everything

const today = () => new Date().toISOString().slice(0, 10);
const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);

let seen = { day: today(), ids: new Set() };
let requests = { day: today(), count: 0 };
let limitHits = { day: today(), byKind: new Map() };

function recordActivity(userId) {
  const day = today();
  if (seen.day !== day) seen = { day, ids: new Set() };
  if (seen.ids.has(userId)) return;
  seen.ids.add(userId);
  db.prepare('INSERT OR IGNORE INTO daily_activity (day, user_id) VALUES (?, ?)').run(day, userId);
}

function flushRequests() {
  if (!requests.count) return;
  db.prepare(`INSERT INTO daily_requests (day, requests) VALUES (?, ?)
    ON CONFLICT(day) DO UPDATE SET requests = requests + excluded.requests`).run(requests.day, requests.count);
  requests.count = 0;
}

function flushLimitHits() {
  const insert = db.prepare(`INSERT INTO daily_limit_hits (day, kind, hits) VALUES (?, ?, ?)
    ON CONFLICT(day, kind) DO UPDATE SET hits = hits + excluded.hits`);
  for (const [kind, n] of limitHits.byKind) insert.run(limitHits.day, kind, n);
  limitHits.byKind.clear();
}

// A limit stopped someone (see lib/limits.js).
function countLimitHit(kind) {
  const day = today();
  if (limitHits.day !== day) {
    flushLimitHits();
    limitHits = { day, byKind: new Map() };
  }
  limitHits.byKind.set(kind, (limitHits.byKind.get(kind) || 0) + 1);
}

let lastFlush = Date.now();
function flush() {
  lastFlush = Date.now();
  flushRequests();
  flushLimitHits();
}

function countRequest(req, res, next) {
  const day = today();
  if (requests.day !== day) {
    flushRequests();
    requests = { day, count: 0 };
  }
  requests.count++;
  // Written every 15 seconds too, so little is lost if the process stops (or a Durable Object sleeps).
  if (Date.now() - lastFlush > 15 * 1000) flush();
  next();
}

platform.get('every')(60 * 1000, flush, { needed: () => requests.count > 0 || limitHits.byKind.size > 0 });

// The last `days` days (UTC), oldest first, with zeros for days with nothing.
function series(days, rows) {
  const byDay = new Map(rows.map((r) => [r.day, r.n]));
  return Array.from({ length: days }, (_, i) => {
    const day = dayOf(Date.now() - (days - 1 - i) * DAY_MS);
    return { day, n: byDay.get(day) || 0 };
  });
}

// Each limit with how often it stopped someone today and in the last 7 days.
function limitReport() {
  const week = dayOf(Date.now() - 6 * DAY_MS);
  const rows = db.prepare('SELECT kind, day, hits FROM daily_limit_hits WHERE day >= ?').all(week);
  const hits = (kind, from) => rows.filter((r) => r.kind === kind && r.day >= from).reduce((sum, r) => sum + r.hits, 0);
  const { sizes, rates } = limits.describe();
  const withHits = (l) => ({ ...l, hitsToday: hits(l.kind, today()), hitsWeek: hits(l.kind, week) });
  return { sizes: sizes.map(withHits), rates: rates.map(withHits) };
}

function overview({ onlineNow }) {
  flush();
  const days = 30;
  const since = dayOf(Date.now() - (days - 1) * DAY_MS);
  const sinceMs = Date.parse(`${since}T00:00:00Z`);
  const one = (sql, ...args) => db.prepare(sql).get(...args);
  const all = (sql, ...args) => db.prepare(sql).all(...args);
  const activeSince = (n) => one(`SELECT COUNT(DISTINCT a.user_id) n FROM daily_activity a JOIN users u ON u.id = a.user_id
    WHERE u.is_bot = 0 AND a.day >= ?`, dayOf(Date.now() - (n - 1) * DAY_MS)).n;
  const files = one('SELECT COUNT(*) n, COALESCE(SUM(size), 0) bytes FROM attachments');

  // "Came back": people who joined over a day ago and were active on a later day than the one they joined.
  const joinedBefore = one('SELECT COUNT(*) n FROM users WHERE is_bot = 0 AND created_at < ?', Date.now() - DAY_MS).n;
  const cameBack = one(`SELECT COUNT(DISTINCT u.id) n FROM users u JOIN daily_activity a ON a.user_id = u.id
    WHERE u.is_bot = 0 AND u.created_at < ? AND a.day > date(u.created_at / 1000, 'unixepoch')`, Date.now() - DAY_MS).n;

  return {
    totals: {
      people: one('SELECT COUNT(*) n FROM users WHERE is_bot = 0').n,
      bots: one('SELECT COUNT(*) n FROM users WHERE is_bot = 1').n,
      servers: one('SELECT COUNT(*) n FROM servers').n,
      messages: one('SELECT COUNT(*) n FROM messages').n,
      files: files.n,
      fileBytes: files.bytes,
    },
    active: { now: onlineNow, today: activeSince(1), week: activeSince(7), month: activeSince(30) },
    retention: { joinedBefore, cameBack },
    storage: { usedBytes: platform.get('dataBytes')(), freePlanBytes: FREE_STORAGE_BYTES },
    limits: limitReport(),
    registration: appSettings.registrationMode(),
    suspended: one('SELECT COUNT(*) n FROM users WHERE suspended_at IS NOT NULL').n,
    trackingSince: one('SELECT MIN(day) day FROM daily_activity').day,
    days: {
      active: series(days, all(`SELECT a.day, COUNT(*) n FROM daily_activity a JOIN users u ON u.id = a.user_id
        WHERE u.is_bot = 0 AND a.day >= ? GROUP BY a.day`, since)),
      messages: series(days, all(`SELECT date(created_at / 1000, 'unixepoch') day, COUNT(*) n FROM messages
        WHERE created_at >= ? GROUP BY day`, sinceMs)),
      signups: series(days, all(`SELECT date(created_at / 1000, 'unixepoch') day, COUNT(*) n FROM users
        WHERE is_bot = 0 AND created_at >= ? GROUP BY day`, sinceMs)),
      requests: series(days, all('SELECT day, requests n FROM daily_requests WHERE day >= ?', since)),
    },
  };
}

// Everyone with an account (bots left out): when they joined, when they were last active, how much they've sent.
function people() {
  return db.prepare(`SELECT u.id, u.username, u.display_name displayName, u.app_role appRole, u.created_at joinedAt, u.suspended_at suspendedAt, u.suspended_reason suspendedReason,
      (SELECT MAX(day) FROM daily_activity WHERE user_id = u.id) lastActiveDay,
      (SELECT COUNT(*) FROM messages WHERE author_id = u.id) messages,
      (SELECT COALESCE(SUM(size), 0) FROM attachments WHERE uploader_id = u.id) uploadBytes,
      (SELECT COUNT(*) FROM server_members WHERE user_id = u.id) servers
    FROM users u WHERE u.is_bot = 0 ORDER BY u.created_at DESC`).all();
}

// Servers by size and recent activity.
function serverList() {
  return db.prepare(`SELECT s.id, s.name, s.created_at createdAt,
      (SELECT COUNT(*) FROM server_members WHERE server_id = s.id) members,
      (SELECT COUNT(*) FROM messages m JOIN channels c ON c.id = m.channel_id
        WHERE c.server_id = s.id AND m.created_at >= ?) messagesWeek
    FROM servers s ORDER BY messagesWeek DESC, members DESC LIMIT 50`).all(Date.now() - 7 * DAY_MS);
}

limits.setHitListener(countLimitHit);

module.exports = { recordActivity, countRequest, flush, overview, people, serverList };
