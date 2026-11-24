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
const hq = require('../lib/hq');
const stats = require('../lib/stats');
const myStats = require('../lib/myStats');

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
    hqServerId: hq.hqServerId(),
    dms: channels.dmsForUser(me.id),
    readStates: channels.readStates(me.id),
    dmPings: channels.dmUnreadCounts(me.id),
    myRoles: Object.fromEntries(servers.forUser(me.id).map((s) => [s.id, servers.memberRoleIds(s.id, me.id)])),
    online: [me.id, ...users.audienceIds(me.id)].filter(realtime.isOnline),
    statuses: Object.fromEntries([me.id, ...users.audienceIds(me.id)].map((id) => [id, realtime.statusOf(id)]).filter(([, s]) => s !== 'offline')),
    unreadNotifications: notifications.unreadCount(me.id),
  });
});

router.get('/time', (req, res) => {
  res.json({ now: Date.now() });
});

router.get('/users/@me', (req, res) => {
  res.json(users.toMe(req.user));
});

// Your own stats (the same numbers and charts admins see on the dev dashboard). ?tz= is your offset in minutes.
router.get('/users/@me/stats', (req, res) => {
  const tz = Number(req.query.tz);
  const data = stats.person(req.user.id, Number.isFinite(tz) && Math.abs(tz) <= 14 * 60 ? tz : 0);
  res.json({ ...data, user: users.toUser(req.user), online: true, personal: myStats.personal(req.user.id) });
});

router.patch('/users/@me', (req, res) => {
  const { displayName, bio, statusText, bannerColor, bannerPattern, bannerPatternColor, settings, presence } = req.body;
  const fields = {};
  if (presence !== undefined) {
    if (!['online', 'idle', 'dnd', 'invisible'].includes(presence)) fail(400, 'Status must be online, idle, dnd or invisible.');
    fields.presence = presence;
  }
  Object.assign(fields, users.profileFields({ displayName, bio, statusText, bannerColor, bannerPattern, bannerPatternColor }));
  if (settings !== undefined) {
    if (settings === null || typeof settings !== 'object' || Array.isArray(settings)) fail(400, 'Settings must be an object.');
    fields.settings = JSON.stringify(settings);
    if (Buffer.byteLength(fields.settings) > MAX_SETTINGS_BYTES) fail(413, 'Settings are too large (64 KB at most).');
  }
  const receiptsBefore = users.settingOf(req.user.id, 'readReceipts', false);
  const user = users.update(req.user.id, fields);
  announce(user);
  // Turning read receipts on or off changes what both sides of each 1:1 DM can see.
  if (users.settingOf(user.id, 'readReceipts', false) !== receiptsBefore) {
    for (const dm of channels.dmsForUser(user.id).filter((d) => d.kind !== 'group')) {
      const row = channels.get(dm.id);
      for (const id of channels.dmMemberIds(row.id)) realtime.toUser(id, 'dm:update', channels.serialize(row, id));
    }
  }
  if (presence !== undefined) realtime.announcePresence(user.id);
  res.json(users.toMe(user));
});

function setAvatar(req, res, file) {
  const user = users.update(req.user.id, { avatar: file });
  if (req.user.avatar && !users.isDefaultAvatar(req.user.avatar)) storage.remove(`avatars/${req.user.avatar}`);
  announce(user);
  res.json(users.toMe(user));
}

router.put('/users/@me/avatar', rawImage, async (req, res) => {
  setAvatar(req, res, await storage.saveImage('avatars', req.body));
});

// Picks one of the built-in avatars (1 to DEFAULT_AVATARS).
router.put('/users/@me/avatar/default/:n', (req, res) => {
  const n = Number(req.params.n);
  if (!Number.isInteger(n) || n < 1 || n > users.DEFAULT_AVATARS) fail(400, 'No such default avatar.');
  setAvatar(req, res, users.defaultAvatar(n));
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
