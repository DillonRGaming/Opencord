const express = require('express');
const limits = require('../lib/limits');
const storage = require('../lib/storage');
const access = require('../lib/access');
const { fail, text } = require('../lib/http');
const channels = require('../models/channels');
const servers = require('../models/servers');
const messages = require('../models/messages');
const attachments = require('../models/attachments');
const relationships = require('../models/relationships');
const users = require('../models/users');
const realtime = require('../realtime');
const { channelName, categoryName } = require('./servers');
const audit = require('../models/audit');
const notifications = require('../models/notifications');
const { postMessage } = require('../lib/post');
const links = require('../lib/links');

const router = express.Router();

// Server channel that the user can manage (admins and the owner; for a post, also whoever started it).
function ownedChannel(channelId, userId) {
  const channel = access.visibleChannel(channelId, userId);
  if (channel.type !== 'text') fail(400, "DMs can't be changed here.");
  if (channel.kind === 'post' && channel.owner_id === userId) return channel;
  access.permServer(channel.server_id, userId, 'manageChannels');
  return channel;
}

// Seconds a new member still has to wait before posting (the server's "new members wait" setting).
function newMemberWait(serverId, userId) {
  const server = servers.get(serverId);
  if (!server?.member_wait) return 0;
  const joined = servers.member(serverId, userId)?.joinedAt || 0;
  return Math.max(0, Math.ceil((joined + server.member_wait * 1000 - Date.now()) / 1000));
}

const NO_POSTING = ['category', 'voice', 'posts', 'whiteboard', 'calendar', 'music', 'wiki', 'video'];

const label = (channel) => (channel.kind === 'category' || channel.kind === 'post' ? channel.name : `#${channel.name}`);

router.get('/:id', (req, res) => {
  const channel = access.visibleChannel(req.params.id, req.user.id);
  res.json(channel.kind === 'post' ? channels.toPost(channel) : channels.serialize(channel, req.user.id));
});

// --- linked channels (between servers you own) ---

function ownedTextChannel(id, userId) {
  const channel = access.visibleChannel(id, userId);
  if (channel.kind !== 'text') fail(400, 'Only text channels can be linked.');
  if (servers.get(channel.server_id)?.owner_id !== userId) fail(403, 'Only the owner of both servers can link channels.');
  return channel;
}

router.get('/:id/links', (req, res) => {
  const channel = ownedTextChannel(req.params.id, req.user.id);
  const linked = links.linked(channel.id);
  // What it could link to: text channels in the other servers this person owns.
  const candidates = servers.forUser(req.user.id).filter((s) => s.owner_id === req.user.id && s.id !== channel.server_id)
    .flatMap((s) => channels.forServer(s.id).filter((c) => c.kind === 'text' && !linked.some((l) => l.id === c.id)).map(links.describe));
  res.json({ linked: linked.map(links.describe), candidates });
});

router.post('/:id/links', (req, res) => {
  const channel = ownedTextChannel(req.params.id, req.user.id);
  const other = ownedTextChannel(text(req.body.channelId, 'channelId'), req.user.id);
  if (other.server_id === channel.server_id) fail(400, 'Link it to a channel in another server.');
  links.link(channel, other, req.user.id);
  audit.log(channel.server_id, req.user.id, 'channel.link', `#${channel.name}`, `#${other.name} in ${servers.get(other.server_id).name}`);
  res.json({ linked: links.linked(channel.id).map(links.describe) });
});

router.delete('/:id/links', (req, res) => {
  const channel = ownedTextChannel(req.params.id, req.user.id);
  links.unlink(channel.id);
  audit.log(channel.server_id, req.user.id, 'channel.unlink', `#${channel.name}`);
  res.sendStatus(204);
});

// --- posts channels ---

function postsChannel(id, userId) {
  const channel = access.visibleChannel(id, userId);
  if (channel.kind !== 'posts') fail(400, 'That is not a posts channel.');
  return channel;
}

router.get('/:id/posts', (req, res) => {
  res.json(channels.posts(postsChannel(req.params.id, req.user.id).id));
});

// A new post: a title and its first message (text and/or files).
router.post('/:id/posts', (req, res) => {
  const parent = postsChannel(req.params.id, req.user.id);
  const title = text(req.body.title, 'Title', { min: 1, max: 100 });
  const content = text(req.body.content ?? '', 'Message', { max: 1000 });
  const attachmentIds = Array.isArray(req.body.attachmentIds) ? req.body.attachmentIds.filter((id) => typeof id === 'string') : [];
  if (!content && !attachmentIds.length) fail(400, 'Write something in the post.');
  limits.take('messages', req.user.id);
  if (servers.roleOf(parent.server_id, req.user.id) === 'member') {
    if (servers.timeoutUntil(parent.server_id, req.user.id)) fail(403, 'You are timed out.');
    if (!channels.canPost(req.user.id, parent)) fail(403, 'You can’t start posts here.');
  }
  const post = channels.createPost(parent, req.user.id, title);
  postMessage(post, req.user.id, content, { attachmentIds: [...new Set(attachmentIds)] });
  const json = channels.toPost(channels.get(post.id));
  realtime.toServer(parent.server_id, 'post:create', json);
  res.status(201).json(json);
});

// --- whiteboards ---

function whiteboard(id, userId) {
  const channel = access.visibleChannel(id, userId);
  if (channel.kind !== 'whiteboard') fail(400, 'That is not a whiteboard.');
  return channel;
}

router.get('/:id/strokes', (req, res) => {
  res.json(channels.strokes(whiteboard(req.params.id, req.user.id).id));
});

router.delete('/:id/strokes', (req, res) => {
  const channel = whiteboard(req.params.id, req.user.id);
  access.permServer(channel.server_id, req.user.id, 'manageMessages');
  channels.clearStrokes(channel.id);
  realtime.toServer(channel.server_id, 'wb:clear', { channelId: channel.id });
  audit.log(channel.server_id, req.user.id, 'channel.update', `#${channel.name}`, 'cleared the whiteboard');
  res.sendStatus(204);
});

router.patch('/:id', (req, res) => {
  const channel = ownedChannel(req.params.id, req.user.id);
  const fields = {};
  if (req.body.name !== undefined) {
    if (channel.kind === 'post') fields.name = text(req.body.name, 'Title', { min: 1, max: 100 });
    else fields.name = channel.kind === 'category' ? categoryName(req.body.name) : channelName(req.body.name);
  }
  if (req.body.topic !== undefined) fields.topic = text(req.body.topic, 'Topic', { max: 1024 });
  if (req.body.slowmode !== undefined) {
    if (!Number.isSafeInteger(req.body.slowmode) || req.body.slowmode < 0 || req.body.slowmode > 21600) fail(400, 'Slowmode must be 0 to 21600 seconds.');
    fields.slowmode = req.body.slowmode;
  }
  if (req.body.readOnly !== undefined) fields.readOnly = req.body.readOnly ? 1 : 0;
  // Who can see it / who can post: null for everyone, or a list of this server's role ids.
  const roleList = (value, label) => {
    if (value === null) return null;
    const known = new Set(servers.roles(channel.server_id).map((r) => r.id));
    if (!Array.isArray(value) || value.some((id) => !known.has(id))) fail(400, `${label} must be roles in this server.`);
    return JSON.stringify([...new Set(value)]);
  };
  if (req.body.viewRoles !== undefined) fields.viewRoles = roleList(req.body.viewRoles, 'Who can see it');
  if (req.body.postRoles !== undefined) fields.postRoles = roleList(req.body.postRoles, 'Who can post');
  if (channel.kind === 'post') {
    const post = channels.toPost(channels.update(channel.id, fields));
    realtime.toServer(channel.server_id, 'post:update', post);
    return res.json(post);
  }
  const json = channels.toChannel(channels.update(channel.id, fields));
  realtime.toServer(channel.server_id, 'channel:update', json);
  const what = Object.keys(fields).map((k) => ({ readOnly: 'who can post', postRoles: 'who can post', viewRoles: 'who can see it', slowmode: `slowmode ${fields.slowmode}s` }[k] || k));
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
  if (channel.kind === 'post') {
    channels.remove(channel.id);
    storage.remove(...files);
    if (channel.owner_id !== req.user.id) audit.log(channel.server_id, req.user.id, 'post.delete', channel.name);
    realtime.toServer(channel.server_id, 'post:delete', { id: channel.id, parentId: channel.parent_id, serverId: channel.server_id });
    return res.sendStatus(204);
  }
  // A posts channel takes its posts with it.
  for (const postId of channel.kind === 'posts' ? channels.postIds(channel.id) : []) {
    files.push(...attachments.pathsForChannel(postId));
    channels.remove(postId);
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
  const content = text(req.body.content ?? '', 'Message', { max: 1000 });
  const attachmentIds = req.body.attachmentIds ?? [];
  if (!Array.isArray(attachmentIds) || attachmentIds.some((id) => typeof id !== 'string')) {
    fail(400, 'attachmentIds must be a list of ids.');
  }
  if (!content && !attachmentIds.length) fail(400, "You can't send an empty message.");
  const replyToId = req.body.replyToId == null ? null : text(req.body.replyToId, 'replyToId');
  const threadId = req.body.threadId == null ? null : text(req.body.threadId, 'threadId');
  if (NO_POSTING.includes(channel.kind)) fail(400, "You can't post in that channel.");
  checkCanPost(channel, req.user);
  res.status(201).json(postMessage(channel, req.user.id, content, { attachmentIds: [...new Set(attachmentIds)], replyToId, threadId }));
});

// Timeouts, new-member waits, channel permissions, slowmode and DM rules: everything that stops someone posting.
function checkCanPost(channel, user) {
  const req = { user };
  if (!user.is_bot) limits.take('messages', user.id);
  const role = channel.type === 'text' ? servers.roleOf(channel.server_id, req.user.id) : null;
  if (role === 'member') {
    const until = servers.timeoutUntil(channel.server_id, req.user.id);
    if (until) fail(403, `You are timed out until ${new Date(until).toLocaleString()}.`);
    const newWait = newMemberWait(channel.server_id, req.user.id);
    if (newWait) fail(403, `New members can post in ${Math.ceil(newWait / 60)} minute${newWait > 60 ? 's' : ''}.`);
    if (!channels.canPost(req.user.id, channel)) fail(403, 'You can’t post in this channel.');
    const wait = channels.slowmodeWait(channel, req.user.id);
    if (wait) fail(429, `Slowmode is on. You can post again in ${wait}s.`, { retryAfterMs: wait * 1000 });
  }
  if (channel.type === 'dm' && channel.kind !== 'group') {
    const [a, b] = channels.dmMemberIds(channel.id);
    if (relationships.eitherBlocked(a, b)) fail(403, "You can't message this user.");
    const other = a === req.user.id ? b : a;
    if (users.settingOf(other, 'dmsFrom', 'servers') === 'friends' && !relationships.areFriends(a, b) && !req.user.is_bot) {
      fail(403, 'They only take messages from friends.');
    }
  }
}

// A thread: the message it hangs off and every reply in it, oldest first.
router.get('/:id/threads/:rootId', (req, res) => {
  const channel = access.visibleChannel(req.params.id, req.user.id);
  const root = messages.get(req.params.rootId);
  if (!root || root.channel_id !== channel.id || root.thread_id) fail(404, 'Thread not found.');
  res.json({ root: messages.serialize(root), messages: messages.threadMessages(root.id) });
});

// Start a game in chat. opponentId: who to play (null = the first person to make a move).
router.post('/:id/games', (req, res) => {
  const channel = access.visibleChannel(req.params.id, req.user.id);
  if (NO_POSTING.includes(channel.kind)) fail(400, "You can't post in that channel.");
  checkCanPost(channel, req.user);
  const { GAMES } = require('../lib/games');
  const kind = String(req.body.game || '');
  if (!GAMES[kind]) fail(400, 'Unknown game.');
  let opponent = null;
  if (req.body.opponentId != null) {
    opponent = users.get(text(req.body.opponentId, 'opponentId'));
    if (!opponent || opponent.id === req.user.id) fail(400, 'Pick someone else to play against.');
    const audience = channel.type === 'dm' ? channels.dmMemberIds(channel.id) : servers.memberIds(channel.server_id).filter((id) => channels.canAccess(id, channel));
    if (!audience.includes(opponent.id)) fail(400, `${opponent.display_name} can’t see this channel.`);
  }
  const name = GAMES[kind].name;
  const content = opponent ? `🎮 <@${req.user.id}> challenged @${opponent.username} to ${name}!` : `🎮 <@${req.user.id}> started a game of ${name}. Anyone can join!`;
  res.status(201).json(postMessage(channel, req.user.id, content.replace(`<@${req.user.id}>`, `@${req.user.username}`), {
    game: { kind, players: [req.user.id, opponent?.id || null] },
  }));
});

// Share a location (from the browser's location, so it's as exact as the person's device makes it).
router.post('/:id/location', (req, res) => {
  const channel = access.visibleChannel(req.params.id, req.user.id);
  if (NO_POSTING.includes(channel.kind)) fail(400, "You can't post in that channel.");
  checkCanPost(channel, req.user);
  const lat = Number(req.body.lat);
  const lon = Number(req.body.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) fail(400, 'That isn’t a place on Earth.');
  const accuracy = Math.max(0, Math.min(100000, Math.round(Number(req.body.accuracy) || 0)));
  const label = req.body.label ? text(req.body.label, 'Label', { max: 100 }) : '';
  const round = (n) => Math.round(n * 1e6) / 1e6;
  res.status(201).json(postMessage(channel, req.user.id, `📍 ${label || 'Shared a location'}`, {
    components: [{ type: 'location', lat: round(lat), lon: round(lon), accuracy, label }],
  }));
});

// Polls: a message with a question and 2–10 options. closesIn is hours (0 or missing = never).
router.post('/:id/polls', (req, res) => {
  const channel = access.visibleChannel(req.params.id, req.user.id);
  if (NO_POSTING.includes(channel.kind)) fail(400, "You can't post in that channel.");
  const question = text(req.body.question, 'Question', { min: 1, max: 300 });
  const options = req.body.options;
  if (!Array.isArray(options) || options.length < 2 || options.length > 10) fail(400, 'A poll needs 2 to 10 options.');
  const cleaned = options.map((o, i) => text(o, `Option ${i + 1}`, { min: 1, max: 100 }));
  const hours = Number(req.body.closesIn) || 0;
  if (hours < 0 || hours > 24 * 30) fail(400, 'Polls can run for up to 30 days.');
  if (channel.type === 'text' && servers.roleOf(channel.server_id, req.user.id) === 'member') {
    if (servers.timeoutUntil(channel.server_id, req.user.id)) fail(403, 'You are timed out.');
    if (!channels.canPost(req.user.id, channel)) fail(403, 'You can’t post in this channel.');
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
  if (channel.type === 'dm' && channel.kind !== 'group') {
    const otherId = channels.dmMemberIds(channel.id).find((id) => id !== req.user.id);
    if (channels.receiptsOn(req.user.id, otherId)) realtime.toUser(otherId, 'dm:seen', { channelId: channel.id, messageId });
  }
  res.sendStatus(204);
});

module.exports = router;
