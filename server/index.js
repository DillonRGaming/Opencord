const http = require('node:http');
const path = require('node:path');
const express = require('express');
const config = require('./config');
const db = require('./db');
const storage = require('./lib/storage');
const { HttpError } = require('./lib/http');
const sessions = require('./models/sessions');
const attachments = require('./models/attachments');
const routes = require('./routes');
const realtime = require('./realtime');

// https: for images, fonts and styles is only there so a user's own custom CSS can pull in backgrounds and fonts.
const CSP = [
  "default-src 'self'", "img-src 'self' data: blob: https:", "media-src 'self' blob:",
  "style-src 'self' 'unsafe-inline' https:", "font-src 'self' data: https:", "script-src 'self'",
  "connect-src 'self'", "object-src 'none'", "base-uri 'none'", "frame-ancestors 'none'",
].join('; ');

storage.ensureFolders();

const app = express();
app.set('trust proxy', 'loopback'); // cloudflared connects from localhost
app.disable('x-powered-by');

app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': CSP,
  });
  next();
});

app.use('/api', routes.api);
app.use('/media', routes.media);
app.use(express.static(config.publicDir, { index: false, setHeaders: (res) => res.set('Cache-Control', 'no-cache') }));

// Everything else is a page inside the single-page app (/channels/…, /invite/…).
app.use((req, res, next) => {
  if (req.method !== 'GET' || path.extname(req.path)) return next();
  res.set('Cache-Control', 'no-cache');
  res.sendFile('index.html', { root: config.publicDir });
});

app.use((req, res) => res.status(404).json({ error: 'Not found.' }));

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = err.status || err.statusCode || 500;
  let message = err.message;
  if (!(err instanceof HttpError)) {
    if (status >= 500) console.error(err);
    message = { 404: 'Not found.', 413: 'That is too large.' }[status]
      || (status < 500 ? 'Bad request.' : 'Something went wrong on the server.');
  }
  res.status(status).json({ error: message, ...err.extra });
});

// Deletes expired sessions and uploads that were never finished or never sent.
function cleanup() {
  const cutoff = Date.now() - config.abandonedUploadMs;
  sessions.removeExpired();
  attachments.removePendingBefore(cutoff).forEach(storage.removeTmp);
  storage.remove(...attachments.removeUnsentBefore(cutoff));
}

const server = http.createServer(app);
realtime.init(server);
cleanup();
setInterval(cleanup, config.cleanupIntervalMs).unref();

server.listen(config.port, config.host, () => {
  console.log(`Opencord is running at http://${config.host}:${config.port}`);
});

function shutdown() {
  console.log('Shutting down…');
  realtime.close().finally(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
