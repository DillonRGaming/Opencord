// Background jobs both platforms run: tidying up expired sessions and abandoned uploads.
const config = require('./config');
const platform = require('./platform');
const db = require('./db');
const storage = require('./lib/storage');
const sessions = require('./models/sessions');
const attachments = require('./models/attachments');
const hq = require('./lib/hq');

// Deletes expired sessions and uploads that were never finished or never sent.
function cleanup() {
  const cutoff = Date.now() - config.abandonedUploadMs;
  sessions.removeExpired();
  attachments.removePendingBefore(cutoff).forEach(storage.removeTmp);
  storage.remove(...attachments.removeUnsentBefore(cutoff));
}

function startJobs() {
  cleanup();
  hq.start();
  hq.refresh();
  const { sweepMusicListeners } = require('./routes/apps');
  platform.get('every')(15 * 1000, sweepMusicListeners, {
    needed: () => Boolean(db.prepare('SELECT 1 FROM music_state WHERE item_id IS NOT NULL AND paused_at IS NULL LIMIT 1').get()),
  });
  platform.get('every')(config.cleanupIntervalMs, cleanup);
}

module.exports = { startJobs, cleanup };
