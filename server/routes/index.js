const express = require('express');
const auth = require('../lib/auth');
const { fail } = require('../lib/http');
const limits = require('../lib/limits');

const api = express.Router();
const isChunk = (req) => req.method === 'PUT' && /^\/api\/uploads\/[^/?]+/.test(req.originalUrl);

// High limits: normal use never gets near them, they only stop floods and scripts (numbers in lib/limits.js).
const perIp = limits.middleware('apiPerIp', (req) => req.ip);
const writesPerUser = limits.middleware('writesPerUser', (req) => (['GET', 'HEAD'].includes(req.method) || isChunk(req) ? null : req.user.id));
const chunksPerUser = limits.middleware('chunksPerUser', (req) => (isChunk(req) ? req.user.id : null));

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
api.use('/webhooks', require('./webhooks').hooks); // other programs post here with the webhook's secret

api.use('/admin', require('./admin').claim);
api.use(auth.requireAuth);
api.use(writesPerUser);
api.use('/', require('./users'));
api.use('/relationships', require('./relationships'));
api.use('/dms', require('./dms'));
api.use('/servers', require('./servers').router);
api.use('/servers', require('./webhooks').manage);
api.use('/channels', require('./channels'));
api.use('/admin', require('./admin'));
api.use('/channels', require('./apps'));
api.use('/messages', require('./messages'));
api.use('/uploads', chunksPerUser, require('./uploads'));
api.use('/notifications', require('./notifications'));
api.use('/translate', require('./translate'));
api.use('/fun', require('./fun'));

api.use(() => fail(404, 'Not found.'));

const media = express.Router();
media.use(auth.requireAuth);
media.use(require('./media'));

module.exports = { api, media };
