// The web app both platforms serve: security headers, the API, stored media, and JSON errors.
// On a computer server/index.js adds the page and its scripts; on Cloudflare those are static assets.
const express = require('express');
const routes = require('./routes');
const stats = require('./lib/stats');
const limits = require('./lib/limits');
const db = require('./db');
const { HttpError } = require('./lib/http');
const { SECURITY_HEADERS } = require('./securityHeaders');

// `pages(app)` adds whatever serves the page itself (only on a computer).
function createApp({ pages } = {}) {
  limits.useDatabase(db);
  const app = express();
  app.disable('x-powered-by');

  app.use((req, res, next) => {
    res.set(SECURITY_HEADERS);
    next();
  });

  app.use(['/api', '/media'], stats.countRequest);
  app.use('/api', routes.api);
  app.use('/media', routes.media);
  pages?.(app);

  app.use((req, res) => res.status(404).json({ error: 'Not found.' }));

  // Errors become { error } JSON. Only our own HttpErrors show their message; anything else is a bug, so it's
  // logged and the person sees a plain "something went wrong".
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    const status = err.status || err.statusCode || 500;
    let message = err.message;
    if (!(err instanceof HttpError)) {
      if (status >= 500) console.error(err);
      message = { 404: 'Not found.', 413: 'That is too large.' }[status]
        || (status < 500 ? 'Bad request.' : 'Something went wrong on the server.');
    }
    return res.status(status).json({ error: message, ...err.extra });
  });
  return app;
}

module.exports = { createApp };
