// Files on a computer: a folder (data/uploads by default). See server/lib/storage.js for the interface.
const fs = require('node:fs');
const path = require('node:path');
const { fail } = require('./http');
const { parseRange } = require('./range');

const FOLDERS = ['avatars', 'icons', 'emojis', 'images', 'videos', 'audio', 'files', 'tmp'];

function filesNode(root) {
  for (const folder of FOLDERS) fs.mkdirSync(path.join(root, folder), { recursive: true });

  // Only "folder/name" paths inside the root, so a stored path can never reach elsewhere on the disk.
  const abs = (rel) => {
    if (typeof rel !== 'string' || !/^[a-z]+\/[\w.-]+$/.test(rel) || rel.includes('..')) throw new Error(`Bad file path: ${rel}`);
    return path.join(root, rel);
  };

  return {
    async write(rel, buffer) {
      await fs.promises.writeFile(abs(rel), buffer);
    },

    async append(rel, offset, buffer) {
      const file = abs(rel);
      const handle = await fs.promises.open(file, 'r+');
      try {
        await handle.truncate(offset);
        await handle.write(buffer, 0, buffer.length, offset);
      } finally {
        await handle.close();
      }
      return offset + buffer.length;
    },

    async rename(from, to) {
      await fs.promises.rename(abs(from), abs(to));
    },

    remove(rels) {
      for (const rel of rels) fs.rmSync(abs(rel), { force: true });
    },

    async send(req, res, rel, headers) {
      let stat;
      try {
        stat = await fs.promises.stat(abs(rel));
      } catch {
        fail(404, 'File not found.');
      }
      const range = parseRange(req.headers.range, stat.size);
      if (range === 'invalid') {
        res.set({ 'Content-Range': `bytes */${stat.size}` });
        fail(416, 'That range is outside the file.');
      }
      const [start, end] = range || [0, stat.size - 1];
      res.status(range ? 206 : 200).set({
        ...headers,
        'Accept-Ranges': 'bytes',
        'Content-Length': String(stat.size ? end - start + 1 : 0),
        ...(range ? { 'Content-Range': `bytes ${start}-${end}/${stat.size}` } : {}),
      });
      if (req.method === 'HEAD' || !stat.size) return res.end();
      await new Promise((resolve) => {
        const stream = fs.createReadStream(abs(rel), { start, end });
        stream.on('error', () => { res.destroy(); resolve(); });
        stream.on('end', resolve);
        stream.pipe(res);
      });
      return undefined;
    },
  };
}

module.exports = { filesNode };
