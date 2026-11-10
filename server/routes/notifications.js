const express = require('express');
const { fail } = require('../lib/http');
const notifications = require('../models/notifications');
const messages = require('../models/messages');
const channels = require('../models/channels');

const router = express.Router();

router.get('/', (req, res) => {
  const rows = notifications.list(req.user.id);
  const byId = new Map(messages.serializeAll(rows.map((r) => messages.get(r.message_id)).filter(Boolean)).map((m) => [m.id, m]));
  res.json(rows.filter((r) => byId.has(r.message_id)).map((r) => {
    const message = byId.get(r.message_id);
    return {
      id: r.id, kind: r.kind, readAt: r.read_at, createdAt: r.created_at, message,
      channel: channels.serialize(channels.get(message.channelId), req.user.id),
    };
  }));
});

// Body { ids } marks those read; no ids marks everything read.
router.post('/read', (req, res) => {
  const ids = req.body.ids;
  if (ids !== undefined && (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string'))) fail(400, 'ids must be a list.');
  notifications.markRead(req.user.id, ids);
  res.sendStatus(204);
});

router.delete('/:id', (req, res) => {
  if (!notifications.remove(req.user.id, req.params.id)) fail(404, 'Notification not found.');
  res.sendStatus(204);
});

module.exports = router;
