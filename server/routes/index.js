const express = require('express');
const auth = require('../lib/auth');
const { fail } = require('../lib/http');
const rateLimit = require('../lib/rateLimit');

const api = express.Router();
const SLOW_DOWN = 'You are doing that too fast. Wait a moment and try again.';
const isChunk = (req) => req.method === 'PUT' && /^\/api\/uploads\/[^/?]+/.test(req.originalUrl);

// High limits: normal use never gets near them, they only stop floods and scripts.
const perIp = rateLimit({ limit: 1200, windowMs: 60 * 1000, message: SLOW_DOWN });
const writesPerUser = rateLimit({
  limit: 300, windowMs: 60 * 1000, message: SLOW_DOWN,
  key: (req) => (['GET', 'HEAD'].includes(req.method) || isChunk(req) ? null : req.user.id),
});
const chunksPerUser = rateLimit({
  limit: 600, windowMs: 60 * 1000, message: SLOW_DOWN, key: (req) => (isChunk(req) ? req.user.id : null),
});

api.use(perIp);
api.use(auth.sameOrigin);
api.use(express.json({ limit: '10mb' }));
api.use((req, res, next) => {
  req.body ??= {};
  next();
});

// Open to logged-out visitors: auth, and the invite preview (invites.js guards its own join route).
api.use('/auth', require('./auth'));
api.use('/invites', require('./invites'));

api.use(auth.requireAuth);
api.use(writesPerUser);
api.use('/', require('./users'));
api.use('/relationships', require('./relationships'));
api.use('/dms', require('./dms'));
api.use('/servers', require('./servers').router);
api.use('/channels', require('./channels'));
api.use('/messages', require('./messages'));
api.use('/uploads', chunksPerUser, require('./uploads'));
api.use('/notifications', require('./notifications'));

api.use(() => fail(404, 'Not found.'));

const media = express.Router();
media.use(auth.requireAuth);
media.use(require('./media'));

module.exports = { api, media };
