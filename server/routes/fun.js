// Free extras that need another site, all without API keys: GIF search (Tenor's own search pages), Emoji
// Kitchen mixes (Google's sticker images, looked up in a table built from the public list), YouTube search for
// video channels (YouTube's own results page) and song lyrics (lrclib.net). The server does the fetching, so
// the people using Opencord never talk to those sites directly, and answers are kept for a while.
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { fail, text } = require('../lib/http');
const previews = require('../lib/previews');

const router = express.Router();
const BROWSER = { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36' };

// A small time-limited cache per kind of answer.
function cached(ttlMs, max = 500) {
  const map = new Map();
  return async (key, load) => {
    const hit = map.get(key);
    if (hit && Date.now() - hit.at < ttlMs) return hit.value;
    const value = await load();
    if (map.size >= max) map.delete(map.keys().next().value);
    map.set(key, { at: Date.now(), value });
    return value;
  };
}

// --- GIFs (Tenor) ---

const gifCache = cached(30 * 60 * 1000);
const slug = (q) => q.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 60);

async function gifs(query) {
  const url = query ? `https://tenor.com/search/${encodeURIComponent(slug(query))}-gifs` : 'https://tenor.com/';
  const page = await previews.get(url, { maxBytes: 4 * 1024 * 1024, headers: BROWSER, timeout: 8000 });
  if (!page) throw Object.assign(new Error('GIFs are not available right now.'), { status: 502 });
  const html = page.body.toString('utf8');
  const seen = new Set();
  const out = [];
  // Tenor names each size with a 4-letter code after the 12-letter id: AAAM is a small preview, AAAC the full GIF.
  for (const m of html.matchAll(/https:\/\/media1?\.tenor\.com\/(?:m\/)?([\w-]{12})AAA[A-Z]\/([\w%-]+)\.gif/g)) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    out.push({ id: m[1], title: decodeURIComponent(m[2]).replace(/-/g, ' '), preview: `https://media.tenor.com/${m[1]}AAAM/${m[2]}.gif`, url: `https://media.tenor.com/${m[1]}AAAC/${m[2]}.gif` });
    if (out.length >= 48) break;
  }
  return out;
}

router.get('/gifs', async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 80) : '';
  res.json(await gifCache(q.toLowerCase(), () => gifs(q)));
});

// --- Emoji Kitchen ---

let kitchen = null; // { emoji: [codepoint…], byEmoji: Map(code → Map(other → url)) }
function loadKitchen() {
  if (kitchen) return kitchen;
  const raw = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(__dirname, '../assets/kitchen.json.gz'))).toString('utf8'));
  const byEmoji = new Map();
  const part = (code) => code.split('-').map((c) => `u${c}`).join('-');
  for (const line of raw.pairs.split('\n')) {
    const [left, right, d] = line.split(' ');
    const url = `https://www.gstatic.com/android/keyboard/emojikitchen/${raw.dates[d]}/${part(left)}/${part(left)}_${part(right)}.png`;
    for (const [a, b] of [[left, right], [right, left]]) {
      if (!byEmoji.has(a)) byEmoji.set(a, new Map());
      byEmoji.get(a).set(b, url);
    }
  }
  kitchen = { emoji: raw.emoji.filter((code) => byEmoji.has(code)), byEmoji };
  return kitchen;
}

const toCode = (emoji) => [...emoji].map((c) => c.codePointAt(0).toString(16)).join('-');
const fromCode = (code) => String.fromCodePoint(...code.split('-').map((c) => parseInt(c, 16)));
// The table leaves out the FE0F variation mark on some emoji and keeps it on others; try both.
function findCode(emoji) {
  const { byEmoji } = loadKitchen();
  const code = toCode(emoji);
  if (byEmoji.has(code)) return code;
  const bare = code.split('-').filter((c) => c !== 'fe0f').join('-');
  if (byEmoji.has(bare)) return bare;
  if (byEmoji.has(`${bare}-fe0f`)) return `${bare}-fe0f`;
  return null;
}

// Every emoji that can be mixed.
router.get('/kitchen', (req, res) => {
  res.set('Cache-Control', 'private, max-age=86400');
  res.json(loadKitchen().emoji.map(fromCode));
});

// Everything one emoji mixes with: [{ emoji, url }].
router.get('/kitchen/:emoji', (req, res) => {
  const code = findCode(text(req.params.emoji, 'Emoji', { min: 1, max: 40 }));
  if (!code) fail(404, 'That emoji can’t be mixed.');
  res.set('Cache-Control', 'private, max-age=86400');
  res.json([...loadKitchen().byEmoji.get(code)].map(([other, url]) => ({ emoji: fromCode(other), url })));
});

// --- YouTube search, for video channels ---

const ytCache = cached(20 * 60 * 1000);
const runs = (t) => t?.simpleText ?? t?.runs?.map((r) => r.text).join('') ?? '';

function videosIn(node, out = []) {
  if (!node || typeof node !== 'object' || out.length >= 40) return out;
  if (node.videoRenderer?.videoId) {
    const v = node.videoRenderer;
    out.push({
      id: v.videoId, title: runs(v.title), author: runs(v.ownerText || v.longBylineText), length: runs(v.lengthText),
      views: runs(v.shortViewCountText || v.viewCountText), published: runs(v.publishedTimeText),
    });
    return out;
  }
  for (const value of Array.isArray(node) ? node : Object.values(node)) videosIn(value, out);
  return out;
}

async function youtube(query) {
  // sp=EgIQAQ== keeps the results to videos (no channels, playlists or shorts shelves).
  const page = await previews.get(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=EgIQAQ%253D%253D&hl=en`, {
    maxBytes: 6 * 1024 * 1024, headers: { ...BROWSER, Cookie: 'CONSENT=YES+1' }, timeout: 10000,
  });
  if (!page) throw Object.assign(new Error('YouTube is not answering right now.'), { status: 502 });
  const html = page.body.toString('utf8');
  const m = /var ytInitialData = (\{[\s\S]*?\});<\/script>/.exec(html);
  if (!m) return [];
  try {
    const seen = new Set();
    return videosIn(JSON.parse(m[1])).filter((v) => !seen.has(v.id) && seen.add(v.id) && v.length);
  } catch {
    return [];
  }
}

router.get('/youtube', async (req, res) => {
  const q = text(req.query.q, 'Search', { min: 1, max: 120 }).trim();
  res.json(await ytCache(q.toLowerCase(), () => youtube(q)));
});

// --- lyrics (lrclib.net) ---

const lyricsCache = cached(6 * 60 * 60 * 1000);

// "Artist - Song (Official Video) [HD]" → "Artist Song": the noise in video titles throws searches off.
function cleanTitle(title) {
  return title
    .replace(/\[[^\]]*\]|\((?:[^)]*(?:official|video|audio|lyric|visuali[sz]er|hd|4k|remaster|live|mv|m\/v)[^)]*)\)/gi, ' ')
    .replace(/\b(official (music )?video|official audio|lyrics?( video)?|music video|hd|4k)\b/gi, ' ')
    .replace(/\s*[|•]\s*.*$/, '')
    .replace(/["“”]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Ways to search for a video title, from closest to loosest: the cleaned title, then without anything in
// brackets, then "artist / song" split on dashes (tried both ways round, since titles use either order).
function lyricQueries(title) {
  const clean = cleanTitle(title);
  const bare = title.replace(/\([^)]*\)|\[[^\]]*\]|"[^"]*"|“[^”]*”/g, ' ').replace(/\s+/g, ' ').trim();
  const parts = bare.split(/\s+(?:-{1,2}|—|–|\||•|:)\s+/).map((p) => cleanTitle(p)).filter(Boolean);
  const out = [clean, cleanTitle(bare)];
  if (parts.length >= 2) out.push({ artist: parts[0], track: parts[1] }, { artist: parts[1], track: parts[0] }, parts[0], parts[1]);
  const seen = new Set();
  return out.filter((q) => {
    const key = JSON.stringify(q);
    if (!q || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function lrclib(query) {
  const params = typeof query === 'string' ? `q=${encodeURIComponent(query)}` : `track_name=${encodeURIComponent(query.track)}&artist_name=${encodeURIComponent(query.artist)}`;
  const res = await previews.get(`https://lrclib.net/api/search?${params}`, {
    maxBytes: 4 * 1024 * 1024, headers: { 'User-Agent': 'Opencord (self-hosted chat)', Accept: 'application/json' }, timeout: 8000,
  });
  if (!res) throw Object.assign(new Error('Lyrics are not available right now.'), { status: 502 });
  try {
    const list = JSON.parse(res.body.toString('utf8'));
    return (Array.isArray(list) ? list : []).filter((l) => l.plainLyrics || l.syncedLyrics || l.instrumental);
  } catch {
    return [];
  }
}

async function lyrics(title, duration) {
  let list = [];
  for (const query of lyricQueries(title)) {
    list = await lrclib(query);
    if (list.length) break;
  }
  if (!list.length) return null;
  // Prefer synced lyrics, and a length close to the track's when we know it.
  const score = (l) => (l.syncedLyrics ? 0 : 30) + (duration ? Math.min(60, Math.abs((l.duration || 0) - duration)) : 0);
  const best = list.sort((a, b) => score(a) - score(b))[0];
  return {
    track: best.trackName, artist: best.artistName, instrumental: Boolean(best.instrumental),
    plain: best.plainLyrics || '', synced: best.syncedLyrics || '',
  };
}

router.get('/lyrics', async (req, res) => {
  const title = text(req.query.title, 'Title', { min: 1, max: 300 });
  const duration = Math.max(0, Number(req.query.duration) || 0);
  res.json(await lyricsCache(`${title}|${Math.round(duration / 5)}`, () => lyrics(title, duration)));
});

module.exports = router;
