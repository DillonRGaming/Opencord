const crypto = require('node:crypto');
const { promisify } = require('node:util');
const config = require('../config');
const sessions = require('../models/sessions');
const { fail } = require('./http');

const scrypt = promisify(crypto.scrypt);
const COOKIE = 'oc_session';

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

async function verifyPassword(password, stored) {
  const [scheme, salt, key] = stored.split('$');
  if (scheme !== 'scrypt') return false;
  const expected = Buffer.from(key, 'base64');
  const actual = await scrypt(password, Buffer.from(salt, 'base64'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function readToken(cookieHeader) {
  for (const part of (cookieHeader || '').split(';')) {
    const [name, value] = part.trim().split('=');
    if (name === COOKIE && value) return value;
  }
  return null;
}

function cookieOptions(req) {
  return { httpOnly: true, sameSite: 'lax', secure: req.secure, path: '/' };
}

function startSession(req, res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  sessions.create(hashToken(token), userId, Date.now() + config.sessionMs);
  res.cookie(COOKIE, token, { ...cookieOptions(req), maxAge: config.sessionMs });
}

function endSession(req, res) {
  sessions.remove(req.sessionHash);
  res.clearCookie(COOKIE, cookieOptions(req));
}

// Used by both express and socket.io: returns { user, sessionHash } or null.
function authenticate(cookieHeader) {
  const token = readToken(cookieHeader);
  if (!token) return null;
  const sessionHash = hashToken(token);
  const user = sessions.findUser(sessionHash);
  return user ? { user, sessionHash } : null;
}

function requireAuth(req, res, next) {
  const session = authenticate(req.headers.cookie);
  if (!session) fail(401, 'You are not logged in.');
  req.user = session.user;
  req.sessionHash = session.sessionHash;
  next();
}

// Blocks cross-site form posts: a state-changing request must come from our own origin.
function sameOrigin(req, res, next) {
  const origin = req.headers.origin;
  if (origin && !['GET', 'HEAD'].includes(req.method)) {
    let host = null;
    try {
      host = new URL(origin).host;
    } catch {
      // "null" or junk: falls through to the 403
    }
    if (host !== req.headers.host) fail(403, 'Request came from another site.');
  }
  next();
}

module.exports = { hashPassword, verifyPassword, startSession, endSession, authenticate, requireAuth, sameOrigin };
