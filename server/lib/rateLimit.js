const { fail } = require('./http');

// Fixed-window limiter kept in memory. Keyed by IP unless `key` says otherwise;
// requests where `key` returns null are not counted.
function rateLimit({ limit, windowMs, key = (req) => req.ip, message = 'Too many attempts. Try again in a few minutes.' }) {
  const hits = new Map();

  setInterval(() => {
    const now = Date.now();
    for (const [k, entry] of hits) if (entry.resetAt <= now) hits.delete(k);
  }, windowMs).unref();

  return (req, res, next) => {
    const k = key(req);
    if (k == null) return next();
    const now = Date.now();
    let entry = hits.get(k);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(k, entry);
    }
    entry.count += 1;
    if (entry.count > limit) {
      res.set('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
      fail(429, message, { retryAfterMs: entry.resetAt - now });
    }
    next();
  };
}

module.exports = rateLimit;
