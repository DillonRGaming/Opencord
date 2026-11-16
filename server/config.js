const path = require('node:path');

// On Cloudflare there's no folder or .env file; only the numbers below matter there.
const root = typeof __dirname === 'string' ? path.join(__dirname, '..') : '/';

if (typeof __dirname === 'string' && typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile(path.join(root, '.env'));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

const dataDir = path.resolve(root, process.env.DATA_DIR || 'data');
const uploadsDir = path.join(dataDir, 'uploads');

module.exports = {
  port: Number(process.env.PORT) || 3100,
  host: process.env.HOST || '127.0.0.1',
  registrationOpen: process.env.REGISTRATION !== 'closed',

  publicDir: path.join(root, 'public'),
  migrationsDir: path.join(root, 'server', 'db', 'migrations'),
  dataDir,
  dbPath: path.join(dataDir, 'opencord.db'),
  uploadsDir,
  tmpDir: path.join(uploadsDir, 'tmp'),
  uploadFolders: ['avatars', 'icons', 'emojis', 'images', 'videos', 'audio', 'files', 'tmp'],

  sessionMs: 30 * 24 * 60 * 60 * 1000,
  chunkSize: 8 * 1024 * 1024,
  minFreeBytes: 2 * 1024 ** 3,
  maxImageBytes: 10 * 1024 * 1024,
  abandonedUploadMs: 24 * 60 * 60 * 1000,
  cleanupIntervalMs: 60 * 60 * 1000,
};
