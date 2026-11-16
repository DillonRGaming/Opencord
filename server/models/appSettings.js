// App-wide switches the owner changes from the dashboard. Stored as key → JSON value.
const db = require('../db');
const config = require('../config');

// Who may make an account: 'open' (anyone), 'invite' (only with a server invite) or 'closed' (nobody).
const REGISTRATION_MODES = ['open', 'invite', 'closed'];

function get(key, fallback) {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key);
  return row ? JSON.parse(row.value) : fallback;
}

function set(key, value) {
  db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, JSON.stringify(value));
}

function registrationMode() {
  const mode = get('registration', config.registrationOpen ? 'open' : 'closed');
  return REGISTRATION_MODES.includes(mode) ? mode : 'closed';
}

module.exports = { REGISTRATION_MODES, get, set, registrationMode };
