const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const config = require('../config');

fs.mkdirSync(config.dataDir, { recursive: true });

const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

// Migrations are numbered .sql files; PRAGMA user_version remembers how many have run.
function migrate() {
  const files = fs.readdirSync(config.migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  const done = db.pragma('user_version', { simple: true });
  for (const file of files.slice(done)) {
    const version = Number.parseInt(file, 10);
    db.transaction(() => {
      db.exec(fs.readFileSync(path.join(config.migrationsDir, file), 'utf8'));
      db.pragma(`user_version = ${version}`);
    })();
  }
}

migrate();

module.exports = db;
