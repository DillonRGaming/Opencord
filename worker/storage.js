// The file store for the Hub (see server/lib/storage.js): every call goes to the file's shard. Sending a file
// doesn't pass the bytes through the Hub: it answers with an X-Opencord-File marker, and the Worker in front
// (worker/index.js) streams the file straight from its shard, Range requests included.
import { shardOf } from './files.js';

export const FILE_MARKER = 'X-Opencord-File';

export function shardStub(env, path) {
  return env.FILES.get(env.FILES.idFromName(`shard-${shardOf(path)}`));
}

// `env()` gives the current bindings (see worker/db.js on why it's a function).
export function cloudFiles(env) {
  const stub = (path) => shardStub(env(), path);
  return {
    write: (path, buffer) => stub(path).write(path, new Uint8Array(buffer)),
    append: (path, offset, buffer) => stub(path).append(path, offset, new Uint8Array(buffer)),
    rename: (from, to) => stub(from).rename(from, to),
    // Deleting is never worth failing a request over; a leftover is cleaned up by the next delete.
    remove(paths) {
      const byShard = new Map();
      for (const path of paths) {
        const n = shardOf(path);
        if (!byShard.has(n)) byShard.set(n, []);
        byShard.get(n).push(path);
      }
      return Promise.all([...byShard.values()].map((list) => stub(list[0]).remove(list)
        .catch((err) => console.error('Removing files failed:', err)))).then(() => undefined);
    },
    send(req, res, path, headers) {
      res.status(200).set({ ...headers, [FILE_MARKER]: path }).end();
    },
  };
}
