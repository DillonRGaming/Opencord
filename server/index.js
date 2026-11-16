// Opencord on a computer: an HTTP server with the app, its page and scripts, and live connections at /live.
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const express = require('express');
const config = require('./config');

require('./node').setupNode(); // before anything that uses the database

const db = require('./db');
const stats = require('./lib/stats');
const { createApp } = require('./app');
const { startJobs } = require('./jobs');
const realtime = require('./realtime');

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

const indexHtml = () => fs.readFileSync(path.join(config.publicDir, 'index.html'), 'utf8')
  .replace(/(["(])\/(js|css)\//g, `$1/v/${buildId()}/$2/`);

// The page and its scripts and styles (on Cloudflare these are static assets instead).
function pages(app) {
  app.use('/v/:build', express.static(config.publicDir, {
    index: false,
    setHeaders: (res) => res.set('Cache-Control', 'public, max-age=31536000, immutable'),
  }));
  app.use(express.static(config.publicDir, { index: false, setHeaders: (res) => res.set('Cache-Control', 'no-cache') }));
  // Everything else is a page inside the single-page app (/channels/…, /invite/…).
  app.use((req, res, next) => {
    if (!['GET', 'HEAD'].includes(req.method) || path.extname(req.path)) return next();
    res.set({ 'Cache-Control': 'no-store', 'Content-Type': 'text/html; charset=utf-8' });
    res.send(indexHtml());
  });
}

const app = createApp({ pages });
app.set('trust proxy', 'loopback'); // cloudflared connects from localhost

const server = http.createServer(app);
realtime.init();
require('./lib/liveNode').attach(server, realtime.live());
startJobs();

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
