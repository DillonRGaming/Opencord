const express = require('express');
const limits = require('../lib/limits');
const config = require('../config');
const storage = require('../lib/storage');
const { newId } = require('../lib/ids');
const { fail, text } = require('../lib/http');
const attachments = require('../models/attachments');

const router = express.Router();
const inFlight = new Set(); // upload ids with a chunk being written right now
const MIME = /^[\w.+-]+\/[\w.+-]+$/;

// The upload limits (sizes in lib/limits.js): one file, one person's total, and everyone's total.
function checkUploadLimits(userId, size) {
  limits.within('fileBytes', 0, size, `Files can be up to ${formatBytes(limits.size('fileBytes'))}.`);
  const mine = attachments.bytesBy(userId);
  limits.within('userUploadBytes', mine, size,
    `You have used ${formatBytes(mine)} of your ${formatBytes(limits.size('userUploadBytes'))} upload space. Delete some old files first.`);
  limits.within('totalUploadBytes', attachments.totalBytes(), size, 'Opencord is out of upload space right now.');
  limits.within('pendingUploads', attachments.pendingCount(userId), 1, 'Finish or cancel your other uploads first.');
}

const formatBytes = (n) => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : `${Math.round(n / 1024 ** 2)} MB`);

// The disk itself must keep 2 GB free too (while Opencord runs on a computer).
async function requireSpace(bytes) {
  const free = await storage.freeBytes();
  if (free - attachments.pendingBytes() - bytes < config.minFreeBytes) {
    fail(413, 'The server is almost out of disk space, so this upload was refused.');
  }
}

function pendingUpload(req) {
  const upload = attachments.getPending(req.params.id, req.user.id);
  if (!upload) fail(404, 'Upload not found.');
  return upload;
}

async function finish(upload) {
  const kind = storage.kindFor(upload.mime);
  const path = await storage.finishUpload(upload.id, kind, upload.name);
  attachments.removePending(upload.id);
  const row = attachments.create({
    id: upload.id, uploaderId: upload.user_id, kind, name: upload.name, mime: upload.mime, size: upload.size, path,
  });
  return attachments.toAttachment(row);
}

router.post('/', async (req, res) => {
  const name = text(req.body.name, 'File name', { min: 1, max: 255 });
  const size = req.body.size;
  if (!Number.isSafeInteger(size) || size < 0) fail(400, 'File size is missing.');
  const type = String(req.body.type || '').toLowerCase();
  const mime = MIME.test(type) && type.length <= 100 ? type : 'application/octet-stream';
  checkUploadLimits(req.user.id, size);
  limits.take('uploadsStarted', req.user.id);
  await requireSpace(size);

  const upload = { id: newId(), user_id: req.user.id, name, mime, size };
  await storage.createTmp(upload.id);
  if (size === 0) return res.status(201).json({ attachment: await finish(upload) });

  attachments.createPending({ id: upload.id, userId: req.user.id, name, mime, size });
  res.status(201).json({ id: upload.id, chunkSize: config.chunkSize, received: 0 });
});

// One piece of an upload, as the raw request body (at most chunkSize bytes; bigger is refused with 413).
const rawChunk = express.raw({ type: () => true, limit: config.chunkSize });

router.put('/:id', rawChunk, async (req, res) => {
  const upload = pendingUpload(req);
  const offset = Number(req.query.offset);
  if (inFlight.has(upload.id) || offset !== upload.received) {
    fail(409, 'That chunk is out of order.', { received: upload.received });
  }
  const chunk = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  if (!chunk.length) fail(400, 'The chunk was empty.');
  if (offset + chunk.length > upload.size) fail(413, 'That chunk goes past the end of the file.');

  inFlight.add(upload.id);
  try {
    await requireSpace(chunk.length);
    const received = await storage.appendChunk(upload.id, offset, chunk);
    attachments.setReceived(upload.id, received);
    res.json(received === upload.size ? { received, attachment: await finish(upload) } : { received });
  } finally {
    inFlight.delete(upload.id);
  }
});

router.get('/:id', (req, res) => {
  const upload = pendingUpload(req);
  res.json({ received: upload.received, size: upload.size });
});

router.delete('/:id', (req, res) => {
  const upload = pendingUpload(req);
  if (inFlight.has(upload.id)) fail(409, 'That upload is busy. Try again in a moment.');
  attachments.removePending(upload.id);
  storage.removeTmp(upload.id);
  res.sendStatus(204);
});

module.exports = router;
