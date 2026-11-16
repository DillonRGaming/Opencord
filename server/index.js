const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const express = require('express');
const config = require('./config');
const db = require('./db');
const storage = require('./lib/storage');
const { HttpError } = require('./lib/http');
const sessions = require('./models/sessions');
const attachments = require('./models/attachments');
const routes = require('./routes');
const realtime = require('./realtime');
const stats = require('./lib/stats');

// https: for images, fonts and styles is only there so a user's own custom CSS can pull in backgrounds and fonts.
const CSP = [
  "default-src 'self'", "img-src 'self' data: blob: https:", "media-src 'self' blob:",
  "style-src 'self' 'unsafe-inline' https:", "font-src 'self' data: https:", "script-src 'self'",
  "connect-src 'self'", "frame-src https://www.youtube-nocookie.com", "object-src 'none'", "base-uri 'none'", "frame-ancestors 'none'",
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

app.use(['/api', '/media'], stats.countRequest);
app.use('/api', routes.api);
app.use('/media', routes.media);
// Scripts and styles are served under /v/<build>/…, where <build> changes whenever any file in public/
// changes, so phones and Cloudflare (which keeps static files for hours whatever we say) always fetch the
// new code. Relative imports inside the modules inherit the prefix.
let build = { id: '', checked: 0 };
function buildId() {
  if (Date.now() - build.checked < 2000) return build.id;
  let newest = 0;
  for (const entry of fs.readdirSync(config.publicDir, { recursive: true, withFileTypes: true })) {
    if (entry.isFile()) newest = Math.max(newest, fs.statSync(path.join(entry.parentPath, entry.name)).mtimeMs);
  }
  build = { id: Math.floor(newest).toString(36), checked: Date.now() };
  return build.id;
}
app.use('/v/:build', express.static(config.publicDir, {
  index: false,
  setHeaders: (res) => res.set('Cache-Control', 'public, max-age=31536000, immutable'),
}));
app.use(express.static(config.publicDir, { index: false, setHeaders: (res) => res.set('Cache-Control', 'no-cache') }));

const indexHtml = () => fs.readFileSync(path.join(config.publicDir, 'index.html'), 'utf8')
  .replace(/(["(])\/(js|css)\//g, `$1/v/${buildId()}/$2/`);

// Everything else is a page inside the single-page app (/channels/…, /invite/…).
app.use((req, res, next) => {
  if (!['GET', 'HEAD'].includes(req.method) || path.extname(req.path)) return next();
  res.set({ 'Cache-Control': 'no-store', 'Content-Type': 'text/html; charset=utf-8' });
  res.send(indexHtml());
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
realtime.init();
require('./lib/liveNode').attach(server, realtime.live());
cleanup();
setInterval(cleanup, config.cleanupIntervalMs).unref();

server.listen(config.port, config.host, () => {
  console.log(`Opencord is running at http://${config.host}:${config.port}`);
});

function shutdown() {
  console.log('Shutting down…');
  realtime.close().finally(() => {
    stats.flush();
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
