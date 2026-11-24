// Personal stats: the extra things only you see about yourself on your Stats page (never on the admin dashboard).
// Who you talk to, where, your recent messages, and a few counts.

const db = require('../db');
const users = require('../models/users');

function personal(userId) {
  const all = (sql, ...args) => db.prepare(sql).all(...args);
  const one = (sql, ...args) => db.prepare(sql).get(...args)?.n || 0;

  // Where a message was: "#general · Test Lab", or the other person's name for a DM.
  const placeOf = (row) => (row.server_name ? `#${row.channel_name} · ${row.server_name}` : row.dm_name || 'Direct message');
  const PLACE = `c.name AS channel_name, s.name AS server_name,
    (SELECT u.display_name FROM dm_members o JOIN users u ON u.id = o.user_id WHERE o.channel_id = c.id AND o.user_id != ? LIMIT 1) AS dm_name`;

  const recent = all(`SELECT m.id, m.content, m.created_at, m.channel_id, c.server_id, ${PLACE}
    FROM messages m JOIN channels c ON c.id = m.channel_id LEFT JOIN servers s ON s.id = c.server_id
    WHERE m.author_id = ? ORDER BY m.created_at DESC LIMIT 8`, userId, userId)
    .map((r) => ({ id: r.id, content: r.content.slice(0, 200), at: r.created_at, channelId: r.channel_id, serverId: r.server_id, place: placeOf(r) }));

  const topServers = all(`SELECT s.id, s.name, COUNT(*) AS n FROM messages m JOIN channels c ON c.id = m.channel_id
    JOIN servers s ON s.id = c.server_id WHERE m.author_id = ? GROUP BY s.id ORDER BY n DESC LIMIT 6`, userId);
  const topChannels = all(`SELECT c.id, c.server_id AS serverId, c.name AS channel_name, s.name AS server_name, COUNT(*) AS n
    FROM messages m JOIN channels c ON c.id = m.channel_id JOIN servers s ON s.id = c.server_id
    WHERE m.author_id = ? GROUP BY c.id ORDER BY n DESC LIMIT 6`, userId)
    .map((r) => ({ id: r.id, serverId: r.serverId, name: `#${r.channel_name}`, server: r.server_name, n: r.n }));

  // People: DMs (both sides of the conversation), who you reply to, who replies to you, who reacts to you.
  const dmPeople = all(`SELECT other.user_id AS id, COUNT(m.id) AS n, SUM(m.author_id = ?) AS mine
    FROM dm_members me JOIN dm_members other ON other.channel_id = me.channel_id AND other.user_id != me.user_id
    JOIN messages m ON m.channel_id = me.channel_id WHERE me.user_id = ? GROUP BY other.user_id ORDER BY n DESC LIMIT 6`, userId, userId);
  const people = users.mapByIds(dmPeople.map((r) => r.id));
  const withUser = (rows) => rows.filter((r) => people.has(r.id)).map((r) => ({ user: people.get(r.id), n: r.n, mine: r.mine }));

  const reactionsReceived = one(`SELECT COUNT(*) AS n FROM reactions r JOIN messages m ON m.id = r.message_id
    WHERE m.author_id = ? AND r.user_id != ?`, userId, userId);
  const mentions = one("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND kind IN ('mention', 'role')", userId);
  const replies = one("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND kind = 'reply'", userId);

  return {
    recent,
    topServers,
    topChannels,
    dmPeople: withUser(dmPeople),
    facts: {
      totalMessages: one('SELECT COUNT(*) AS n FROM messages WHERE author_id = ?', userId),
      reactionsReceived,
      mentions,
      replies,
    },
  };
}

module.exports = { personal };
