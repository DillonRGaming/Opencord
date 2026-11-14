// Translating messages. The server asks Google Translate's public endpoint (no key needed) and remembers the
// answers, so the same text is only sent once. Only the text being translated leaves this server.
const express = require('express');
const { fail } = require('../lib/http');
const previews = require('../lib/previews');

const router = express.Router();
const cache = new Map(); // "from|to|text" → { text, detected }
const CACHE_MAX = 5000;
const LANG = /^(auto|[a-z]{2,3}(-[A-Za-z]{2,4})?)$/;
const perUser = new Map(); // userId → recent request times

async function translateOne(text, from, to) {
  const key = `${from}|${to}|${text}`;
  if (cache.has(key)) return cache.get(key);
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&dt=t&sl=${encodeURIComponent(from)}&tl=${encodeURIComponent(to)}&q=${encodeURIComponent(text)}`;
  const res = await previews.get(url, { maxBytes: 512 * 1024 });
  if (!res) throw new Error('Translation is not available right now.');
  let data;
  try { data = JSON.parse(res.body.toString('utf8')); } catch { throw new Error('Translation is not available right now.'); }
  const out = { text: (data?.[0] || []).map((part) => part?.[0] || '').join(''), detected: data?.[2] || from };
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, out);
  return out;
}

// { texts: ["…", …], from: "auto" | "es" …, to: "en" … } → [{ text, detected }, …]
router.post('/', async (req, res) => {
  const { texts, from = 'auto', to } = req.body;
  if (!Array.isArray(texts) || !texts.length || texts.length > 25 || texts.some((t) => typeof t !== 'string' || t.length > 3000)) {
    fail(400, 'Send 1 to 25 texts of up to 3000 characters.');
  }
  if (!LANG.test(from) || !LANG.test(String(to)) || to === 'auto') fail(400, 'Pick the languages to translate between.');
  const now = Date.now();
  const recent = (perUser.get(req.user.id) || []).filter((t) => now - t < 60_000);
  if (recent.length >= 60) fail(429, 'Too many translations at once. Wait a moment.');
  recent.push(now);
  perUser.set(req.user.id, recent);
  const results = [];
  // A few at a time, so a page full of messages doesn't fire 25 requests at once.
  for (let i = 0; i < texts.length; i += 5) {
    results.push(...await Promise.all(texts.slice(i, i + 5).map((t) => (t.trim() ? translateOne(t, from, to) : { text: t, detected: from }))));
  }
  res.json(results);
});

module.exports = router;
