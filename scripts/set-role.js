// Makes someone the Opencord owner or an admin (app-wide, not a server role), or takes it away.
//   npm run set-role -- <username> owner|admin|none
// The owner can then hand out admin from the dashboard.
require('../server/node').setupNode();
const db = require('../server/db');

const [username, role] = process.argv.slice(2);
if (!username || !['owner', 'admin', 'none'].includes(role)) {
  console.error('Usage: npm run set-role -- <username> owner|admin|none');
  process.exit(1);
}
const user = db.prepare('SELECT id, is_bot FROM users WHERE username = ? COLLATE NOCASE').get(username);
if (!user || user.is_bot) {
  console.error(`No person called "${username}".`);
  process.exit(1);
}
db.prepare('UPDATE users SET app_role = ? WHERE id = ?').run(role === 'none' ? null : role, user.id);
const label = { owner: 'the owner', admin: 'an admin', none: 'a regular user' }[role];
console.log(`${username} is now ${label}.`);
db.close();
