const express = require('express');
const notifications = require('../models/notifications');
const config = require('../config');
const auth = require('../lib/auth');
const storage = require('../lib/storage');
const { fail, text } = require('../lib/http');
const users = require('../models/users');
const sessions = require('../models/sessions');
const relationships = require('../models/relationships');
const servers = require('../models/servers');
const channels = require('../models/channels');
const realtime = require('../realtime');

const router = express.Router();
const rawImage = express.raw({ type: () => true, limit: config.maxImageBytes });
const MAX_SETTINGS_BYTES = 64 * 1024;

// Tells the user's own tabs (full Me) and everyone who can see them (public User).
function announce(user) {
  realtime.toAudience(user.id, 'user:update', users.toUser(user));
  realtime.toUser(user.id, 'user:update', users.toMe(user));
}

router.get('/bootstrap', (req, res) => {
  const me = req.user;
  res.json({
    me: users.toMe(me),
    relationships: relationships.list(me.id),
    servers: servers.forUser(me.id).map(servers.toServer),
    dms: channels.dmsForUser(me.id),
    readStates: channels.readStates(me.id),
    online: [me.id, ...users.audienceIds(me.id)].filter(realtime.isOnline),
    statuses: Object.fromEntries([me.id, ...users.audienceIds(me.id)].map((id) => [id, realtime.statusOf(id)]).filter(([, s]) => s !== 'offline')),
    unreadNotifications: notifications.unreadCount(me.id),
  });
});

router.get('/users/@me', (req, res) => {
  res.json(users.toMe(req.user));
});

router.patch('/users/@me', (req, res) => {
  const { displayName, bio, statusText, bannerColor, settings, presence } = req.body;
  const fields = {};
  if (presence !== undefined) {
    if (!['online', 'idle', 'dnd', 'invisible'].includes(presence)) fail(400, 'Status must be online, idle, dnd or invisible.');
    fields.presence = presence;
  }
  if (displayName !== undefined) fields.displayName = text(displayName, 'Display name', { min: 1, max: 32 });
  if (bio !== undefined) fields.bio = text(bio, 'Bio', { max: 190 });
  if (statusText !== undefined) fields.statusText = text(statusText, 'Status', { max: 128 });
  if (bannerColor !== undefined) {
    if (bannerColor !== null && !/^#[0-9a-f]{6}$/i.test(bannerColor)) fail(400, 'Banner colour must look like #rrggbb.');
    fields.bannerColor = bannerColor;
  }
  if (settings !== undefined) {
    if (settings === null || typeof settings !== 'object' || Array.isArray(settings)) fail(400, 'Settings must be an object.');
    fields.settings = JSON.stringify(settings);
    if (Buffer.byteLength(fields.settings) > MAX_SETTINGS_BYTES) fail(413, 'Settings are too large (64 KB at most).');
  }
  const user = users.update(req.user.id, fields);
  announce(user);
  if (presence !== undefined) realtime.announcePresence(user.id);
  res.json(users.toMe(user));
});

function setAvatar(req, res, file) {
  const user = users.update(req.user.id, { avatar: file });
  if (req.user.avatar) storage.remove(`avatars/${req.user.avatar}`);
  announce(user);
  res.json(users.toMe(user));
}

router.put('/users/@me/avatar', rawImage, (req, res) => {
  setAvatar(req, res, storage.saveImage('avatars', req.body));
});

router.delete('/users/@me/avatar', (req, res) => {
  setAvatar(req, res, null);
});

router.put('/users/@me/password', async (req, res) => {
  const current = text(req.body.currentPassword, 'Current password', { trim: false });
  const next = text(req.body.newPassword, 'New password', { min: 8, max: 200, trim: false });
  if (!(await auth.verifyPassword(current, req.user.password_hash))) fail(403, 'Current password is wrong.');
  users.update(req.user.id, { passwordHash: await auth.hashPassword(next) });
  realtime.disconnectSessions(sessions.removeOthers(req.user.id, req.sessionHash));
  res.sendStatus(204);
});

router.get('/users/:id', (req, res) => {
  const user = users.get(req.params.id);
  if (!user) fail(404, 'User not found.');
  res.json(users.toUser(user));
});

module.exports = router;
