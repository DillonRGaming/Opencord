const express = require('express');
const path = require('node:path');
const config = require('../config');
const { fail } = require('../lib/http');
const channels = require('../models/channels');
const messages = require('../models/messages');
const attachments = require('../models/attachments');

const router = express.Router();
const IMAGE_FILE = /^[\w-]+\.(png|jpg|gif|webp)$/;
const CACHE = 'private, max-age=31536000, immutable'; // file names never get reused

function canSee(attachment, userId) {
  if (!attachment.message_id) return attachment.uploader_id === userId;
  const channel = channels.get(messages.get(attachment.message_id).channel_id);
  return channels.canAccess(userId, channel);
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
router.get('/icons/:file', imageFolder('icons'));

module.exports = router;
