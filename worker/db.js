// The database on Cloudflare: a Durable Object's own SQLite, behind the small slice of better-sqlite3's API
// that Opencord's models use (prepare().get/all/run, exec, transaction).
// `current()` gives the Durable Object's ctx right now: Cloudflare can rebuild the object in the same process,
// and modules keep this one db for good, so it must always reach the live storage.
function sqliteDb(current) {
  const storage = () => current().storage;
  let depth = 0;

  // better-sqlite3 refuses undefined and booleans; SQLite stores booleans as 0/1.
  const clean = (params) => params.map((p) => (p === undefined ? null : typeof p === 'boolean' ? Number(p) : p));
  // BLOBs come back as ArrayBuffer here and as Buffer from better-sqlite3.
  const row = (r) => {
    for (const key in r) if (r[key] instanceof ArrayBuffer) r[key] = Buffer.from(r[key]);
    return r;
  };

  function prepare(query) {
    return {
      get: (...params) => {
        const rows = storage().sql.exec(query, ...clean(params)).toArray();
        return rows.length ? row(rows[0]) : undefined;
      },
      all: (...params) => storage().sql.exec(query, ...clean(params)).toArray().map(row),
      run: (...params) => {
        const { sql } = storage();
        sql.exec(query, ...clean(params)).toArray();
        return { changes: sql.exec('SELECT changes() AS n').one().n };
      },
    };
  }

  return {
    prepare,
    exec: (text) => {
      storage().sql.exec(text);
    },
    // Nested transactions just join the outer one (a Durable Object runs one request's code at a time anyway).
    transaction: (fn) => (...args) => {
      if (depth > 0) return fn(...args);
      depth += 1;
      try {
        return storage().transactionSync(() => fn(...args));
      } finally {
        depth -= 1;
      }
    },
    sizeBytes: () => storage().sql.databaseSize,
    close: () => {},
  };
}

export { sqliteDb };
