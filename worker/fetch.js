// Fetching a URL for a user on Cloudflare (link previews, bot web requests, GIFs, lyrics, translation).
// The same rules as on a computer: public http(s) sites on normal ports only, at most 3 redirects (each
// checked again), a time limit, and a size limit. Requests leave from Cloudflare, never from anyone's home.
import { allowedUrl, USER_AGENT, TIMEOUT_MS } from '../server/lib/urlSafety.js';

// `method`/`body` send a POST; `anyStatus` returns error replies too (with `status`) instead of null.
export async function fetchUrl(raw, { maxBytes, redirects = 3, headers = {}, timeout = TIMEOUT_MS, method = 'GET', body = null, anyStatus = false } = {}) {
  let url = allowedUrl(raw);
  for (let hop = 0; url && hop <= redirects; hop++) {
    let res;
    try {
      res = await fetch(url.href, {
        method,
        body,
        redirect: 'manual',
        signal: AbortSignal.timeout(timeout),
        headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,image/*;q=0.9,*/*;q=0.5', 'Accept-Language': 'en', ...headers },
      });
    } catch {
      return null;
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get('location') && method === 'GET') {
      res.body?.cancel();
      url = allowedUrl(new URL(res.headers.get('location'), url).href);
      continue;
    }
    if ((res.status !== 200 && !anyStatus) || !res.body) {
      res.body?.cancel();
      return null;
    }
    const type = String(res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const parts = [];
    let size = 0;
    const reader = res.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) {
          reader.cancel().catch(() => {});
          // For a page, the start is enough (the <head> is at the top); a picture must be whole.
          if (type.startsWith('image/')) return null;
          break;
        }
        parts.push(value);
      }
    } catch {
      return null;
    }
    return { url: url.href, type, status: res.status, body: Buffer.concat(parts.map((p) => Buffer.from(p))) };
  }
  return null;
}
