// Patterns drawn over a profile banner. Each is a small SVG tile, repeated. The ids match
// BANNER_PATTERNS in server/models/users.js.
export const PATTERNS = [
  ['dots', 'Dots', { w: 16, h: 16, body: '<circle cx="8" cy="8" r="2.2" fill="C"/>' }],
  ['lines', 'Lines', { w: 12, h: 12, body: '<path d="M-3 3l6-6M0 12L12 0M9 15l6-6" stroke="C" stroke-width="2.5"/>' }],
  ['chainlink', 'Chain link', { w: 14, h: 14, body: '<path d="M0 0l14 14M14 0L0 14" stroke="C" stroke-width="1.3"/>' }],
  ['checks', 'Checker', { w: 20, h: 20, body: '<path d="M0 0h10v10H0zM10 10h10v10H10z" fill="C"/>' }],
  ['waves', 'Waves', { w: 32, h: 14, body: '<path d="M0 7q8-7 16 0t16 0" fill="none" stroke="C" stroke-width="2"/>' }],
  ['zigzag', 'Zigzag', { w: 20, h: 14, body: '<path d="M0 10l10-7 10 7" fill="none" stroke="C" stroke-width="2.2"/>' }],
  ['plus', 'Plus', { w: 22, h: 22, body: '<path d="M11 6v10M6 11h10" stroke="C" stroke-width="2.4" stroke-linecap="round"/>' }],
];

const BY_ID = new Map(PATTERNS.map(([id, , tile]) => [id, tile]));

// Light banners get a soft dark pattern, dark ones a soft light pattern.
function autoColor(background) {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(background || '');
  if (!m) return ['#ffffff', 0.12];
  const [r, g, b] = m.slice(1).map((v) => parseInt(v, 16));
  return (0.299 * r + 0.587 * g + 0.114 * b) > 140 ? ['#000000', 0.16] : ['#ffffff', 0.16];
}

// CSS background-image for a pattern, or null for none.
export function patternImage(id, color, background) {
  const tile = BY_ID.get(id);
  if (!tile) return null;
  const [fill, opacity] = color ? [color, 1] : autoColor(background);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${tile.w}" height="${tile.h}" opacity="${opacity}">${tile.body.replaceAll('"C"', `"${fill}"`)}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

// Inline style for a banner element.
export function bannerStyle({ bannerColor, bannerPattern, bannerPatternColor }) {
  const style = {};
  if (bannerColor) style.backgroundColor = bannerColor;
  const image = patternImage(bannerPattern, bannerPatternColor, bannerColor);
  if (image) style.backgroundImage = image;
  return style;
}
