// Finds the main colour of a picture, mostly from its edges: a photo with sky at the top gives the
// sky, a logo on a background gives the background. Returns '#rrggbb', or null if it can't be read.
const SIZE = 48;
const EDGE = 5;

export async function edgeColor(src) {
  const img = new Image();
  img.decoding = 'async';
  img.src = src;
  try {
    await img.decode();
  } catch {
    return null;
  }
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  // Cover-fit, as avatars are shown.
  const scale = SIZE / Math.min(img.naturalWidth || SIZE, img.naturalHeight || SIZE);
  const w = (img.naturalWidth || SIZE) * scale;
  const hgt = (img.naturalHeight || SIZE) * scale;
  ctx.drawImage(img, (SIZE - w) / 2, (SIZE - hgt) / 2, w, hgt);
  let data;
  try {
    data = ctx.getImageData(0, 0, SIZE, SIZE).data;
  } catch {
    return null;
  }
  const atEdge = (x, y) => x < EDGE || y < EDGE || x >= SIZE - EDGE || y >= SIZE - EDGE;
  return commonest(data, atEdge) || commonest(data, () => true);
}

// Groups pixels into coarse colour buckets, then averages the biggest bucket.
function commonest(data, keep) {
  const buckets = new Map();
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (!keep(x, y)) continue;
      const i = (y * SIZE + x) * 4;
      if (data[i + 3] < 128) continue;
      const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
      const key = (r >> 5) << 6 | (g >> 5) << 3 | (b >> 5);
      const bucket = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0 };
      bucket.n++; bucket.r += r; bucket.g += g; bucket.b += b;
      buckets.set(key, bucket);
    }
  }
  let best = null;
  for (const bucket of buckets.values()) if (!best || bucket.n > best.n) best = bucket;
  if (!best) return null;
  const hex = (v) => Math.round(v / best.n).toString(16).padStart(2, '0');
  return `#${hex(best.r)}${hex(best.g)}${hex(best.b)}`;
}
