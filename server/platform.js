// What differs between running on a computer and on Cloudflare. Filled in once at start-up, before any other
// server module loads: by server/node.js on a computer, and by worker/hub.js on Cloudflare.
//
//   db         better-sqlite3-style database: prepare(sql).get/all/run, exec(sql), transaction(fn)
//   files      file store, see server/lib/storage.js for what it must do
//   fetchUrl   (url, { maxBytes, headers, timeout, redirects }) → { url, type, body: Buffer } | null,
//              refusing private and local addresses
//   asset      (name) → Buffer, for files in server/assets
//   every      (ms, fn, { needed }) → runs fn every ms; needed() false means "nothing to do, don't wake up"
//   dataBytes  () → bytes Opencord stores (database + files)
//   freeBytes  async () → bytes still free where files are kept
const platform = {};

const NAMES = ['db', 'files', 'fetchUrl', 'asset', 'every', 'dataBytes', 'freeBytes'];

function setup(parts) {
  for (const name of NAMES) {
    if (!parts[name]) throw new Error(`platform.${name} is missing`);
    platform[name] = parts[name];
  }
}

function get(name) {
  if (!platform[name]) throw new Error(`platform.${name} used before start-up set it`);
  return platform[name];
}

module.exports = { setup, get };
