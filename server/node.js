// Start-up for running Opencord on a computer: fills in server/platform.js with the Node versions.
// Must run before any module that uses the database is loaded.
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const config = require('./config');
const platform = require('./platform');
const { migrate } = require('./db/migrate');
const { filesNode } = require('./lib/filesNode');
const { fetchUrl } = require('./lib/fetchNode');

function readMigrations() {
  return fs.readdirSync(config.migrationsDir).filter((f) => f.endsWith('.sql')).sort()
    .map((file) => ({ version: Number.parseInt(file, 10), sql: fs.readFileSync(path.join(config.migrationsDir, file), 'utf8') }));
}

function openDatabase() {
  fs.mkdirSync(config.dataDir, { recursive: true });
  const db = new Database(config.dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  // Databases from before schema_migrations counted migrations in PRAGMA user_version: carry that over once.
  const hasTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'").get();
  const legacy = db.pragma('user_version', { simple: true });
  if (!hasTable && legacy > 0) {
    db.exec('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, ran_at INTEGER NOT NULL)');
    const insert = db.prepare('INSERT INTO schema_migrations (version, ran_at) VALUES (?, ?)');
    for (const { version } of readMigrations()) if (version <= legacy) insert.run(version, Date.now());
  }
  migrate(db, readMigrations());
  return db;
}

// Bytes in the data folder (database + uploads), walked at most once a minute.
let disk = { bytes: 0, at: 0 };
function dataBytes() {
  if (Date.now() - disk.at < 60 * 1000) return disk.bytes;
  let bytes = 0;
  for (const entry of fs.readdirSync(config.dataDir, { recursive: true, withFileTypes: true })) {
    if (entry.isFile()) bytes += fs.statSync(path.join(entry.parentPath, entry.name)).size;
  }
  disk = { bytes, at: Date.now() };
  return bytes;
}

function setupNode() {
  platform.setup({
    db: openDatabase(),
    files: filesNode(config.uploadsDir),
    fetchUrl,
    asset: (name) => fs.readFileSync(path.join(__dirname, 'assets', name)),
    every: (ms, fn) => setInterval(() => {
      try { fn(); } catch (err) { console.error('Scheduled job failed:', err); }
    }, ms).unref(),
    dataBytes,
    freeBytes: async () => {
      const stats = await fs.promises.statfs(config.dataDir);
      return stats.bavail * stats.bsize;
    },
  });
}

module.exports = { setupNode };
