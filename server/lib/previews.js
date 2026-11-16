// Link previews. After a message is sent, the server fetches each link (up to 3) and stores a small card:
// title, description, site name, image, colour. YouTube links become playable videos.
//
// Fetching URLs that users choose is risky, so every request:
//  - only goes to http/https on the default ports,
//  - refuses any address that resolves to this PC or a private network (checked on the actual connection,
//    so DNS tricks can't swap the address after the check),
//  - follows at most 3 redirects (each one checked again), gives up after 5 seconds, reads at most 512 KB.
// Preview images are loaded through /media/preview-image, so viewers' IP addresses aren't sent to other sites.
const db = require('../db');
const platform = require('../platform');

const MAX_LINKS = 3;
const MAX_HTML = 512 * 1024;
const MAX_IMAGE = 8 * 1024 * 1024;
const CACHE_MS = 24 * 60 * 60 * 1000;

// The guarded GET itself is the platform's (server/lib/fetchNode.js on a computer, worker/fetch.js on Cloudflare).
const get = (url, options) => platform.get('fetchUrl')(url, options);

// --- reading a page ---

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decode(text) {
  return text.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (whole, code) => {
    if (code[0] === '#') return String.fromCodePoint(code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1)));
    return ENTITIES[code.toLowerCase()] ?? whole;
  }).replace(/\s+/g, ' ').trim();
}

function metaTags(html) {
  const out = {};
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const key = /(?:property|name|itemprop)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase();
    const value = /content\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1];
    if (key && value != null && !(key in out)) out[key] = decode(value);
  }
  return out;
}

function youtubeId(url) {
  const u = new URL(url);
  if (u.hostname === 'youtu.be') return u.pathname.slice(1).split('/')[0];
  if (/(^|\.)youtube\.com$/.test(u.hostname)) {
    if (u.pathname === '/watch') return u.searchParams.get('v');
    const m = /^\/(shorts|embed|live)\/([\w-]{6,})/.exec(u.pathname);
    if (m) return m[2];
  }
  return null;
}

const clip = (text, max) => (text && text.length > max ? `${text.slice(0, max - 1)}…` : text) || null;

async function preview(raw) {
  const cached = db.prepare('SELECT * FROM link_cache WHERE url = ?').get(raw);
  if (cached && Date.now() - cached.fetched_at < CACHE_MS) return cached.data ? JSON.parse(cached.data) : null;

  let data = null;
  const video = (() => { try { return youtubeId(raw); } catch { return null; } })();
  if (video) {
    const res = await get(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${video}`)}`, { maxBytes: 64 * 1024 });
    let info = null;
    try { info = res && JSON.parse(res.body.toString('utf8')); } catch { /* not JSON */ }
    if (info) {
      data = {
        type: 'video', url: raw, site: 'YouTube', title: clip(info.title, 200), description: clip(info.author_name, 120),
        image: `https://i.ytimg.com/vi/${video}/hqdefault.jpg`, color: '#ff0033', youtube: video,
      };
      db.prepare('INSERT OR REPLACE INTO link_cache (url, data, fetched_at) VALUES (?, ?, ?)').run(raw, JSON.stringify(data), Date.now());
      return data;
    }
  }
  const page = await get(raw, { maxBytes: MAX_HTML });
  if (page?.type.startsWith('image/')) {
    data = { type: 'image', url: raw, image: page.url };
  } else if (page && page.type.includes('html')) {
    const html = page.body.toString('utf8');
    const meta = metaTags(html);
    const title = meta['og:title'] || meta['twitter:title'] || decode(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] || '');
    const image = meta['og:image'] || meta['og:image:url'] || meta['twitter:image'] || meta['twitter:image:src'];
    const video = youtubeId(page.url);
    if (title || meta['og:description'] || image) {
      data = {
        type: video ? 'video' : 'link',
        url: raw,
        site: clip(meta['og:site_name'] || new URL(page.url).hostname.replace(/^www\./, ''), 80),
        title: clip(title, 200),
        description: clip(meta['og:description'] || meta['twitter:description'] || meta.description, 350),
        image: image ? new URL(image, page.url).href : null,
        color: /^#[0-9a-f]{6}$/i.test(meta['theme-color'] || '') ? meta['theme-color'] : null,
        youtube: video || null,
      };
    }
  }
  db.prepare('INSERT OR REPLACE INTO link_cache (url, data, fetched_at) VALUES (?, ?, ?)').run(raw, data ? JSON.stringify(data) : null, Date.now());
  return data;
}

// Links in a message, skipping <wrapped> ones (no preview wanted) and anything inside code.
function linksIn(content) {
  const text = content.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`\n]*`/g, ' ');
  const out = [];
  for (const m of text.matchAll(/(<)?(https?:\/\/[^\s<>]+)/gi)) {
    if (m[1]) continue;
    const url = m[2].replace(/[.,!?;:)\]'"]+$/, '');
    // Links to an Opencord message show as a quote in the app, not as a web preview.
    if (/\/channels\/[^?\s]+\?m=[\w-]+$/.test(url)) continue;
    if (!out.includes(url)) out.push(url);
    if (out.length >= MAX_LINKS) break;
  }
  return out;
}

async function forContent(content) {
  const results = await Promise.all(linksIn(content).map((url) => preview(url).catch(() => null)));
  return results.filter(Boolean);
}

// The image proxy only serves images that a stored preview points at.
async function image(raw) {
  const known = db.prepare("SELECT 1 FROM link_cache WHERE json_extract(data, '$.image') = ?").get(raw);
  if (!known) return null;
  const res = await get(raw, { maxBytes: MAX_IMAGE });
  if (!res || !/^image\/(png|jpe?g|gif|webp|avif)$/.test(res.type)) return null;
  return res;
}

module.exports = { forContent, linksIn, image, preview, youtubeId, get };
