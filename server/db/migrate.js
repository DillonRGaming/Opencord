// Runs the numbered .sql migrations that haven't run yet, each in its own transaction.
// `migrations` is [{ version, sql }] sorted by version. Which ones ran is kept in schema_migrations.
function migrate(db, migrations) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, ran_at INTEGER NOT NULL)');
  const done = new Set(db.prepare('SELECT version FROM schema_migrations').all().map((r) => r.version));
  for (const { version, sql } of migrations) {
    if (done.has(version)) continue;
    db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (version, ran_at) VALUES (?, ?)').run(version, Date.now());
    })();
  }
}

module.exports = { migrate };
