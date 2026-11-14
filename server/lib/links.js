// Linked channels: a group of text channels, in servers that one person owns, that share messages. Posting in
// one copies the message into the rest (by the same author, marked with where it came from); editing or
// deleting the original does the same to the copies. Copies are never copied again, so nothing loops.
const db = require('../db');
const { newId } = require('./ids');
const channels = require('../models/channels');
const servers = require('../models/servers');
const messages = require('../models/messages');
const realtime = require('../realtime');

function linked(channelId) {
  const row = db.prepare('SELECT group_id FROM channel_links WHERE channel_id = ?').get(channelId);
  if (!row) return [];
  return db.prepare('SELECT channel_id FROM channel_links WHERE group_id = ? AND channel_id != ?').all(row.group_id, channelId)
    .map((r) => channels.get(r.channel_id)).filter(Boolean);
}

function describe(channel) {
  const server = servers.get(channel.server_id);
  return { id: channel.id, name: channel.name, serverId: channel.server_id, serverName: server?.name || '' };
}

const link = db.transaction((a, b, userId) => {
  const existing = db.prepare('SELECT group_id FROM channel_links WHERE channel_id IN (?, ?)').all(a.id, b.id).map((r) => r.group_id);
  const group = existing[0] || newId();
  // Joining two groups merges them.
  for (const other of existing.slice(1)) db.prepare('UPDATE channel_links SET group_id = ? WHERE group_id = ?').run(group, other);
  for (const channel of [a, b]) {
    db.prepare('INSERT OR REPLACE INTO channel_links (channel_id, group_id, created_by, created_at) VALUES (?, ?, ?, ?)')
      .run(channel.id, group, userId, Date.now());
  }
});

function unlink(channelId) {
  const row = db.prepare('SELECT group_id FROM channel_links WHERE channel_id = ?').get(channelId);
  db.prepare('DELETE FROM channel_links WHERE channel_id = ?').run(channelId);
  // A group of one is no group.
  if (row && db.prepare('SELECT COUNT(*) AS n FROM channel_links WHERE group_id = ?').get(row.group_id).n === 1) {
    db.prepare('DELETE FROM channel_links WHERE group_id = ?').run(row.group_id);
  }
}

// After a message is posted: copy it into the linked channels.
function relay(channel, row) {
  if (row.relay_of || channel.type !== 'text') return;
  const targets = linked(channel.id);
  if (!targets.length) return;
  const from = JSON.stringify({ server: servers.get(channel.server_id)?.name || '', channel: channel.name });
  for (const target of targets) {
    const copy = messages.create(target.id, row.author_id, row.content, [], null);
    db.prepare('UPDATE messages SET relay_of = ?, relay = ? WHERE id = ?').run(row.id, from, copy.id);
    realtime.toChannel(target, 'message:create', messages.serialize(messages.get(copy.id)));
  }
}

function copiesOf(messageId) {
  return db.prepare('SELECT * FROM messages WHERE relay_of = ?').all(messageId);
}

function relayEdit(row) {
  for (const copy of copiesOf(row.id)) {
    const edited = messages.edit(copy.id, row.content);
    realtime.toChannel(channels.get(copy.channel_id), 'message:update', messages.serialize(edited));
  }
}

function relayDelete(row) {
  for (const copy of copiesOf(row.id)) {
    messages.remove(copy);
    realtime.toChannel(channels.get(copy.channel_id), 'message:delete', { id: copy.id, channelId: copy.channel_id });
  }
}

module.exports = { linked, describe, link, unlink, relay, relayEdit, relayDelete };
