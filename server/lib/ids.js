const crypto = require('node:crypto');

const INVITE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

// Time-sortable: sorting ids as strings sorts by creation time.
function newId() {
  return Date.now().toString(36).padStart(9, '0') + crypto.randomBytes(6).toString('base64url');
}

function inviteCode() {
  let code = '';
  for (let i = 0; i < 8; i++) code += INVITE_ALPHABET[crypto.randomInt(INVITE_ALPHABET.length)];
  return code;
}

module.exports = { newId, inviteCode };
