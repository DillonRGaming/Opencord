// Unit tests for lib/limits.js: rate windows, resets, size checks and the hit counter.
const assert = require('node:assert/strict');
const limits = require('../server/lib/limits');

const hits = [];
limits.setHitListener((kind) => hits.push(kind));

// A rate refuses once past its limit, with a 429 that says when to retry.
const { limit } = limits.describe().rates.find((r) => r.kind === 'messages');
for (let i = 0; i < limit; i++) limits.take('messages', 'u1');
assert.throws(() => limits.take('messages', 'u1'), (err) => err.status === 429 && err.extra.retryAfterMs > 0 && err.extra.limit === 'messages');
// Other people have their own window.
limits.take('messages', 'u2');
// No key means "not counted".
limits.take('messages', null);
assert.deepEqual(hits, ['messages']);

// exhausted() looks without counting; reset() clears.
for (let i = 0; i < 10; i++) limits.take('loginFailsPerAccount', 'bob');
assert.equal(limits.exhausted('loginFailsPerAccount', 'bob'), true);
limits.reset('loginFailsPerAccount', 'bob');
assert.equal(limits.exhausted('loginFailsPerAccount', 'bob'), false);

// Sizes: bytes answer 413, counts 400, and both are counted as hits.
assert.throws(() => limits.within('fileBytes', 0, limits.size('fileBytes') + 1), (err) => err.status === 413);
assert.throws(() => limits.within('reactionsPerMessage', 20, 1), (err) => err.status === 400);
limits.within('reactionsPerMessage', 19, 1);
assert.deepEqual(hits, ['messages', 'fileBytes', 'reactionsPerMessage']);

// An unknown limit is a programming mistake, not a silent pass.
assert.throws(() => limits.take('nope', 'x'), /Unknown rate limit/);

console.log('limits: all checks passed');
