const path = require('node:path');

const root = path.join(__dirname, '..');

try {
  process.loadEnvFile(path.join(root, '.env'));
} catch (err) {
  if (err.code !== 'ENOENT') throw err;
}

const dataDir = path.resolve(root, process.env.DATA_DIR || 'data');
const uploadsDir = path.join(dataDir, 'uploads');

module.exports = {
  port: Number(process.env.PORT) || 3100,
  host: process.env.HOST || '127.0.0.1',
  registrationOpen: process.env.REGISTRATION !== 'closed',

  publicDir: path.join(root, 'public'),
  migrationsDir: path.join(__dirname, 'db', 'migrations'),
  dataDir,
  dbPath: path.join(dataDir, 'opencord.db'),
  uploadsDir,
  tmpDir: path.join(uploadsDir, 'tmp'),
  uploadFolders: ['avatars', 'icons', 'images', 'videos', 'audio', 'files', 'tmp'],

  sessionMs: 30 * 24 * 60 * 60 * 1000,
  chunkSize: 8 * 1024 * 1024,
  minFreeBytes: 2 * 1024 ** 3,
  maxImageBytes: 10 * 1024 * 1024,
  abandonedUploadMs: 24 * 60 * 60 * 1000,
  cleanupIntervalMs: 60 * 60 * 1000,
};
