// A small stand-in for Express on Cloudflare, with exactly the parts Opencord's routes use: Router, use/get/
// post/put/patch/delete with :params, json() and raw() body parsers, error middleware, and the res methods
// below. wrangler.jsonc points `require('express')` here, so server/routes run unchanged.
//
// app.handle(request, { ip }) turns a fetch Request into req/res, runs the middleware, and resolves a Response.
const STATUS_TEXT = {
  200: 'OK', 201: 'Created', 204: 'No Content', 206: 'Partial Content', 304: 'Not Modified', 400: 'Bad Request',
  401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 409: 'Conflict', 413: 'Payload Too Large',
  416: 'Range Not Satisfiable', 429: 'Too Many Requests', 500: 'Internal Server Error',
};

class HttpStatusError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// --- paths ---

// '/:id/members/@me' → a case-insensitive regex with named params. `end` false matches a prefix (for use()).
function compile(path, end) {
  const keys = [];
  const pattern = path === '/' ? '' : path.replace(/\/$/, '').replace(/[.*+?^${}()|[\]\\]/g, (c) => (c === ':' ? c : `\\${c}`))
    .replace(/:(\w+)/g, (_, key) => { keys.push(key); return '([^/]+?)'; });
  const regex = new RegExp(`^${pattern}${end ? '/?$' : '(?=/|$)'}`, 'i');
  return { regex, keys };
}

function decode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new HttpStatusError(400, 'Bad request.');
  }
}

// --- response ---

class Response_ {
  constructor(method) {
    this.method = method;
    this.statusCode = 200;
    this.headers = new Headers();
    this.cookies = [];
    this.body = null;
    this.headersSent = false;
    this.locals = {};
    this.finished = new Promise((resolve) => { this.resolve = resolve; });
  }

  status(code) {
    this.statusCode = code;
    return this;
  }

  set(name, value) {
    if (typeof name === 'object') {
      for (const [k, v] of Object.entries(name)) if (v !== undefined) this.headers.set(k, String(v));
    } else if (value !== undefined) {
      this.headers.set(name, String(value));
    }
    return this;
  }

  get(name) {
    return this.headers.get(name);
  }

  type(type) {
    return this.set('Content-Type', type);
  }

  attachment(name) {
    return this.set('Content-Disposition', `attachment; filename="${String(name).replace(/[^\x20-\x7e]|["\\]/g, '_')}"`);
  }

  cookie(name, value, { httpOnly, sameSite, secure, path = '/', maxAge, expires } = {}) {
    const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${path}`];
    if (maxAge != null) {
      parts.push(`Max-Age=${Math.floor(maxAge / 1000)}`);
      parts.push(`Expires=${new Date(Date.now() + maxAge).toUTCString()}`);
    } else if (expires) {
      parts.push(`Expires=${expires.toUTCString()}`);
    }
    if (httpOnly) parts.push('HttpOnly');
    if (secure) parts.push('Secure');
    if (sameSite) parts.push(`SameSite=${sameSite[0].toUpperCase()}${sameSite.slice(1)}`);
    this.cookies.push(parts.join('; '));
    return this;
  }

  clearCookie(name, options = {}) {
    return this.cookie(name, '', { ...options, maxAge: undefined, expires: new Date(0) });
  }

  json(value) {
    if (!this.headers.has('Content-Type')) this.set('Content-Type', 'application/json; charset=utf-8');
    return this.end(JSON.stringify(value));
  }

  send(body) {
    if (body !== null && typeof body === 'object' && !(body instanceof Uint8Array) && !(body instanceof ArrayBuffer)
      && !(body instanceof ReadableStream)) return this.json(body);
    if (!this.headers.has('Content-Type')) {
      this.set('Content-Type', typeof body === 'string' ? 'text/html; charset=utf-8' : 'application/octet-stream');
    }
    return this.end(body);
  }

  sendStatus(code) {
    this.status(code);
    if (code === 204 || code === 304) return this.end();
    this.set('Content-Type', 'text/plain; charset=utf-8');
    return this.end(STATUS_TEXT[code] || String(code));
  }

  end(body = null) {
    if (this.headersSent) return this;
    this.body = body;
    this.headersSent = true;
    this.resolve();
    return this;
  }

  toResponse() {
    const headers = new Headers(this.headers);
    for (const cookie of this.cookies) headers.append('Set-Cookie', cookie);
    const empty = this.method === 'HEAD' || [101, 204, 205, 304].includes(this.statusCode);
    return new Response(empty ? null : this.body, { status: this.statusCode, headers });
  }
}

// --- body parsers ---

function typeMatches(req, type) {
  const contentType = (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  return typeof type === 'function' ? type(req) : contentType === type;
}

async function readBody(req, limit) {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > limit) throw new HttpStatusError(413, 'That is too large.');
  if (!req.raw.body) return new Uint8Array(0);
  const reader = req.raw.body.getReader();
  const parts = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      reader.cancel().catch(() => {});
      throw new HttpStatusError(413, 'That is too large.');
    }
    parts.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.byteLength; }
  return out;
}

const parseLimit = (limit) => {
  if (typeof limit === 'number') return limit;
  const m = /^(\d+)\s*(kb|mb)?$/i.exec(String(limit || '100kb'));
  return Number(m[1]) * (m[2]?.toLowerCase() === 'mb' ? 1024 * 1024 : m[2] ? 1024 : 1);
};

function json({ limit } = {}) {
  const max = parseLimit(limit);
  return async (req, res, next) => {
    if (req.bodyRead || !['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) || !typeMatches(req, 'application/json')) return next();
    req.bodyRead = true;
    const text = new TextDecoder().decode(await readBody(req, max));
    if (!text) { req.body = {}; return next(); }
    try {
      req.body = JSON.parse(text);
    } catch {
      throw new HttpStatusError(400, 'Bad request.');
    }
    return next();
  };
}

function raw({ type, limit } = {}) {
  const max = parseLimit(limit);
  return async (req, res, next) => {
    if (req.bodyRead || !typeMatches(req, type || 'application/octet-stream')) return next();
    req.bodyRead = true;
    req.body = Buffer.from(await readBody(req, max));
    return next();
  };
}

// --- routing ---

const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

function createRouter() {
  const stack = [];

  function router(req, res, next) {
    return router.handle(req, res, next);
  }

  router.use = (...args) => {
    const paths = typeof args[0] === 'string' || Array.isArray(args[0]) ? [].concat(args.shift()) : ['/'];
    for (const path of paths) for (const fn of args) stack.push({ method: null, ...compile(path, false), fn, prefix: true });
    return router;
  };

  for (const method of METHODS) {
    router[method] = (path, ...fns) => {
      for (const fn of fns) stack.push({ method: method.toUpperCase(), ...compile(path, true), fn, prefix: false });
      return router;
    };
  }

  // Runs the stack for req, then calls done(err) if nothing answered.
  router.handle = (req, res, done) => {
    let index = 0;
    const basePath = req.path;

    const next = (err) => {
      req.path = basePath;
      if (res.headersSent && !err) return;
      while (index < stack.length) {
        const layer = stack[index++];
        if (layer.method && layer.method !== req.method && !(layer.method === 'GET' && req.method === 'HEAD')) continue;
        const match = layer.regex.exec(basePath);
        if (!match) continue;
        const isErrorHandler = layer.fn.length === 4;
        if (Boolean(err) !== isErrorHandler) continue;
        let params;
        try {
          params = Object.fromEntries(layer.keys.map((key, i) => [key, decode(match[i + 1])]));
        } catch (e) {
          err = e;
          continue;
        }
        if (!layer.prefix) req.params = params;
        if (layer.prefix) req.path = basePath.slice(match[0].length) || '/';
        call(layer.fn, err, req, res, next);
        return;
      }
      done(err);
    };
    next();
  };

  return router;
}

// Calls a middleware; a thrown error or rejected promise goes on to the error handlers.
function call(fn, err, req, res, next) {
  let nextCalled = false;
  const onceNext = (e) => {
    if (nextCalled) return;
    nextCalled = true;
    next(e);
  };
  try {
    const result = err ? fn(err, req, res, onceNext) : fn(req, res, onceNext);
    if (result && typeof result.then === 'function') result.then(undefined, (e) => fail(e));
  } catch (e) {
    fail(e);
  }
  function fail(e) {
    if (nextCalled) console.error('Error after next() was called:', e);
    else onceNext(e);
  }
}

function express() {
  const app = createRouter();
  app.routerHandle = app.handle;
  app.disable = () => app;
  app.set = () => app;

  // Answers a fetch Request with a Response. `ip` is the visitor's address (from Cloudflare's header).
  app.handle = async function handleRequest(request, { ip } = {}) {
    const url = new URL(request.url);
    const req = {
      raw: request,
      method: request.method,
      url: url.pathname + url.search,
      originalUrl: url.pathname + url.search,
      path: url.pathname,
      headers: Object.fromEntries([...request.headers].map(([k, v]) => [k.toLowerCase(), v])),
      query: {},
      params: {},
      body: undefined,
      ip: ip || '0.0.0.0',
      secure: url.protocol === 'https:',
      protocol: url.protocol.replace(':', ''),
    };
    for (const [k, v] of url.searchParams) {
      if (k in req.query) req.query[k] = [].concat(req.query[k], v);
      else req.query[k] = v;
    }
    const res = new Response_(request.method);
    app.handle.run(req, res);
    await res.finished;
    return res.toResponse();
  };
  app.handle.run = (req, res) => run(app, req, res);
  return app;
}

// Runs the app's stack, ending in a plain 404 / 500 if nothing answered (server/app.js normally does).
function run(app, req, res) {
  const done = (err) => {
    if (res.headersSent) {
      if (err) console.error('Error after the response was sent:', err);
      return;
    }
    if (err) {
      if (!err.status || err.status >= 500) console.error(err);
      res.status(err.status || 500).json({ error: err.status && err.status < 500 ? err.message : 'Something went wrong on the server.' });
    } else {
      res.status(404).json({ error: 'Not found.' });
    }
  };
  app.routerHandle(req, res, done);
}

express.Router = createRouter;
express.json = json;
express.raw = raw;
express.HttpStatusError = HttpStatusError;

module.exports = express;
