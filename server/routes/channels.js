const express = require('express');
const storage = require('../lib/storage');
const access = require('../lib/access');
const { fail, text } = require('../lib/http');
const channels = require('../models/channels');
const messages = require('../models/messages');
const attachments = require('../models/attachments');
const relationships = require('../models/relationships');
const realtime = require('../realtime');
const { channelName } = require('./servers');

const router = express.Router();

// Server channel that the user owns (only owners manage channels).
function ownedChannel(channelId, userId) {
  const channel = access.visibleChannel(channelId, userId);
  if (channel.type !== 'text') fail(400, "DMs can't be changed.");
  access.ownedServer(channel.server_id, userId);
  return channel;
}

router.get('/:id', (req, res) => {
  res.json(channels.serialize(access.visibleChannel(req.params.id, req.user.id), req.user.id));
});

router.patch('/:id', (req, res) => {
  const channel = ownedChannel(req.params.id, req.user.id);
  const fields = {};
  if (req.body.name !== undefined) fields.name = channelName(req.body.name);
  if (req.body.topic !== undefined) fields.topic = text(req.body.topic, 'Topic', { max: 1024 });
  const json = channels.toChannel(channels.update(channel.id, fields));
  realtime.toServer(channel.server_id, 'channel:update', json);
  res.json(json);
});

router.delete('/:id', (req, res) => {
  const channel = ownedChannel(req.params.id, req.user.id);
  const files = attachments.pathsForChannel(channel.id);
  channels.remove(channel.id);
  storage.remove(...files);
  realtime.toServer(channel.server_id, 'channel:delete', { id: channel.id, serverId: channel.server_id });
  res.sendStatus(204);
});

router.get('/:id/messages', (req, res) => {
  const channel = access.visibleChannel(req.params.id, req.user.id);
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 50, 1), 100);
  const before = typeof req.query.before === 'string' ? req.query.before : null;
  res.json(messages.list(channel.id, { before, limit }));
});

router.get('/:id/pins', (req, res) => {
  res.json(messages.pinned(access.visibleChannel(req.params.id, req.user.id).id));
});

router.get('/:id/search', (req, res) => {
  const channel = access.visibleChannel(req.params.id, req.user.id);
  const query = text(req.query.q ?? '', 'Search', { min: 1, max: 200 });
  res.json(messages.search(channel.id, query));
});

router.post('/:id/messages', (req, res) => {
  const channel = access.visibleChannel(req.params.id, req.user.id);
  const content = text(req.body.content ?? '', 'Message');
  const attachmentIds = req.body.attachmentIds ?? [];
  if (!Array.isArray(attachmentIds) || attachmentIds.some((id) => typeof id !== 'string')) {
    fail(400, 'attachmentIds must be a list of ids.');
  }
  if (!content && !attachmentIds.length) fail(400, "You can't send an empty message.");
  const replyToId = req.body.replyToId == null ? null : text(req.body.replyToId, 'replyToId');
  if (channel.type === 'dm') {
    const [a, b] = channels.dmMemberIds(channel.id);
    if (relationships.eitherBlocked(a, b)) fail(403, "You can't message this user.");
  }

  const json = messages.serialize(messages.create(channel.id, req.user.id, content, [...new Set(attachmentIds)], replyToId));
  realtime.toChannel(channel, 'message:create', json);
  res.status(201).json(json);
});

router.post('/:id/ack', (req, res) => {
  const channel = access.visibleChannel(req.params.id, req.user.id);
  const messageId = text(req.body.messageId, 'messageId');
  channels.ack(req.user.id, channel.id, messageId);
  realtime.toUser(req.user.id, 'read', { channelId: channel.id, messageId });
  res.sendStatus(204);
});

module.exports = router;
