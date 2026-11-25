// Push notifications to the Android app through Firebase Cloud Messaging (free, no card on the account).
// They wake a phone whose app is closed: calls ring full screen, DMs and mentions show a notification.
// Needs the FCM_SERVICE_ACCOUNT secret (the Firebase service account's JSON); without it this does nothing.
const db = require('../db');

const MAX_TOKENS_PER_USER = 10;
let account = null;
try { account = process.env.FCM_SERVICE_ACCOUNT ? JSON.parse(process.env.FCM_SERVICE_ACCOUNT) : null; } catch { account = null; }

const enabled = () => Boolean(account?.private_key && account?.client_email && account?.project_id);

function register(userId, sessionHash, token) {
  db.prepare('INSERT INTO push_tokens (token, user_id, session_hash, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(token) DO UPDATE SET user_id = excluded.user_id, session_hash = excluded.session_hash')
    .run(token, userId, sessionHash, Date.now());
  // Old installs beyond the newest few are dropped.
  db.prepare('DELETE FROM push_tokens WHERE user_id = ? AND token NOT IN (SELECT token FROM push_tokens WHERE user_id = ? ORDER BY created_at DESC LIMIT ?)')
    .run(userId, userId, MAX_TOKENS_PER_USER);
}

const forgetSession = (sessionHash) => db.prepare('DELETE FROM push_tokens WHERE session_hash = ?').run(sessionHash);
const forget = (token) => db.prepare('DELETE FROM push_tokens WHERE token = ?').run(token);
const tokensOf = (userId) => db.prepare('SELECT token FROM push_tokens WHERE user_id = ?').all(userId).map((r) => r.token);

// --- Google sign-in for the server: a signed JWT swapped for an hour-long access token ---

let access = { token: null, until: 0 };
const b64url = (data) => Buffer.from(data).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

async function accessToken() {
  if (access.token && Date.now() < access.until) return access.token;
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({
    iss: account.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  }));
  const pem = account.private_key.replace(/-----[^-]+-----|\s/g, '');
  const key = await crypto.subtle.importKey('pkcs8', Buffer.from(pem, 'base64'), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, Buffer.from(`${header}.${claims}`));
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${header}.${claims}.${b64url(signature)}` }),
  });
  if (!res.ok) throw new Error(`Google sign-in failed (${res.status})`);
  const json = await res.json();
  access = { token: json.access_token, until: Date.now() + (json.expires_in - 120) * 1000 };
  return access.token;
}

// `data` is a flat object of strings that the app reads (type, title, body, channelId…). Data-only messages
// always reach the app's own code, which draws the notification or the ringing screen.
async function sendTo(token, data, { ttlSeconds }) {
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`, {
    method: 'POST',
    headers: { authorization: `Bearer ${await accessToken()}`, 'content-type': 'application/json' },
    body: JSON.stringify({ message: { token, data, android: { priority: 'high', ttl: `${ttlSeconds}s` } } }),
  });
  // An uninstalled app or a dead token: stop sending to it.
  if (res.status === 404 || res.status === 400) {
    const body = await res.text();
    if (/UNREGISTERED|INVALID_ARGUMENT/.test(body)) forget(token);
  }
}

function send(userId, data, { ttlSeconds = 3600 } = {}) {
  if (!enabled()) return;
  const strings = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v ?? '').slice(0, 500)]));
  for (const token of tokensOf(userId)) {
    sendTo(token, strings, { ttlSeconds }).catch((err) => console.error('Push failed:', err.message));
  }
}

module.exports = { enabled, register, forget, forgetSession, send };
