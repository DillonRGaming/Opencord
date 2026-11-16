const crypto = require('node:crypto');
const express = require('express');
const auth = require('../lib/auth');
const limits = require('../lib/limits');
const appSettings = require('../models/appSettings');
const invites = require('./invites');
const { fail, text } = require('../lib/http');
const users = require('../models/users');
const channels = require('../models/channels');
const notifications = require('../models/notifications');
const realtime = require('../realtime');

const router = express.Router();
const USERNAME = /^[a-z0-9_.]{2,32}$/;

// Names nobody can sign up with: they'd look official, or clash with mentions and pages.
const RESERVED = new Set([
  'admin', 'administrator', 'owner', 'mod', 'mods', 'moderator', 'staff', 'support', 'help', 'system', 'root',
  'opencord', 'official', 'team', 'security', 'everyone', 'here', 'me', 'bot', 'bots', 'webhook', 'null', 'undefined',
  'api', 'dashboard', 'settings', 'login', 'register', 'invite', 'channels',
]);
const reserved = (name) => RESERVED.has(name) || /^(opencord|admin|staff|support|official|hook_)/.test(name);

// A real hash of a random password, so a log-in for a name that doesn't exist takes as long as one that does
// (otherwise the timing tells someone which usernames exist).
const dummyHash = auth.hashPassword(crypto.randomBytes(16).toString('hex'));

router.post('/register', async (req, res) => {
  const mode = appSettings.registrationMode();
  if (mode === 'closed') fail(403, 'Sign-ups are closed on this Opencord.');
  const inviteCode = typeof req.body.inviteCode === 'string' ? req.body.inviteCode : null;
  if (mode === 'invite') {
    if (!inviteCode) fail(403, 'You need an invite to make an account here. Ask a friend for one.');
    invites.findInvite(inviteCode); // fails if it's not a working invite
  }
  const username = text(req.body.username, 'Username').toLowerCase();
  if (!USERNAME.test(username)) fail(400, 'Usernames are 2–32 characters: letters, numbers, _ and .');
  if (reserved(username)) fail(400, 'That username is reserved. Pick another.');
  const displayName = req.body.displayName ? text(req.body.displayName, 'Display name', { min: 1, max: 32 }) : username;
  const password = text(req.body.password, 'Password', { min: 8, max: 200, trim: false });
  if (users.getByUsername(username)) fail(409, 'That username is taken.');
  limits.take('signupPerIp', req.ip);
  limits.take('signupGlobal', 'all');

  const user = users.create({ username, displayName, passwordHash: await auth.hashPassword(password) });
  if (inviteCode) {
    try {
      invites.joinWithInvite(inviteCode, user);
    } catch {
      // The account is made either way; joining can be retried from the invite link.
    }
  }
  auth.startSession(req, res, user.id, { add: Boolean(req.body.add) });
  res.status(201).json(users.toMe(user));
});

router.post('/login', async (req, res) => {
  limits.take('loginPerIp', req.ip);
  const username = text(req.body.username, 'Username', { max: 64 }).toLowerCase();
  const password = text(req.body.password, 'Password', { max: 200, trim: false });
  if (limits.exhausted('loginFailsPerAccount', username)) limits.take('loginFailsPerAccount', username);
  const user = users.getByUsername(username);
  const ok = user
    ? await auth.verifyPassword(password, user.password_hash)
    : (await auth.verifyPassword(password, await dummyHash)) && false;
  if (!ok) {
    limits.take('loginFailsPerAccount', username);
    fail(401, 'Wrong username or password.');
  }
  if (user.suspended_at) fail(403, 'This account is suspended.');
  limits.reset('loginFailsPerAccount', username);

  auth.startSession(req, res, user.id, { add: Boolean(req.body.add) });
  res.json(users.toMe(user));
});

router.post('/logout', auth.requireAuth, (req, res) => {
  const switched = auth.endSession(req, res);
  realtime.disconnectSessions([req.sessionHash]);
  res.json({ switched });
});

// The accounts logged in on this browser, for the account switcher.
router.get('/accounts', auth.requireAuth, (req, res) => {
  // `pings` for the other accounts: unread DMs plus unread notifications, so the switcher can show a red count.
  res.json(auth.accountsOf(req, res).map(({ user, current }) => ({
    ...users.toUser(user), current,
    pings: current ? 0 : Object.values(channels.dmUnreadCounts(user.id)).reduce((a, b) => a + b, 0) + notifications.unreadCount(user.id),
  })));
});

router.post('/accounts/remove', auth.requireAuth, (req, res) => {
  if (!auth.removeAccount(req, res, text(req.body.userId, 'userId'))) fail(404, 'That account isn’t logged in here.');
  res.sendStatus(204);
});

router.post('/accounts/switch', auth.requireAuth, (req, res) => {
  if (!auth.switchTo(req, res, text(req.body.userId, 'userId'))) fail(404, 'That account isn’t logged in here any more.');
  res.sendStatus(204);
});

module.exports = router;
