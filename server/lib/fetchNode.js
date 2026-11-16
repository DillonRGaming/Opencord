// Fetching a URL for a user on a computer, with every guard: http(s) on normal ports only, never a private
// or local address (checked on the real connection, so DNS tricks can't swap it after the check), at most
// 3 redirects (each checked again), a time limit and a size limit.
const http = require('node:http');
const https = require('node:https');
const dns = require('node:dns');
const { blockedAddress, allowedUrl, USER_AGENT, TIMEOUT_MS } = require('./urlSafety');

// Used as the socket's DNS lookup, so the address we check is the address we connect to.
function safeLookup(hostname, options, callback) {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err);
    const safe = addresses.filter((a) => !blockedAddress(a.address));
    if (!safe.length || safe.length !== addresses.length) {
      return callback(Object.assign(new Error('Blocked address'), { code: 'EBLOCKED' }));
    }
    if (options.all) return callback(null, safe);
    callback(null, safe[0].address, safe[0].family);
  });
}

// GET (or POST, with `method` and `body`) a URL with all the limits above. Resolves { url, type, body, status }
// or null. Only a 200 counts unless `anyStatus` is set (then error replies come back too, to show their message).
function fetchUrl(raw, { maxBytes, redirects = 3, headers = {}, timeout = TIMEOUT_MS, method = 'GET', body = null, anyStatus = false } = {}) {
  const url = allowedUrl(raw);
  if (!url) return Promise.resolve(null);
  return new Promise((resolve) => {
    const lib = url.protocol === 'https:' ? https : http;
    const payload = body == null ? null : Buffer.from(body);
    const req = lib.request(url, {
      method, lookup: safeLookup, timeout,
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,image/*;q=0.9,*/*;q=0.5', 'Accept-Language': 'en', ...(payload ? { 'Content-Length': payload.length } : {}), ...headers },
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0 && method === 'GET') {
        res.resume();
        resolve(fetchUrl(new URL(res.headers.location, url).href, { maxBytes, redirects: redirects - 1, headers, timeout, anyStatus }));
        return;
      }
      if (res.statusCode !== 200 && !anyStatus) { res.resume(); resolve(null); return; }
      const type = String(res.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > maxBytes) {
          // For HTML, what we have is enough (the <head> is at the top); images must be complete.
          if (type.startsWith('image/')) { req.destroy(); resolve(null); return; }
          req.destroy();
          resolve({ url: url.href, type, status: res.statusCode, body: Buffer.concat(chunks) });
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => resolve({ url: url.href, type, status: res.statusCode, body: Buffer.concat(chunks) }));
      res.on('error', () => resolve(null));
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
    req.end(payload);
  });
}


module.exports = { fetchUrl };
