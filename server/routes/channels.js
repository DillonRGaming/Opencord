const express = require('express');
const storage = require('../lib/storage');
const access = require('../lib/access');
const { fail, text } = require('../lib/http');
const channels = require('../models/channels');
const servers = require('../models/servers');
const messages = require('../models/messages');
const attachments = require('../models/attachments');
const relationships = require('../models/relationships');
const realtime = require('../realtime');
const { channelName, categoryName } = require('./servers');
const audit = require('../models/audit');
const notifications = require('../models/notifications');
const { postMessage } = require('../lib/post');

const router = express.Router();

// Server channel that the user can manage (admins and the owner).
function ownedChannel(channelId, userId) {
  const channel = access.visibleChannel(channelId, userId);
  if (channel.type !== 'text') fail(400, "DMs can't be changed here.");
  access.modServer(channel.server_id, userId);
  return channel;
}

const label = (channel) => (channel.kind === 'category' ? channel.name : `#${channel.name}`);

router.get('/:id', (req, res) => {
  res.json(channels.serialize(access.visibleChannel(req.params.id, req.user.id), req.user.id));
});

router.patch('/:id', (req, res) => {
  const channel = ownedChannel(req.params.id, req.user.id);
  const fields = {};
  if (req.body.name !== undefined) fields.name = channel.kind === 'category' ? categoryName(req.body.name) : channelName(req.body.name);
  if (req.body.topic !== undefined) fields.topic = text(req.body.topic, 'Topic', { max: 1024 });
  if (req.body.slowmode !== undefined) {
    if (!Number.isSafeInteger(req.body.slowmode) || req.body.slowmode < 0 || req.body.slowmode > 21600) fail(400, 'Slowmode must be 0 to 21600 seconds.');
    fields.slowmode = req.body.slowmode;
  }
  if (req.body.readOnly !== undefined) fields.readOnly = req.body.readOnly ? 1 : 0;
  const json = channels.toChannel(channels.update(channel.id, fields));
  realtime.toServer(channel.server_id, 'channel:update', json);
  const what = Object.keys(fields).map((k) => ({ readOnly: 'who can post', slowmode: `slowmode ${fields.slowmode}s` }[k] || k));
  audit.log(channel.server_id, req.user.id, `${channel.kind === 'category' ? 'category' : 'channel'}.update`, label(channel), what.join(', '));
  res.json(json);
});

router.delete('/:id', (req, res) => {
  const channel = ownedChannel(req.params.id, req.user.id);
  const files = attachments.pathsForChannel(channel.id);
  // Deleting a category keeps its channels; they move out of it.
  if (channel.kind === 'category') {
    for (const child of channels.forServer(channel.server_id).filter((c) => c.parent_id === channel.id)) {
      realtime.toServer(channel.server_id, 'channel:update', channels.toChannel(channels.update(child.id, { parentId: null })));
    }
  }
  channels.remove(channel.id);
  audit.log(channel.server_id, req.user.id, `${channel.kind === 'category' ? 'category' : 'channel'}.delete`, label(channel));
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
  if (channel.kind === 'category' || channel.kind === 'voice') fail(400, "You can't post in that channel.");
  const role = channel.type === 'text' ? servers.roleOf(channel.server_id, req.user.id) : null;
  if (role === 'member') {
    const until = servers.timeoutUntil(channel.server_id, req.user.id);
    if (until) fail(403, `You are timed out until ${new Date(until).toLocaleString()}.`);
    if (channel.read_only) fail(403, 'Only admins and the owner can post in this channel.');
    const wait = channels.slowmodeWait(channel, req.user.id);
    if (wait) fail(429, `Slowmode is on. You can post again in ${wait}s.`, { retryAfterMs: wait * 1000 });
  }
  if (channel.type === 'dm' && channel.kind !== 'group') {
    const [a, b] = channels.dmMemberIds(channel.id);
    if (relationships.eitherBlocked(a, b)) fail(403, "You can't message this user.");
  }

  res.status(201).json(postMessage(channel, req.user.id, content, { attachmentIds: [...new Set(attachmentIds)], replyToId }));
});

// Polls: a message with a question and 2–10 options. closesIn is hours (0 or missing = never).
router.post('/:id/polls', (req, res) => {
  const channel = access.visibleChannel(req.params.id, req.user.id);
  if (channel.kind === 'category' || channel.kind === 'voice') fail(400, "You can't post in that channel.");
  const question = text(req.body.question, 'Question', { min: 1, max: 300 });
  const options = req.body.options;
  if (!Array.isArray(options) || options.length < 2 || options.length > 10) fail(400, 'A poll needs 2 to 10 options.');
  const cleaned = options.map((o, i) => text(o, `Option ${i + 1}`, { min: 1, max: 100 }));
  const hours = Number(req.body.closesIn) || 0;
  if (hours < 0 || hours > 24 * 30) fail(400, 'Polls can run for up to 30 days.');
  if (channel.type === 'text' && servers.roleOf(channel.server_id, req.user.id) === 'member') {
    if (servers.timeoutUntil(channel.server_id, req.user.id)) fail(403, 'You are timed out.');
    if (channel.read_only) fail(403, 'Only admins and the owner can post in this channel.');
  }
  res.status(201).json(postMessage(channel, req.user.id, `📊 ${question}`, {
    poll: { question, options: cleaned, multi: Boolean(req.body.multi), closesAt: hours ? Date.now() + hours * 3600_000 : null },
  }));
});

// Deletes the newest `count` messages (admins and the owner).
router.post('/:id/purge', (req, res) => {
  const channel = ownedChannel(req.params.id, req.user.id);
  const count = Number(req.body.count);
  if (!Number.isInteger(count) || count < 1 || count > 100) fail(400, 'You can clear 1 to 100 messages at a time.');
  const rows = messages.newest(channel.id, count);
  for (const row of rows) {
    storage.remove(...attachments.pathsForMessage(row.id));
    messages.remove(row);
    realtime.toChannel(channel, 'message:delete', { id: row.id, channelId: channel.id });
  }
  audit.log(channel.server_id, req.user.id, 'message.delete', `#${channel.name}`, `cleared ${rows.length} messages`);
  res.json({ deleted: rows.length });
});

router.post('/:id/ack', (req, res) => {
  const channel = access.visibleChannel(req.params.id, req.user.id);
  const messageId = text(req.body.messageId, 'messageId');
  channels.ack(req.user.id, channel.id, messageId);
  notifications.markChannelRead(req.user.id, channel.id);
  realtime.toUser(req.user.id, 'read', { channelId: channel.id, messageId });
  res.sendStatus(204);
});

module.exports = router;
