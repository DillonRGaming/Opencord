// Uploaded files on Cloudflare. They're spread over SHARDS Durable Objects (each kept well under the free plan's
// 1 GB per object), stored in 1 MB pieces in each one's SQLite. A file's shard comes from its id (the name
// without folder or extension), so "tmp/<id>" and "images/<id>.png" live in the same place and a finished
// upload is renamed, never copied.
import { DurableObject } from 'cloudflare:workers';
import { parseRange } from '../server/lib/range.js';

export const SHARDS = 8; // never change once there are files: it decides where each one lives
const PIECE = 1024 * 1024;

const idOf = (path) => path.split('/').pop().replace(/\.[^.]*$/, '');

// FNV-1a: a stable, even spread of ids over the shards.
export function shardOf(path) {
  let hash = 0x811c9dc5;
  for (const ch of idOf(path)) {
    hash ^= ch.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % SHARDS;
}

export class FileShard extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS files (path TEXT PRIMARY KEY, size INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS pieces (path TEXT NOT NULL, n INTEGER NOT NULL, data BLOB NOT NULL, PRIMARY KEY (path, n));
    `);
  }

  size(path) {
    return this.sql.exec('SELECT size FROM files WHERE path = ?', path).toArray()[0]?.size ?? null;
  }

  // Cuts the file to `offset` bytes, then writes `bytes` from there. Returns the new size.
  append(path, offset, bytes) {
    const data = new Uint8Array(bytes);
    return this.ctx.storage.transactionSync(() => {
      const current = this.size(path);
      if (current === null) throw new Error('File not found.');
      if (offset > current) throw new Error('Offset is past the end of the file.');
      // Drop whole pieces past the cut, and trim the piece the cut lands in.
      const keep = Math.floor(offset / PIECE);
      this.sql.exec('DELETE FROM pieces WHERE path = ? AND n > ?', path, keep);
      const within = offset - keep * PIECE;
      const last = this.sql.exec('SELECT data FROM pieces WHERE path = ? AND n = ?', path, keep).toArray()[0];
      let head = last ? new Uint8Array(last.data).subarray(0, within) : new Uint8Array(0);
      if (!within) this.sql.exec('DELETE FROM pieces WHERE path = ? AND n = ?', path, keep);
      // Write the new bytes piece by piece, starting by filling up the trimmed piece.
      let at = 0;
      let n = keep;
      while (at < data.length) {
        const room = PIECE - head.length;
        const piece = new Uint8Array(head.length + Math.min(room, data.length - at));
        piece.set(head, 0);
        piece.set(data.subarray(at, at + piece.length - head.length), head.length);
        at += piece.length - head.length;
        this.sql.exec('INSERT OR REPLACE INTO pieces (path, n, data) VALUES (?, ?, ?)', path, n, piece);
        head = new Uint8Array(0);
        n += 1;
      }
      // Nothing new to add but the cut fell inside a piece: keep just its front.
      if (!data.length && head.length) this.sql.exec('INSERT OR REPLACE INTO pieces (path, n, data) VALUES (?, ?, ?)', path, keep, head);
      const size = offset + data.length;
      this.sql.exec('UPDATE files SET size = ? WHERE path = ?', size, path);
      return size;
    });
  }

  write(path, bytes) {
    this.ctx.storage.transactionSync(() => {
      this.sql.exec('DELETE FROM pieces WHERE path = ?', path);
      this.sql.exec('INSERT OR REPLACE INTO files (path, size) VALUES (?, 0)', path);
    });
    return this.append(path, 0, bytes);
  }

  rename(from, to) {
    this.ctx.storage.transactionSync(() => {
      if (this.size(from) === null) throw new Error('File not found.');
      this.sql.exec('DELETE FROM pieces WHERE path = ?', to);
      this.sql.exec('DELETE FROM files WHERE path = ?', to);
      this.sql.exec('UPDATE pieces SET path = ? WHERE path = ?', to, from);
      this.sql.exec('UPDATE files SET path = ? WHERE path = ?', to, from);
    });
  }

  remove(paths) {
    this.ctx.storage.transactionSync(() => {
      for (const path of paths) {
        this.sql.exec('DELETE FROM pieces WHERE path = ?', path);
        this.sql.exec('DELETE FROM files WHERE path = ?', path);
      }
    });
  }

  usage() {
    return this.sql.databaseSize;
  }

  // The file for a request with this Range header: { status: 200 | 206 | 416, size, start, end, stream } or null.
  read(path, rangeHeader) {
    const size = this.size(path);
    if (size === null) return null;
    const range = parseRange(rangeHeader, size);
    if (range === 'invalid') return { status: 416, size };
    const [start, end] = range || [0, size - 1];
    return { status: range ? 206 : 200, size, start, end, stream: this.stream(path, start, end) };
  }

  // Bytes start..end (inclusive) as a stream, read one piece at a time so memory stays small.
  stream(path, start, end) {
    const sql = this.sql;
    let at = start;
    const stream = new ReadableStream({
      pull(controller) {
        if (at > end) { controller.close(); return; }
        const n = Math.floor(at / PIECE);
        const row = sql.exec('SELECT data FROM pieces WHERE path = ? AND n = ?', path, n).toArray()[0];
        if (!row) { controller.error(new Error('A piece of the file is missing.')); return; }
        const piece = new Uint8Array(row.data);
        const from = at - n * PIECE;
        const to = Math.min(piece.length, end - n * PIECE + 1);
        controller.enqueue(piece.slice(from, to));
        at = n * PIECE + to;
      },
    });
    return stream;
  }
}
