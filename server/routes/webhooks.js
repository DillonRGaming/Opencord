// Webhooks: a secret address that posts into a channel, for other programs (GitHub, CI, home automation…).
//   POST /api/webhooks/<id>/<token>   { "content": "Build passed ✅" }
// Admins make and delete them in server settings. Each webhook posts as its own bot account.
const crypto = require('node:crypto');
const express = require('express');
const db = require('../db');
const { newId } = require('../lib/ids');
const access = require('../lib/access');
const { fail, text } = require('../lib/http');
const users = require('../models/users');
const channels = require('../models/channels');
const audit = require('../models/audit');
const { postMessage } = require('../lib/post');

const PER_MINUTE = 30;
const sent = new Map(); // webhookId → recent post times

function toWebhook(row, withToken = false) {
  const user = users.get(row.user_id);
  return {
    id: row.id, serverId: row.server_id, channelId: row.channel_id, name: user?.display_name || 'Webhook',
    createdAt: row.created_at, creatorId: row.creator_id,
    ...(withToken ? { url: `/api/webhooks/${row.id}/${row.token}` } : {}),
  };
}

const sameToken = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

// --- public: posting ---

const hooks = express.Router();

hooks.post('/:id/:token', (req, res) => {
  const row = db.prepare('SELECT * FROM webhooks WHERE id = ?').get(req.params.id);
  if (!row || !sameToken(row.token, String(req.params.token))) fail(404, 'Unknown webhook.');
  const channel = channels.get(row.channel_id);
  if (!channel) fail(404, 'The channel for this webhook is gone.');
  const now = Date.now();
  const recent = (sent.get(row.id) || []).filter((t) => now - t < 60_000);
  if (recent.length >= PER_MINUTE) fail(429, 'This webhook is posting too fast (30 a minute at most).');
  recent.push(now);
  sent.set(row.id, recent);
  const content = text(req.body.content ?? '', 'content', { min: 1, max: 1000 });
  const message = postMessage(channel, row.user_id, content);
  res.status(201).json({ id: message.id });
});

// --- server settings: managing them ---

const manage = express.Router();

manage.get('/:id/webhooks', (req, res) => {
  const server = access.modServer(req.params.id, req.user.id);
  res.json(db.prepare('SELECT * FROM webhooks WHERE server_id = ? ORDER BY created_at').all(server.id).map((r) => toWebhook(r, true)));
});

manage.post('/:id/webhooks', (req, res) => {
  const server = access.modServer(req.params.id, req.user.id);
  const name = text(req.body.name, 'Name', { min: 1, max: 32 });
  const channel = channels.get(String(req.body.channelId || ''));
  if (!channel || channel.server_id !== server.id || channel.kind !== 'text') fail(400, 'Pick a text channel in this server.');
  if (db.prepare('SELECT COUNT(*) AS n FROM webhooks WHERE server_id = ?').get(server.id).n >= 20) fail(400, 'A server can have up to 20 webhooks.');
  let username;
  do username = `hook_${Math.random().toString(36).slice(2, 8)}`; while (users.getByUsername(username));
  const user = users.create({ username, displayName: name, passwordHash: '!webhook' });
  db.prepare('UPDATE users SET is_bot = 1 WHERE id = ?').run(user.id);
  const id = newId();
  db.prepare('INSERT INTO webhooks (id, server_id, channel_id, user_id, token, creator_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, server.id, channel.id, user.id, crypto.randomBytes(24).toString('base64url'), req.user.id, Date.now());
  audit.log(server.id, req.user.id, 'webhook.create', name, `#${channel.name}`);
  res.status(201).json(toWebhook(db.prepare('SELECT * FROM webhooks WHERE id = ?').get(id), true));
});

manage.delete('/:id/webhooks/:hookId', (req, res) => {
  const server = access.modServer(req.params.id, req.user.id);
  const row = db.prepare('SELECT * FROM webhooks WHERE id = ? AND server_id = ?').get(req.params.hookId, server.id);
  if (!row) fail(404, 'Webhook not found.');
  const name = users.get(row.user_id)?.display_name;
  db.prepare('DELETE FROM webhooks WHERE id = ?').run(row.id);
  // Its messages stay, so the account does too (it can't log in).
  audit.log(server.id, req.user.id, 'webhook.delete', name || 'webhook');
  res.sendStatus(204);
});

module.exports = { hooks, manage };
