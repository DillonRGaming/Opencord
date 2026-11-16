// Which URLs the server may fetch for users (link previews, bot web requests, GIFs…): only public http(s)
// sites on the normal ports. Shared by the fetchers for both platforms.
const isIPv4 = (s) => /^(\d{1,3})(\.\d{1,3}){3}$/.test(s) && s.split('.').every((n) => Number(n) <= 255);
const isIPv6 = (s) => s.includes(':') && /^[0-9a-f:.]+$/i.test(s);

function privateV4(ip) {
  const [a, b] = ip.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19));
}

// A private, local or reserved address (this computer, the home network, link-local, multicast…).
function blockedAddress(ip) {
  if (isIPv4(ip)) return privateV4(ip);
  const lower = ip.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (mapped) return privateV4(mapped[1]);
  return lower === '::' || lower === '::1' || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe8')
    || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb') || lower.startsWith('ff');
}

// The URL if it may be fetched, otherwise null.
function allowedUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { return null; }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
  if (url.port && !['80', '443'].includes(url.port)) return null;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if ((isIPv4(host) || isIPv6(host)) && blockedAddress(host)) return null;
  if (/^(localhost|.*\.local|.*\.internal|.*\.localhost|.*\.home\.arpa)$/i.test(host)) return null;
  return url;
}

const USER_AGENT = 'Mozilla/5.0 (compatible; OpencordBot/1.0; link previews)';
const TIMEOUT_MS = 5000;

module.exports = { blockedAddress, allowedUrl, USER_AGENT, TIMEOUT_MS };
