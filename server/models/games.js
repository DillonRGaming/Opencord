// Games in chat messages: the rules are in lib/games.js, this file only stores them.
const db = require('../db');
const { GAMES } = require('../lib/games');

// game: { kind, players: [userId, userId|null] }. A null second seat goes to whoever moves first.
function create(messageId, { kind, players }) {
  db.prepare('INSERT INTO games (message_id, game, players, state, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run(messageId, kind, JSON.stringify(players), JSON.stringify(GAMES[kind].init()), Date.now());
}

function get(messageId) {
  const row = db.prepare('SELECT * FROM games WHERE message_id = ?').get(messageId);
  return row && { kind: row.game, players: JSON.parse(row.players), state: JSON.parse(row.state) };
}

function save(messageId, players, state) {
  db.prepare('UPDATE games SET players = ?, state = ?, updated_at = ? WHERE message_id = ?')
    .run(JSON.stringify(players), JSON.stringify(state), Date.now(), messageId);
}

module.exports = { create, get, save };
