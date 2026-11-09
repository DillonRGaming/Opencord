const express = require('express');
const storage = require('../lib/storage');
const access = require('../lib/access');
const { fail, text } = require('../lib/http');
const servers = require('../models/servers');
const messages = require('../models/messages');
const attachments = require('../models/attachments');
const realtime = require('../realtime');

const router = express.Router();

function visibleMessage(messageId, userId) {
  const message = messages.get(messageId);
  if (!message) fail(404, 'Message not found.');
  return { message, channel: access.visibleChannel(message.channel_id, userId) };
}

router.patch('/:id', (req, res) => {
  const { message, channel } = visibleMessage(req.params.id, req.user.id);
  if (message.author_id !== req.user.id) fail(403, 'You can only edit your own messages.');
  const content = text(req.body.content, 'Message');
  if (!content && !messages.hasAttachments(message.id)) fail(400, "A message can't be empty.");

  const json = messages.serialize(messages.edit(message.id, content));
  realtime.toChannel(channel, 'message:update', json);
  res.json(json);
});

router.delete('/:id', (req, res) => {
  const { message, channel } = visibleMessage(req.params.id, req.user.id);
  const isOwner = channel.server_id && servers.get(channel.server_id).owner_id === req.user.id;
  if (message.author_id !== req.user.id && !isOwner) fail(403, "You can't delete that message.");

  const files = attachments.pathsForMessage(message.id);
  messages.remove(message);
  storage.remove(...files);
  realtime.toChannel(channel, 'message:delete', { id: message.id, channelId: channel.id });
  res.sendStatus(204);
});

// Reactions: any emoji (or short text), up to 32 characters. Adding twice or removing a missing one is fine.
function reactionRoute(add) {
  return (req, res) => {
    const { message, channel } = visibleMessage(req.params.id, req.user.id);
    const emoji = text(req.params.emoji, 'Reaction', { min: 1, max: 32 });
    if (add) messages.react(message.id, req.user.id, emoji);
    else messages.unreact(message.id, req.user.id, emoji);
    const json = messages.serialize(messages.get(message.id));
    realtime.toChannel(channel, 'message:update', json);
    res.json(json);
  };
}

router.put('/:id/reactions/:emoji', reactionRoute(true));
router.delete('/:id/reactions/:emoji', reactionRoute(false));

// Anyone who can see a message can pin it: Opencord is for friends, not moderation.
function pinRoute(pinned) {
  return (req, res) => {
    const { message, channel } = visibleMessage(req.params.id, req.user.id);
    const json = messages.serialize(messages.setPinned(message.id, pinned));
    realtime.toChannel(channel, 'message:update', json);
    res.json(json);
  };
}

router.put('/:id/pin', pinRoute(true));
router.delete('/:id/pin', pinRoute(false));

module.exports = router;
