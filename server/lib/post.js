// Posting a message: save it, tell everyone in the channel, notify mentions and replies, and wake bots.
// Used by the messages route and by bots, so both behave the same.
const messages = require('../models/messages');
const channels = require('../models/channels');
const servers = require('../models/servers');
const notifications = require('../models/notifications');
const realtime = require('../realtime');
const previews = require('./previews');

const listeners = []; // (event, payload) → void, e.g. the bot runner

function onPost(fn) {
  listeners.push(fn);
}

function audienceIds(channel) {
  return channel.type === 'dm' ? channels.dmMemberIds(channel.id) : servers.memberIds(channel.server_id);
}

function postMessage(channel, authorId, content, { attachmentIds = [], replyToId = null, poll = null, components = null } = {}) {
  let row = messages.create(channel.id, authorId, content, attachmentIds, replyToId);
  if (poll) messages.createPoll(row.id, poll);
  if (components) row = messages.setComponents(row.id, components);
  const json = messages.serialize(row);
  if (channel.slowmode) channels.notePost(channel.id, authorId);
  realtime.toChannel(channel, 'message:create', json);

  const replyAuthor = replyToId ? messages.get(replyToId)?.author_id : null;
  for (const [userId, kind] of notifications.recipients(content, audienceIds(channel), authorId, replyAuthor, channel.server_id)) {
    const note = notifications.create(userId, kind, row.id, authorId);
    realtime.toUser(userId, 'notification', { id: note.id, kind, readAt: null, createdAt: note.created_at, message: json, channel: channels.serialize(channel, userId) });
  }
  for (const fn of listeners) {
    try { fn('message', { channel, message: json }); } catch (err) { console.error(err); }
  }
  attachPreviews(channel, row.id, content);
  require('./links').relay(channel, row);
  return json;
}

// Previews arrive a moment after the message: fetch them, save them, and update everyone's copy.
function attachPreviews(channel, messageId, content) {
  if (!previews.linksIn(content).length) {
    if (messages.get(messageId)?.embeds) realtime.toChannel(channel, 'message:update', messages.serialize(messages.setEmbeds(messageId, [])));
    return;
  }
  previews.forContent(content).then((embeds) => {
    if (!messages.get(messageId)) return;
    realtime.toChannel(channel, 'message:update', messages.serialize(messages.setEmbeds(messageId, embeds)));
  }).catch((err) => console.error('Previews failed:', err.message));
}

// Opencord's own account, used for welcome messages. "~" can't be in a real username, so nobody can take it.
function systemUser() {
  const users = require('../models/users');
  const db = require('../db');
  let user = users.getByUsername('~system');
  if (!user) {
    user = users.create({ username: '~system', displayName: 'Opencord', passwordHash: '!system' });
    db.prepare('UPDATE users SET is_bot = 1 WHERE id = ?').run(user.id);
  }
  return user;
}

// When a server has a welcome channel, greet each new member there.
function welcome(server, user) {
  if (!server.welcome_channel_id) return;
  const channel = channels.get(server.welcome_channel_id);
  if (!channel || channel.server_id !== server.id) return;
  const text = (server.welcome_message || 'Welcome to {server}, {user}!')
    .replaceAll('{user}', `@${user.username}`).replaceAll('{server}', server.name).slice(0, 1000);
  try {
    postMessage(channel, systemUser().id, text);
  } catch (err) {
    console.error('Welcome message failed:', err.message);
  }
}

function emit(event, payload) {
  for (const fn of listeners) {
    try { fn(event, payload); } catch (err) { console.error(err); }
  }
}

module.exports = { postMessage, onPost, emit, attachPreviews, welcome, systemUser };
