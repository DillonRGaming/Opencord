// Every limit in Opencord, in one place. Two kinds:
//   SIZES: how big or how many something may be (checked against the database).
//   RATES: how often someone may do something (counted in memory, per person or per IP).
// When a limit stops someone they get a clear message, and the hit is counted for the dashboard.
const { fail } = require('./http');

const KB = 1024;
const MB = 1024 * KB;
const GB = 1024 * MB;
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// Tests turn rates up (never sizes) so one test run can make many accounts and messages from one address.
const SCALE = Math.max(1, Number(process.env.LIMITS_SCALE) || 1);

const SIZES = {
  fileBytes: { value: 50 * MB, label: 'File size', unit: 'bytes' },
  userUploadBytes: { value: 500 * MB, label: 'Uploads per person', unit: 'bytes' },
  totalUploadBytes: { value: 4 * GB, label: 'All uploads together', unit: 'bytes' },
  pendingUploads: { value: 10, label: 'Unfinished uploads per person' },
  serversOwned: { value: 25, label: 'Servers one person can own' },
  serversJoined: { value: 100, label: 'Servers one person can be in' },
  channelsPerServer: { value: 200, label: 'Channels per server' },
  invitesPerServer: { value: 100, label: 'Invites per server' },
  reactionsPerMessage: { value: 20, label: 'Different reactions per message' },
};

const RATES = {
  signupPerIp: { limit: 3, windowMs: DAY, label: 'Sign-ups from one address', message: 'Too many accounts were made from your network today. Try again tomorrow.' },
  signupGlobal: { limit: 30, windowMs: HOUR, label: 'Sign-ups across Opencord', message: 'Lots of people are signing up right now. Try again in a little while.' },
  loginPerIp: { limit: 30, windowMs: 15 * MINUTE, label: 'Log-in attempts from one address' },
  loginFailsPerAccount: { limit: 10, windowMs: 15 * MINUTE, label: 'Wrong passwords for one account', message: 'Too many wrong passwords for this account. Try again in 15 minutes.' },
  messages: { limit: 10, windowMs: 10 * 1000, label: 'Messages per person', message: 'You are sending messages too fast. Wait a few seconds.' },
  friendRequests: { limit: 30, windowMs: HOUR, label: 'Friend requests per person', message: 'You have sent a lot of friend requests. Try again later.' },
  groupsCreated: { limit: 10, windowMs: HOUR, label: 'Group DMs made per person', message: 'You have made a lot of groups. Try again later.' },
  serversCreated: { limit: 10, windowMs: DAY, label: 'Servers made per person', message: 'You have made a lot of servers today. Try again tomorrow.' },
  uploadsStarted: { limit: 60, windowMs: HOUR, label: 'Uploads per person', message: 'You have uploaded a lot this hour. Try again later.' },
  apiPerIp: { limit: 1200, windowMs: MINUTE, label: 'Requests from one address' },
  writesPerUser: { limit: 300, windowMs: MINUTE, label: 'Changes per person' },
  chunksPerUser: { limit: 600, windowMs: MINUTE, label: 'Upload pieces per person' },
};

const SLOW_DOWN = 'You are doing that too fast. Wait a moment and try again.';
const windows = new Map(); // `${kind}:${key}` → { count, resetAt }
let onHit = () => {};

// Old windows are dropped (from take(), at most once a minute) so the map can't grow without end.
let lastSweep = 0;
function dropExpired() {
  const now = Date.now();
  for (const [k, entry] of windows) if (entry.resetAt <= now) windows.delete(k);
}

function rateOf(kind) {
  const rate = RATES[kind];
  if (!rate) throw new Error(`Unknown rate limit: ${kind}`);
  return { ...rate, limit: rate.limit * SCALE };
}

// Counts one use of `kind` by `key` and refuses (429) once the limit is passed.
function take(kind, key) {
  if (key == null) return;
  if (Date.now() - lastSweep > MINUTE) { lastSweep = Date.now(); dropExpired(); }
  const rate = rateOf(kind);
  const now = Date.now();
  const k = `${kind}:${key}`;
  let entry = windows.get(k);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + rate.windowMs };
    windows.set(k, entry);
  }
  entry.count += 1;
  if (entry.count > rate.limit) {
    onHit(kind);
    fail(429, rate.message || SLOW_DOWN, { retryAfterMs: entry.resetAt - now, limit: kind });
  }
}

// Whether `kind` is used up for `key`, without counting a use (for checks before the real attempt).
function exhausted(kind, key) {
  const entry = windows.get(`${kind}:${key}`);
  return Boolean(entry && entry.resetAt > Date.now() && entry.count >= rateOf(kind).limit);
}

// Takes back the uses of `kind` by `key` (e.g. a successful log-in clears the wrong-password count).
function reset(kind, key) {
  windows.delete(`${kind}:${key}`);
}

// Refuses when `current + adding` would pass size limit `kind`.
function within(kind, current, adding = 1, message) {
  const { value, label } = SIZES[kind];
  if (current + adding > value) {
    onHit(kind);
    fail(kind.endsWith('Bytes') ? 413 : 400, message || `${label} is limited to ${value}.`, { limit: kind });
  }
}

// Express middleware for a rate limit keyed by `key(req)` (no key = not counted).
function middleware(kind, key) {
  return (req, res, next) => {
    try {
      take(kind, key(req));
    } catch (err) {
      if (err.extra?.retryAfterMs) res.set('Retry-After', String(Math.ceil(err.extra.retryAfterMs / 1000)));
      throw err;
    }
    next();
  };
}

// Everything the dashboard lists, with the numbers that apply right now.
function describe() {
  return {
    sizes: Object.entries(SIZES).map(([kind, s]) => ({ kind, label: s.label, value: s.value, unit: s.unit || 'count' })),
    rates: Object.entries(RATES).map(([kind]) => {
      const r = rateOf(kind);
      return { kind, label: r.label, limit: r.limit, windowMs: r.windowMs };
    }),
  };
}

module.exports = {
  SIZES, RATES, take, exhausted, reset, within, middleware, describe,
  setHitListener: (fn) => { onHit = fn; },
  size: (kind) => SIZES[kind].value,
};
