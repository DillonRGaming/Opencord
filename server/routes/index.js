const express = require('express');
const auth = require('../lib/auth');
const { fail } = require('../lib/http');

const api = express.Router();

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
api.use('/', require('./users'));
api.use('/relationships', require('./relationships'));
api.use('/dms', require('./dms'));
api.use('/servers', require('./servers').router);
api.use('/channels', require('./channels'));
api.use('/messages', require('./messages'));
api.use('/uploads', require('./uploads'));

api.use(() => fail(404, 'Not found.'));

const media = express.Router();
media.use(auth.requireAuth);
media.use(require('./media'));

module.exports = { api, media };
