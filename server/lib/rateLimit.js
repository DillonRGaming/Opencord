const { fail } = require('./http');

// Fixed-window limiter kept in memory, keyed by IP.
function rateLimit({ limit, windowMs }) {
  const hits = new Map();

  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) if (entry.resetAt <= now) hits.delete(key);
  }, windowMs).unref();

  return (req, res, next) => {
    const now = Date.now();
    let entry = hits.get(req.ip);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(req.ip, entry);
    }
    entry.count += 1;
    if (entry.count > limit) fail(429, 'Too many attempts. Try again in a few minutes.');
    next();
  };
}

module.exports = rateLimit;
