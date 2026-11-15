const express = require('express');
const storage = require('../lib/storage');
const access = require('../lib/access');
const { fail, text } = require('../lib/http');
const servers = require('../models/servers');
const messages = require('../models/messages');
const attachments = require('../models/attachments');
const realtime = require('../realtime');
const audit = require('../models/audit');
const { attachPreviews, emit } = require('../lib/post');
const bots = require('../lib/bots');
const links = require('../lib/links');
const users = require('../models/users');

const router = express.Router();

function visibleMessage(messageId, userId) {
  const message = messages.get(messageId);
  if (!message) fail(404, 'Message not found.');
  return { message, channel: access.visibleChannel(message.channel_id, userId) };
}

// One message, for the quote card shown where someone pasted a link to it.
router.get('/:id', (req, res) => {
  const { message, channel } = visibleMessage(req.params.id, req.user.id);
  res.json({ ...messages.serialize(message), channelName: channel.type === 'dm' ? null : channel.name, serverId: channel.server_id });
});

// The whole text of a message that was sent cut short.
router.get('/:id/content', (req, res) => {
  const { message } = visibleMessage(req.params.id, req.user.id);
  res.json({ id: message.id, content: message.content });
});

router.patch('/:id', (req, res) => {
  const { message, channel } = visibleMessage(req.params.id, req.user.id);
  if (message.author_id !== req.user.id) fail(403, 'You can only edit your own messages.');
  const content = text(req.body.content, 'Message', { max: 1000 });
  if (!content && !messages.hasAttachments(message.id)) fail(400, "A message can't be empty.");

  const json = messages.serialize(messages.edit(message.id, content));
  realtime.toChannel(channel, 'message:update', json);
  links.relayEdit(messages.get(message.id));
  res.json(json);
  attachPreviews(channel, message.id, content);
});

router.delete('/:id', (req, res) => {
  const { message, channel } = visibleMessage(req.params.id, req.user.id);
  const mine = message.author_id === req.user.id;
  const moderator = channel.server_id && servers.can(channel.server_id, req.user.id, 'manageMessages');
  if (!mine && !moderator) fail(403, "You can't delete that message.");

  const files = [message, ...messages.threadMessages(message.id)].flatMap((m) => attachments.pathsForMessage(m.id));
  links.relayDelete(message);
  messages.remove(message);
  storage.remove(...files);
  realtime.toChannel(channel, 'message:delete', { id: message.id, channelId: channel.id });
  if (!mine) audit.log(channel.server_id, req.user.id, 'message.delete', `#${channel.name}`, message.content.slice(0, 120));
  res.sendStatus(204);
});

// Reactions: any emoji (or short text), up to 32 characters. Adding twice or removing a missing one is fine.
function reactionRoute(add) {
  return (req, res) => {
    const { message, channel } = visibleMessage(req.params.id, req.user.id);
    const emoji = text(req.params.emoji, 'Reaction', { min: 1, max: 80 });
    if (add) messages.react(message.id, req.user.id, emoji);
    else messages.unreact(message.id, req.user.id, emoji);
    if (add) emit('reaction', { channel, message: messages.serialize(message), user: users.toUser(users.get(req.user.id)), emoji });
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
    if (channel.server_id && servers.get(channel.server_id)?.pins_admin_only && !servers.can(channel.server_id, req.user.id, 'manageMessages')) {
      fail(403, 'You need permission to pin messages in this server.');
    }
    const json = messages.serialize(messages.setPinned(message.id, pinned));
    realtime.toChannel(channel, 'message:update', json);
    res.json(json);
  };
}

router.put('/:id/poll/:option', (req, res) => {
  const { message, channel } = visibleMessage(req.params.id, req.user.id);
  const poll = messages.getPoll(message.id);
  if (!poll) fail(404, 'That message has no poll.');
  if (poll.closes_at && poll.closes_at <= Date.now()) fail(400, 'This poll has closed.');
  const option = Number(req.params.option);
  if (!Number.isInteger(option) || option < 0 || option >= JSON.parse(poll.options).length) fail(400, 'That option is not in the poll.');
  messages.vote(message.id, req.user.id, option, Boolean(poll.multi));
  const json = messages.serialize(messages.get(message.id));
  realtime.toChannel(channel, 'message:update', json);
  res.json(json);
});

// A button under a bot's message.
const clicks = new Map(); // userId → last click time
router.post('/:id/buttons/:index', (req, res) => {
  const { message, channel } = visibleMessage(req.params.id, req.user.id);
  const buttons = message.components ? JSON.parse(message.components) : [];
  const button = buttons[Number(req.params.index)];
  if (!button || button.type === 'menu') fail(404, 'That button is gone.');
  if (Date.now() - (clicks.get(req.user.id) || 0) < 1000) fail(429, 'Slow down a little.');
  clicks.set(req.user.id, Date.now());
  const ran = bots.clickButton(channel, message, req.user, button.label);
  res.json({ ok: ran });
});

// A choice from a drop-down under a bot's message.
router.post('/:id/menus/:index', (req, res) => {
  const { message, channel } = visibleMessage(req.params.id, req.user.id);
  const parts = message.components ? JSON.parse(message.components) : [];
  const menu = parts[Number(req.params.index)];
  if (menu?.type !== 'menu') fail(404, 'That menu is gone.');
  const choice = text(req.body.value, 'Choice');
  if (!menu.options.includes(choice)) fail(400, 'That isn’t one of the choices.');
  if (Date.now() - (clicks.get(req.user.id) || 0) < 1000) fail(429, 'Slow down a little.');
  clicks.set(req.user.id, Date.now());
  res.json({ ok: bots.pickFromMenu(channel, message, req.user, choice) });
});

// A move in a game: { move } or { resign: true }. Only the two players, only on their turn.
router.post('/:id/game', (req, res) => {
  const { message, channel } = visibleMessage(req.params.id, req.user.id);
  const games = require('../models/games');
  const { GAMES, MoveError } = require('../lib/games');
  const game = games.get(message.id);
  if (!game) fail(404, 'That message has no game.');
  const { players } = game;
  if (game.state.over) fail(400, 'This game is over.');
  // An open seat goes to the first other person who plays.
  if (!players[1] && req.user.id !== players[0]) players[1] = req.user.id;
  const seat = players.indexOf(req.user.id);
  if (seat === -1) fail(403, 'Only the two players can play. Start your own with /' + game.kind + '.');
  let state;
  if (req.body.resign) {
    state = { ...game.state, over: true, winner: 1 - seat, reason: 'resigned', turn: null };
  } else {
    if (game.state.turn !== null && game.state.turn !== undefined && game.state.turn !== seat) fail(400, 'It’s not your turn.');
    try {
      state = GAMES[game.kind].move(game.state, seat, req.body.move);
    } catch (err) {
      if (err instanceof MoveError) fail(400, err.message);
      throw err;
    }
  }
  games.save(message.id, players, state);
  const json = messages.serialize(messages.get(message.id));
  realtime.toChannel(channel, 'message:update', json);
  res.json(json);
});

router.put('/:id/pin', pinRoute(true));
router.delete('/:id/pin', pinRoute(false));

module.exports = router;
