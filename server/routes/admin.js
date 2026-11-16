// The Opencord dashboard: usage numbers for the app's owner and admins (app-wide roles, not server roles).
const crypto = require('node:crypto');
const express = require('express');
const db = require('../db');
const limits = require('../lib/limits');
const hq = require('../lib/hq');
const { fail, text } = require('../lib/http');
const sessions = require('../models/sessions');
const appSettings = require('../models/appSettings');
const users = require('../models/users');
const stats = require('../lib/stats');
const realtime = require('../realtime');

const router = express.Router();

// Becoming the owner where there's no command line (Cloudflare): send the OWNER_CLAIM_TOKEN secret, which only
// the person who deployed Opencord knows (`wrangler secret put OWNER_CLAIM_TOKEN`). It only works while nobody
// is the owner yet, and without the secret set it doesn't exist at all.
router.post('/claim-owner', (req, res) => {
  const secret = process.env.OWNER_CLAIM_TOKEN;
  const given = typeof req.body.token === 'string' ? req.body.token : '';
  if (!secret || secret.length < 16) fail(404, 'Not found.');
  limits.take('loginFailsPerAccount', 'claim-owner');
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(secret).digest();
  if (!crypto.timingSafeEqual(a, b)) fail(403, 'That is not the token.');
  if (db.prepare("SELECT 1 FROM users WHERE app_role = 'owner'").get()) fail(409, 'There is already an owner.');
  limits.reset('loginFailsPerAccount', 'claim-owner');
  users.update(req.user.id, { appRole: 'owner' });
  hq.refresh();
  res.json({ appRole: 'owner' });
});

router.use((req, res, next) => {
  if (!['owner', 'admin'].includes(req.user.app_role)) fail(404, 'Not found.');
  next();
});

router.get('/overview', (req, res) => {
  res.json(stats.overview({ onlineNow: realtime.onlineCount() }));
});

router.get('/people', (req, res) => {
  res.json(stats.people());
});

router.get('/servers', (req, res) => {
  res.json(stats.serverList());
});

// Only the owner hands out (or takes back) admin. The owner role itself is set from the command line.
router.put('/people/:id/role', (req, res) => {
  if (req.user.app_role !== 'owner') fail(403, 'Only the owner can change admins.');
  const { role } = req.body;
  if (role !== 'admin' && role !== null) fail(400, 'Role must be "admin" or null.');
  const target = users.get(req.params.id);
  if (!target || target.is_bot) fail(404, 'No such person.');
  if (target.app_role === 'owner') fail(400, "The owner's role can't be changed here.");
  users.update(target.id, { appRole: role });
  res.json({ id: target.id, appRole: role });
});

// Builds or refreshes Opencord HQ right away (it also refreshes itself every 10 minutes). Owner only.
router.post('/hq', (req, res) => {
  if (req.user.app_role !== 'owner') fail(403, 'Only the owner has Opencord HQ.');
  hq.refresh();
  res.json({ serverId: appSettings.get('hq', {}).serverId });
});

// Who may make an account: open, invite (needs a server invite) or closed. Owner only.
router.put('/registration', (req, res) => {
  if (req.user.app_role !== 'owner') fail(403, 'Only the owner can change sign-ups.');
  const { mode } = req.body;
  if (!appSettings.REGISTRATION_MODES.includes(mode)) fail(400, 'Mode must be open, invite or closed.');
  appSettings.set('registration', mode);
  res.json({ mode });
});

// Suspending logs someone out everywhere and stops them logging in. Admins can suspend regular people;
// the owner can also suspend admins. Nobody can suspend the owner or themselves.
router.put('/people/:id/suspension', (req, res) => {
  const target = users.get(req.params.id);
  if (!target || target.is_bot) fail(404, 'No such person.');
  if (target.id === req.user.id) fail(400, "You can't suspend yourself.");
  if (target.app_role === 'owner') fail(403, "The owner can't be suspended.");
  if (target.app_role === 'admin' && req.user.app_role !== 'owner') fail(403, 'Only the owner can suspend an admin.');
  const { suspended } = req.body;
  if (typeof suspended !== 'boolean') fail(400, 'suspended must be true or false.');
  const reason = suspended ? text(req.body.reason ?? '', 'Reason', { max: 200 }) : null;
  users.update(target.id, { suspendedAt: suspended ? Date.now() : null, suspendedReason: reason });
  if (suspended) realtime.disconnectSessions(sessions.removeAll(target.id));
  res.json({ id: target.id, suspendedAt: users.get(target.id).suspended_at, suspendedReason: reason });
});

module.exports = router;
