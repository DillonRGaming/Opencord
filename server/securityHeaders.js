// Headers every response gets, from the API and (on Cloudflare, via dist/_headers) the static files alike.
// https: for images, fonts and styles is only there so a user's own custom CSS can pull in backgrounds and fonts.
const CSP = [
  "default-src 'self'", "img-src 'self' data: blob: https:", "media-src 'self' blob:",
  "style-src 'self' 'unsafe-inline' https:", "font-src 'self' data: https:", "script-src 'self'",
  "connect-src 'self'", "frame-src https://www.youtube-nocookie.com", "object-src 'none'", "base-uri 'none'", "frame-ancestors 'none'",
].join('; ');

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin', // other sites see only "orbital.monster"; YouTube embeds need that
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': CSP,
  'Strict-Transport-Security': 'max-age=31536000',
  'Permissions-Policy': 'camera=(self), microphone=(self), display-capture=(self), geolocation=(self), payment=()',
};

module.exports = { SECURITY_HEADERS };
