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

function postMessage(channel, authorId, content, { attachmentIds = [], replyToId = null, poll = null } = {}) {
  const row = messages.create(channel.id, authorId, content, attachmentIds, replyToId);
  if (poll) messages.createPoll(row.id, poll);
  const json = messages.serialize(row);
  if (channel.slowmode) channels.notePost(channel.id, authorId);
  realtime.toChannel(channel, 'message:create', json);

  const replyAuthor = replyToId ? messages.get(replyToId)?.author_id : null;
  for (const [userId, kind] of notifications.recipients(content, audienceIds(channel), authorId, replyAuthor)) {
    const note = notifications.create(userId, kind, row.id, authorId);
    realtime.toUser(userId, 'notification', { id: note.id, kind, readAt: null, createdAt: note.created_at, message: json, channel: channels.serialize(channel, userId) });
  }
  for (const fn of listeners) {
    try { fn('message', { channel, message: json }); } catch (err) { console.error(err); }
  }
  attachPreviews(channel, row.id, content);
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

function emit(event, payload) {
  for (const fn of listeners) {
    try { fn(event, payload); } catch (err) { console.error(err); }
  }
}

module.exports = { postMessage, onPost, emit, attachPreviews };
