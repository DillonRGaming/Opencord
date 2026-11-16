const crypto = require('node:crypto');
const { promisify } = require('node:util');
const config = require('../config');
const sessions = require('../models/sessions');
const { fail } = require('./http');
const stats = require('./stats');

const scrypt = promisify(crypto.scrypt);
const COOKIE = 'oc_session';
const ACCOUNTS = 'oc_accounts'; // the other accounts logged in on this browser: their session tokens, dot-separated
const MAX_ACCOUNTS = 10;

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

function readCookie(cookieHeader, wanted) {
  for (const part of (cookieHeader || '').split(';')) {
    const [name, value] = part.trim().split('=');
    if (name === wanted && value) return value;
  }
  return null;
}

const readToken = (cookieHeader) => readCookie(cookieHeader, COOKIE);

function cookieOptions(req) {
  return { httpOnly: true, sameSite: 'lax', secure: req.secure, path: '/' };
}

// --- several accounts on one browser ---
// The open account's token is in oc_session; the others wait in oc_accounts. Switching swaps them, and the
// app reloads, so nothing from one account is ever shown to another.

function otherTokens(req) {
  return (readCookie(req.headers.cookie, ACCOUNTS) || '').split('.').filter((t) => /^[\w-]{20,100}$/.test(t));
}

function setOtherTokens(req, res, tokens) {
  const unique = [...new Set(tokens)].slice(0, MAX_ACCOUNTS);
  if (unique.length) res.cookie(ACCOUNTS, unique.join('.'), { ...cookieOptions(req), maxAge: config.sessionMs });
  else res.clearCookie(ACCOUNTS, cookieOptions(req));
}

const userOfToken = (token) => sessions.findUser(hashToken(token));

// Every account logged in here: [{ token, user, current }], dropping ones whose session ended.
function accountsOf(req, res) {
  const current = readToken(req.headers.cookie);
  const others = otherTokens(req).filter((t) => t !== current);
  const alive = others.filter((t) => userOfToken(t));
  if (alive.length !== others.length) setOtherTokens(req, res, alive);
  const list = alive.map((token) => ({ token, user: userOfToken(token), current: false }));
  if (current && userOfToken(current)) list.unshift({ token: current, user: userOfToken(current), current: true });
  return list;
}

// `add`: keep the account that's open now (it moves to oc_accounts) instead of replacing it.
function startSession(req, res, userId, { add = false } = {}) {
  const token = crypto.randomBytes(32).toString('base64url');
  sessions.create(hashToken(token), userId, Date.now() + config.sessionMs);
  const current = readToken(req.headers.cookie);
  if (add && current && userOfToken(current)) {
    // Logging into an account that's already here just switches to it.
    const others = otherTokens(req).filter((t) => t !== current && userOfToken(t)?.id !== userId);
    setOtherTokens(req, res, [current, ...others]);
  }
  res.cookie(COOKIE, token, { ...cookieOptions(req), maxAge: config.sessionMs });
}

function switchTo(req, res, userId) {
  const current = readToken(req.headers.cookie);
  const others = otherTokens(req);
  const target = others.find((t) => userOfToken(t)?.id === userId);
  if (!target) return false;
  setOtherTokens(req, res, [current, ...others.filter((t) => t !== target)].filter(Boolean));
  res.cookie(COOKIE, target, { ...cookieOptions(req), maxAge: config.sessionMs });
  return true;
}

// Takes another account off this browser (and ends its session there).
function removeAccount(req, res, userId) {
  const others = otherTokens(req);
  const target = others.find((t) => userOfToken(t)?.id === userId);
  if (!target) return false;
  sessions.remove(hashToken(target));
  setOtherTokens(req, res, others.filter((t) => t !== target));
  return true;
}

// Logging out of the open account carries on with the next one, if there is one. Returns whether it did.
function endSession(req, res) {
  sessions.remove(req.sessionHash);
  const next = otherTokens(req).find((t) => userOfToken(t));
  if (next) {
    setOtherTokens(req, res, otherTokens(req).filter((t) => t !== next));
    res.cookie(COOKIE, next, { ...cookieOptions(req), maxAge: config.sessionMs });
    return true;
  }
  res.clearCookie(COOKIE, cookieOptions(req));
  return false;
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
  if (!session.user.is_bot) stats.recordActivity(session.user.id);
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

module.exports = { hashPassword, verifyPassword, startSession, endSession, authenticate, requireAuth, sameOrigin, accountsOf, switchTo, removeAccount };
