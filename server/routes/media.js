const express = require('express');
const path = require('node:path');
const config = require('../config');
const { fail } = require('../lib/http');
const channels = require('../models/channels');
const messages = require('../models/messages');
const attachments = require('../models/attachments');
const emojis = require('../models/emojis');
const previews = require('../lib/previews');

const router = express.Router();
const IMAGE_FILE = /^[\w-]+\.(png|jpg|gif|webp)$/;
const CACHE = 'private, max-age=31536000, immutable'; // file names never get reused

function canSee(attachment, userId) {
  if (!attachment.message_id) return attachment.uploader_id === userId;
  const channel = channels.get(messages.get(attachment.message_id).channel_id);
  if (channels.canAccess(userId, channel)) return true;
  // Or a copy of the message in a linked channel they can see.
  return messages.copiesOf(attachment.message_id).some((copy) => channels.canAccess(userId, channels.get(copy.channel_id)));
}

// express.sendFile handles Range requests, which video and audio seeking needs.
router.get('/attachments/:id/:name', (req, res) => {
  const attachment = attachments.get(req.params.id);
  if (!attachment || !canSee(attachment, req.user.id)) fail(404, 'File not found.');

  if (attachment.kind === 'file') {
    res.attachment(attachment.name);
    res.type('application/octet-stream');
  } else {
    res.type(attachment.mime);
  }
  res.set('Cache-Control', CACHE);
  res.sendFile(attachment.path, { root: config.uploadsDir, cacheControl: false });
});

function imageFolder(folder) {
  return (req, res) => {
    if (!IMAGE_FILE.test(req.params.file)) fail(404, 'File not found.');
    res.set('Cache-Control', CACHE);
    res.sendFile(req.params.file, { root: path.join(config.uploadsDir, folder), cacheControl: false });
  };
}

router.get('/avatars/:file', imageFolder('avatars'));

// Link preview images, fetched by the server so viewers' addresses aren't sent to other sites.
router.get('/preview-image', async (req, res) => {
  const url = typeof req.query.url === 'string' ? req.query.url : '';
  const image = url && await previews.image(url);
  if (!image) fail(404, 'Image not found.');
  res.set({ 'Content-Type': image.type, 'Cache-Control': 'private, max-age=86400', 'Content-Security-Policy': "default-src 'none'" });
  res.send(image.body);
});

// Pictures from the few sites Opencord's extras use (GIF previews, Emoji Kitchen, YouTube thumbnails), fetched by
// the server so viewers' addresses aren't sent to those sites.
const REMOTE_HOSTS = new Set(['media.tenor.com', 'media1.tenor.com', 'www.gstatic.com', 'i.ytimg.com']);
const remoteCache = new Map(); // url → { type, body } (a few hundred small images)
router.get('/remote', async (req, res) => {
  const url = typeof req.query.url === 'string' ? req.query.url : '';
  let host = '';
  try { host = new URL(url).hostname; } catch { /* not a URL */ }
  if (!REMOTE_HOSTS.has(host) || !url.startsWith('https://')) fail(404, 'Image not found.');
  let image = remoteCache.get(url);
  if (!image) {
    const got = await previews.get(url, { maxBytes: 12 * 1024 * 1024 });
    if (!got || !/^image\/(png|jpe?g|gif|webp)$/.test(got.type)) fail(404, 'Image not found.');
    image = { type: got.type, body: got.body };
    if (image.body.length < 2 * 1024 * 1024) {
      if (remoteCache.size >= 400) remoteCache.delete(remoteCache.keys().next().value);
      remoteCache.set(url, image);
    }
  }
  res.set({ 'Content-Type': image.type, 'Cache-Control': 'private, max-age=604800', 'Content-Security-Policy': "default-src 'none'" });
  res.send(image.body);
});

// Custom emoji are addressed by id, so a message keeps working after the emoji is renamed.
router.get('/emojis/:id', (req, res) => {
  const emoji = emojis.get(req.params.id);
  if (!emoji) fail(404, 'Emoji not found.');
  res.set('Cache-Control', 'private, max-age=86400');
  res.sendFile(emoji.file, { root: path.join(config.uploadsDir, 'emojis'), cacheControl: false });
});
router.get('/icons/:file', imageFolder('icons'));

module.exports = router;
