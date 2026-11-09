const fs = require('node:fs');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const { Transform } = require('node:stream');
const config = require('../config');
const { newId } = require('./ids');
const { fail } = require('./http');

const KINDS = {
  image: ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'image/bmp'],
  video: ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime'],
  audio: ['audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/webm', 'audio/mp4', 'audio/aac', 'audio/flac', 'audio/x-m4a'],
};
const KIND_FOLDERS = { image: 'images', video: 'videos', audio: 'audio', file: 'files' };

function ensureFolders() {
  for (const folder of config.uploadFolders) {
    fs.mkdirSync(path.join(config.uploadsDir, folder), { recursive: true });
  }
}

function kindFor(mime) {
  for (const [kind, mimes] of Object.entries(KINDS)) if (mimes.includes(mime)) return kind;
  return 'file';
}

function extFor(name) {
  const match = /\.([a-z0-9]{1,10})$/i.exec(name);
  return match ? match[1].toLowerCase() : 'bin';
}

function absolute(relPath) {
  return path.join(config.uploadsDir, relPath);
}

function tmpPath(uploadId) {
  return path.join(config.tmpDir, uploadId);
}

function remove(...relPaths) {
  for (const relPath of relPaths) if (relPath) fs.rmSync(absolute(relPath), { force: true });
}

async function freeBytes() {
  const stats = await fs.promises.statfs(config.dataDir);
  return stats.bavail * stats.bsize;
}

// Avatars and icons: the type comes from the file's first bytes, never from what the client claims.
function imageExt(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  const hex = buffer.subarray(0, 4).toString('hex');
  if (hex === '89504e47') return 'png';
  if (hex.startsWith('ffd8ff')) return 'jpg';
  if (buffer.subarray(0, 4).toString('latin1') === 'GIF8') return 'gif';
  if (buffer.subarray(0, 4).toString('latin1') === 'RIFF' && buffer.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return null;
}

function saveImage(folder, buffer) {
  const ext = imageExt(buffer);
  if (!ext) fail(400, 'That file is not a PNG, JPEG, GIF or WebP image.');
  const file = `${newId()}.${ext}`;
  fs.writeFileSync(path.join(config.uploadsDir, folder, file), buffer);
  return file;
}

function createTmp(uploadId) {
  fs.writeFileSync(tmpPath(uploadId), '');
}

function removeTmp(uploadId) {
  fs.rmSync(tmpPath(uploadId), { force: true });
}

// Streams a chunk onto the end of a tmp file and returns how many bytes arrived.
// If anything goes wrong the file is cut back to `offset` so the chunk can be retried.
async function appendChunk(uploadId, offset, stream, maxBytes) {
  const file = tmpPath(uploadId);
  let written = 0;
  const counter = new Transform({
    transform(chunk, _encoding, done) {
      written += chunk.length;
      if (written > maxBytes) done(Object.assign(new Error('Chunk is too large.'), { status: 413 }));
      else done(null, chunk);
    },
  });
  try {
    await pipeline(stream, counter, fs.createWriteStream(file, { flags: 'r+', start: offset }));
  } catch (err) {
    await fs.promises.truncate(file, offset).catch(() => {});
    if (err.status) fail(err.status, err.message);
    fail(400, 'The upload was interrupted.');
  }
  return written;
}

// Moves a finished upload out of tmp/ into its folder and returns the path relative to uploads/.
function finishUpload(uploadId, kind, name) {
  const relPath = `${KIND_FOLDERS[kind]}/${uploadId}.${extFor(name)}`;
  fs.renameSync(tmpPath(uploadId), absolute(relPath));
  return relPath;
}

module.exports = {
  ensureFolders, kindFor, absolute, remove, freeBytes, saveImage,
  createTmp, removeTmp, appendChunk, finishUpload,
};
