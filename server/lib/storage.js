// Uploaded files: attachments, avatars, server icons and banners, custom emoji. Paths are like
// "images/<id>.png"; where the bytes actually live is the platform's business (server/platform.js):
// a folder on a computer, Durable Objects on Cloudflare.
//
// platform files must provide:
//   write(path, buffer)                 create or replace a file
//   append(path, offset, buffer)        cut the file at offset, add buffer, return the new size
//   rename(from, to)                    move a finished upload into place
//   remove(paths)                       delete files (missing ones are fine)
//   send(req, res, path, headers)       answer with the file, honouring Range requests; 404 if it's gone
const platform = require('../platform');
const { newId } = require('./ids');
const { fail } = require('./http');

const KINDS = {
  image: ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'image/bmp'],
  video: ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime'],
  audio: ['audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/webm', 'audio/mp4', 'audio/aac', 'audio/flac', 'audio/x-m4a'],
};
const KIND_FOLDERS = { image: 'images', video: 'videos', audio: 'audio', file: 'files' };

const files = () => platform.get('files');
const tmpPath = (uploadId) => `tmp/${uploadId}`;

function kindFor(mime) {
  for (const [kind, mimes] of Object.entries(KINDS)) if (mimes.includes(mime)) return kind;
  return 'file';
}

function extFor(name) {
  const match = /\.([a-z0-9]{1,10})$/i.exec(name);
  return match ? match[1].toLowerCase() : 'bin';
}

function remove(...paths) {
  const real = paths.filter(Boolean);
  if (real.length) files().remove(real);
}

function freeBytes() {
  return platform.get('freeBytes')();
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

// Saves an image into a folder ("avatars", "icons", "emojis") and returns its file name.
async function saveImage(folder, buffer) {
  const ext = imageExt(buffer);
  if (!ext) fail(400, 'That file is not a PNG, JPEG, GIF or WebP image.');
  const file = `${newId()}.${ext}`;
  await files().write(`${folder}/${file}`, buffer);
  return file;
}

function createTmp(uploadId) {
  return files().write(tmpPath(uploadId), Buffer.alloc(0));
}

function removeTmp(uploadId) {
  files().remove([tmpPath(uploadId)]);
}

// Adds one piece of an upload at `offset`. Returns the upload's size afterwards.
function appendChunk(uploadId, offset, buffer) {
  return files().append(tmpPath(uploadId), offset, buffer);
}

// Moves a finished upload out of tmp/ into its folder and returns its path.
async function finishUpload(uploadId, kind, name) {
  const path = `${KIND_FOLDERS[kind]}/${uploadId}.${extFor(name)}`;
  await files().rename(tmpPath(uploadId), path);
  return path;
}

// Answers a request with a stored file (Range requests work, for seeking in video and audio).
function send(req, res, path, headers) {
  return files().send(req, res, path, headers);
}

module.exports = {
  kindFor, remove, freeBytes, saveImage, createTmp, removeTmp, appendChunk, finishUpload, send,
};
