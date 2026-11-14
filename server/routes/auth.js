const express = require('express');
const config = require('../config');
const auth = require('../lib/auth');
const rateLimit = require('../lib/rateLimit');
const { fail, text } = require('../lib/http');
const users = require('../models/users');
const realtime = require('../realtime');

const router = express.Router();
const limiter = rateLimit({ limit: 20, windowMs: 15 * 60 * 1000 });
const USERNAME = /^[a-z0-9_.]{2,32}$/;

router.post('/register', limiter, async (req, res) => {
  if (!config.registrationOpen) fail(403, 'Sign-ups are closed on this Opencord.');
  const username = text(req.body.username, 'Username').toLowerCase();
  if (!USERNAME.test(username)) fail(400, 'Usernames are 2–32 characters: letters, numbers, _ and .');
  const displayName = req.body.displayName ? text(req.body.displayName, 'Display name', { min: 1, max: 32 }) : username;
  const password = text(req.body.password, 'Password', { min: 8, max: 200, trim: false });
  if (users.getByUsername(username)) fail(409, 'That username is taken.');

  const user = users.create({ username, displayName, passwordHash: await auth.hashPassword(password) });
  auth.startSession(req, res, user.id, { add: Boolean(req.body.add) });
  res.status(201).json(users.toMe(user));
});

router.post('/login', limiter, async (req, res) => {
  const username = text(req.body.username, 'Username').toLowerCase();
  const password = text(req.body.password, 'Password', { trim: false });
  const user = users.getByUsername(username);
  if (!user || !(await auth.verifyPassword(password, user.password_hash))) fail(401, 'Wrong username or password.');

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
  res.json(auth.accountsOf(req, res).map(({ user, current }) => ({ ...users.toUser(user), current })));
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
