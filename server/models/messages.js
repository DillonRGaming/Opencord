const db = require('../db');
const { newId } = require('../lib/ids');
const { fail } = require('../lib/http');
const users = require('./users');
const channels = require('./channels');
const attachments = require('./attachments');

const REPLY_PREVIEW = 200;
// Very long messages (from before the 1000-character limit) are sent cut short; the rest is fetched only
// when someone clicks "Show more".
const LONG = 2000;
const LONG_PREVIEW = 1200;

// emoji → [userId…] for each message, in the order the emoji were first used.
// Where a linked-channel copy came from, so clicking its tag can jump to the original.
function relaySource(messageId) {
  const source = messageId && db.prepare(`SELECT messages.id, messages.channel_id, channels.server_id FROM messages
    JOIN channels ON channels.id = messages.channel_id WHERE messages.id = ?`).get(messageId);
  return source ? { messageId: source.id, channelId: source.channel_id, serverId: source.server_id } : {};
}

function reactionsByMessage(ids) {
  const out = new Map();
  if (!ids.length) return out;
  const rows = db.prepare(`SELECT message_id, emoji, user_id FROM reactions WHERE message_id IN (${ids.map(() => '?').join(',')})
    ORDER BY created_at, rowid`).all(...ids);
  for (const row of rows) {
    if (!out.has(row.message_id)) out.set(row.message_id, new Map());
    const byEmoji = out.get(row.message_id);
    if (!byEmoji.has(row.emoji)) byEmoji.set(row.emoji, []);
    byEmoji.get(row.emoji).push(row.user_id);
  }
  return out;
}

// What a reply shows of the message it answers: who wrote it and the start of the text.
function repliesById(ids) {
  const wanted = [...new Set(ids.filter(Boolean))];
  if (!wanted.length) return new Map();
  const rows = db.prepare(`SELECT id, author_id, content FROM messages WHERE id IN (${wanted.map(() => '?').join(',')})`).all(...wanted);
  const authors = users.mapByIds(rows.map((row) => row.author_id));
  return new Map(rows.map((row) => [row.id, {
    id: row.id, author: authors.get(row.author_id), content: row.content.slice(0, REPLY_PREVIEW),
  }]));
}

function serializeAll(rows) {
  const ids = rows.map((row) => row.id);
  const authors = users.mapByIds(rows.map((row) => row.author_id));
  // A copy in a linked channel shows the original's files.
  const files = attachments.mapByMessageIds([...ids, ...rows.map((row) => row.relay_of).filter(Boolean)]);
  const reactions = reactionsByMessage(ids);
  const replies = repliesById(rows.map((row) => row.reply_to_id));
  const polls = pollsById(ids);
  const games = gamesById(ids);
  const threads = threadsById(ids);
  return rows.map((row) => ({
    id: row.id,
    channelId: row.channel_id,
    author: authors.get(row.author_id),
    content: row.content.length > LONG ? row.content.slice(0, LONG_PREVIEW) : row.content,
    ...(row.content.length > LONG ? { truncated: true, length: row.content.length } : {}),
    attachments: files.get(row.relay_of || row.id) || [],
    relay: row.relay ? { ...JSON.parse(row.relay), ...relaySource(row.relay_of) } : null,
    // A reply whose original was deleted keeps replyTo: { id, deleted: true }.
    replyTo: row.reply_to_id ? (replies.get(row.reply_to_id) || { id: row.reply_to_id, deleted: true }) : null,
    reactions: [...(reactions.get(row.id) || [])].map(([emoji, userIds]) => ({ emoji, userIds })),
    pinned: row.pinned_at != null,
    embeds: row.embeds ? JSON.parse(row.embeds) : [],
    poll: polls.get(row.id) || null,
    game: games.get(row.id) || null,
    threadId: row.thread_id || null,
    thread: threads.get(row.id) || null,
    components: row.components ? JSON.parse(row.components) : null,
    editedAt: row.edited_at,
    createdAt: row.created_at,
  }));
}

// Games: the public view of each game's state (see lib/games.js).
function gamesById(ids) {
  const out = new Map();
  if (!ids.length) return out;
  const { GAMES } = require('../lib/games');
  for (const row of db.prepare('SELECT * FROM games WHERE message_id IN (SELECT value FROM json_each(?))').all(JSON.stringify(ids))) {
    const rules = GAMES[row.game];
    if (rules) out.set(row.message_id, { kind: row.game, name: rules.name, players: JSON.parse(row.players), ...rules.view(JSON.parse(row.state)) });
  }
  return out;
}

// Threads hanging off these messages: how many replies, when the last one was, and who's in it.
function threadsById(ids) {
  const out = new Map();
  if (!ids.length) return out;
  const rows = db.prepare(`SELECT thread_id, COUNT(*) AS n, MAX(created_at) AS last_at, json_group_array(DISTINCT author_id) AS people
    FROM messages WHERE thread_id IN (SELECT value FROM json_each(?)) GROUP BY thread_id`).all(JSON.stringify(ids));
  for (const row of rows) out.set(row.thread_id, { count: row.n, lastAt: row.last_at, people: JSON.parse(row.people).slice(0, 5) });
  return out;
}

function threadMessages(rootId) {
  return serializeAll(db.prepare('SELECT * FROM messages WHERE thread_id = ? ORDER BY id').all(rootId));
}

// Polls: question, options with the ids of who voted for each, and when it closes.
function pollsById(ids) {
  const out = new Map();
  if (!ids.length) return out;
  const list = JSON.stringify(ids);
  const rows = db.prepare('SELECT * FROM polls WHERE message_id IN (SELECT value FROM json_each(?))').all(list);
  if (!rows.length) return out;
  const votes = db.prepare('SELECT * FROM poll_votes WHERE message_id IN (SELECT value FROM json_each(?))').all(list);
  for (const row of rows) {
    const options = JSON.parse(row.options).map((text) => ({ text, userIds: [] }));
    for (const v of votes) if (v.message_id === row.message_id && options[v.option]) options[v.option].userIds.push(v.user_id);
    out.set(row.message_id, { question: row.question, options, multi: Boolean(row.multi), closesAt: row.closes_at });
  }
  return out;
}

function createPoll(messageId, { question, options, multi, closesAt }) {
  db.prepare('INSERT INTO polls (message_id, question, options, multi, closes_at) VALUES (?, ?, ?, ?, ?)')
    .run(messageId, question, JSON.stringify(options), multi ? 1 : 0, closesAt);
}

function getPoll(messageId) {
  return db.prepare('SELECT * FROM polls WHERE message_id = ?').get(messageId);
}

// Clicking an option you picked takes the vote back; on single-choice polls a new pick replaces the old one.
const vote = db.transaction((messageId, userId, option, multi) => {
  const had = db.prepare('SELECT 1 FROM poll_votes WHERE message_id = ? AND user_id = ? AND option = ?').get(messageId, userId, option);
  if (!multi) db.prepare('DELETE FROM poll_votes WHERE message_id = ? AND user_id = ?').run(messageId, userId);
  if (had) db.prepare('DELETE FROM poll_votes WHERE message_id = ? AND user_id = ? AND option = ?').run(messageId, userId, option);
  else db.prepare('INSERT INTO poll_votes (message_id, user_id, option) VALUES (?, ?, ?)').run(messageId, userId, option);
});

function newest(channelId, count) {
  return db.prepare('SELECT * FROM messages WHERE channel_id = ? ORDER BY id DESC LIMIT ?').all(channelId, count);
}

function setEmbeds(id, embeds) {
  db.prepare('UPDATE messages SET embeds = ? WHERE id = ?').run(embeds.length ? JSON.stringify(embeds) : null, id);
  return get(id);
}

function serialize(row) {
  return serializeAll([row])[0];
}

function get(id) {
  return db.prepare('SELECT * FROM messages WHERE id = ?').get(id);
}

// A page of messages, returned oldest → newest.
function list(channelId, { before, limit }) {
  const rows = before
    ? db.prepare('SELECT * FROM messages WHERE channel_id = ? AND thread_id IS NULL AND id < ? ORDER BY id DESC LIMIT ?').all(channelId, before, limit)
    : db.prepare('SELECT * FROM messages WHERE channel_id = ? AND thread_id IS NULL ORDER BY id DESC LIMIT ?').all(channelId, limit);
  return serializeAll(rows.reverse());
}

const create = db.transaction((channelId, authorId, content, attachmentIds, replyToId = null, threadId = null) => {
  if (replyToId && get(replyToId)?.channel_id !== channelId) fail(400, 'You can only reply to a message in the same channel.');
  if (threadId) {
    const root = get(threadId);
    if (root?.channel_id !== channelId || root.thread_id) fail(400, 'That thread is not in this channel.');
  }
  const id = newId();
  db.prepare('INSERT INTO messages (id, channel_id, author_id, content, reply_to_id, thread_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, channelId, authorId, content, replyToId, threadId, Date.now());
  if (attachments.attach(attachmentIds, authorId, id) !== attachmentIds.length) {
    fail(400, 'One of the attachments is missing or was already sent.');
  }
  db.prepare('UPDATE channels SET last_message_id = ? WHERE id = ?').run(id, channelId);
  channels.ack(authorId, channelId, id);
  return get(id);
});

function edit(id, content) {
  db.prepare('UPDATE messages SET content = ?, edited_at = ? WHERE id = ?').run(content, Date.now(), id);
  return get(id);
}

function setPinned(id, pinned) {
  db.prepare('UPDATE messages SET pinned_at = ? WHERE id = ?').run(pinned ? Date.now() : null, id);
  return get(id);
}

function pinned(channelId) {
  return serializeAll(db.prepare('SELECT * FROM messages WHERE channel_id = ? AND pinned_at IS NOT NULL ORDER BY pinned_at DESC').all(channelId));
}

// Newest first. Plain text match, case-insensitive for ASCII.
function search(channelId, query, limit = 50) {
  const pattern = `%${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  return serializeAll(db.prepare(`SELECT * FROM messages WHERE channel_id = ? AND content LIKE ? ESCAPE '\\' ORDER BY id DESC LIMIT ?`)
    .all(channelId, pattern, limit));
}

function react(messageId, userId, emoji) {
  db.prepare('INSERT OR IGNORE INTO reactions (message_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)').run(messageId, userId, emoji, Date.now());
}

function unreact(messageId, userId, emoji) {
  db.prepare('DELETE FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?').run(messageId, userId, emoji);
}

function hasAttachments(id) {
  return attachments.pathsForMessage(id).length > 0;
}

const remove = db.transaction((message) => {
  db.prepare('DELETE FROM messages WHERE id = ?').run(message.id);
  db.prepare('DELETE FROM messages WHERE thread_id = ?').run(message.id); // a thread goes with its first message
  db.prepare(`
    UPDATE channels SET last_message_id = (SELECT MAX(id) FROM messages WHERE channel_id = ?)
    WHERE id = ? AND last_message_id = ?
  `).run(message.channel_id, message.channel_id, message.id);
});

function copiesOf(id) {
  return db.prepare('SELECT * FROM messages WHERE relay_of = ?').all(id);
}

function setComponents(id, components) {
  db.prepare('UPDATE messages SET components = ? WHERE id = ?').run(JSON.stringify(components), id);
  return get(id);
}

module.exports = {
  setComponents, copiesOf, threadMessages,
  serializeAll,
  createPoll, getPoll, vote, setEmbeds, newest,
  serialize, get, list, create, edit, setPinned, pinned, search, react, unreact, hasAttachments, remove,
};
