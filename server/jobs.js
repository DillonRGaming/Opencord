// Background jobs both platforms run: tidying up expired sessions and abandoned uploads.
const config = require('./config');
const platform = require('./platform');
const storage = require('./lib/storage');
const sessions = require('./models/sessions');
const attachments = require('./models/attachments');

// Deletes expired sessions and uploads that were never finished or never sent.
function cleanup() {
  const cutoff = Date.now() - config.abandonedUploadMs;
  sessions.removeExpired();
  attachments.removePendingBefore(cutoff).forEach(storage.removeTmp);
  storage.remove(...attachments.removeUnsentBefore(cutoff));
}

function startJobs() {
  cleanup();
  platform.get('every')(config.cleanupIntervalMs, cleanup);
}

module.exports = { startJobs, cleanup };
