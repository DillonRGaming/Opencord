// The bot face maker: a background colour, a pattern over it, eyes and a mouth. Each choice is a row of small
// previews; "Use this face" draws it to a PNG and sets it as the bot's picture.
import { h } from '../dom.js';

const INK = '#141814';
const TONGUE = '#ff6b81';
// Bright, clean colours that read well behind a dark face.
// Bright ones, then softer ones (Opencord's own avatar colours among them), then pale ones.
export const FACE_COLORS = ['#4cc3ff', '#3b8bff', '#7c6cff', '#b06cff', '#ff6cc4', '#ff5a6e', '#ff8a3d', '#ffc23d',
  '#c6e04a', '#4fd67a', '#2fd4c0', '#ffb3a3',
  '#a9c79a', '#a99bf0', '#e0a07e', '#e3a3a3', '#8fc1d6', '#d6a8c8', '#c8cf9e', '#93a8ef', '#d6bb84', '#8fd1b9',
  '#9ee6ff', '#c9b8ff', '#ffc6e0', '#ffe066', '#b8f2c9', '#ffd6b0', '#f4f1ea', '#b3bcc8'];

// Patterns sit over the background in white, faintly. `id` keeps <pattern> ids apart between pictures on a page.
const pat = (id, w, hgt, inner, opacity, turn = 0) => `<defs><pattern id="p${id}" width="${w}" height="${hgt}" patternUnits="userSpaceOnUse"${turn ? ` patternTransform="rotate(${turn})"` : ''}>${inner}</pattern></defs><rect width="256" height="256" fill="url(#p${id})" opacity="${opacity}"/>`;
const W = 'fill="#fff"';
const WS = (w) => `fill="none" stroke="#fff" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"`;
const STAR = (x, y, r) => {
  const pts = [];
  for (let i = 0; i < 10; i += 1) {
    const a = (Math.PI / 5) * i - Math.PI / 2;
    const d = i % 2 ? r * 0.45 : r;
    pts.push(`${(x + Math.cos(a) * d).toFixed(1)},${(y + Math.sin(a) * d).toFixed(1)}`);
  }
  return `<polygon points="${pts.join(' ')}" ${W}/>`;
};
const HEART = (x, y, s) => `<path transform="translate(${x} ${y}) scale(${s})" d="M0 6 C-10 -4 -20 4 -12 12 L0 22 L12 12 C20 4 10 -4 0 6 Z" ${W}/>`;
const PATTERNS = {
  none: { label: 'Plain', svg: () => '' },
  dots: { label: 'Dots', svg: (id) => pat(id, 52, 52, `<circle cx="13" cy="13" r="8" ${W}/><circle cx="39" cy="39" r="8" ${W}/>`, 0.35) },
  tiny: { label: 'Sprinkles', svg: (id) => pat(id, 30, 30, `<circle cx="7" cy="7" r="3.5" ${W}/><circle cx="22" cy="20" r="3.5" ${W}/>`, 0.45) },
  stripes: { label: 'Stripes', svg: (id) => pat(id, 48, 48, `<rect width="22" height="48" ${W}/>`, 0.25, 45) },
  bars: { label: 'Bars', svg: (id) => pat(id, 64, 64, `<rect width="64" height="28" ${W}/>`, 0.2) },
  checks: { label: 'Checks', svg: (id) => pat(id, 64, 64, `<rect width="32" height="32" ${W}/><rect x="32" y="32" width="32" height="32" ${W}/>`, 0.22) },
  grid: { label: 'Grid', svg: (id) => pat(id, 40, 40, `<path d="M0 0 H40 M0 0 V40" ${WS(5)}/>`, 0.3) },
  waves: { label: 'Waves', svg: (id) => pat(id, 96, 48, `<path d="M0 24 q24 -22 48 0 t48 0" ${WS(11)}/>`, 0.32) },
  zigzag: { label: 'Zigzag', svg: (id) => pat(id, 64, 40, `<path d="M0 30 L16 10 L32 30 L48 10 L64 30" ${WS(8)}/>`, 0.3) },
  rings: { label: 'Rings', svg: (id) => pat(id, 64, 64, `<circle cx="32" cy="32" r="18" ${WS(7)}/>`, 0.3) },
  plus: { label: 'Plus', svg: (id) => pat(id, 48, 48, `<path d="M24 14 V34 M14 24 H34" ${WS(7)}/>`, 0.32) },
  stars: { label: 'Stars', svg: (id) => pat(id, 72, 72, `${STAR(18, 18, 13)}${STAR(54, 54, 13)}`, 0.38) },
  hearts: { label: 'Hearts', svg: (id) => pat(id, 72, 72, `${HEART(18, 8, 1)}${HEART(54, 44, 1)}`, 0.35) },
  confetti: {
    label: 'Confetti',
    svg: (id) => pat(id, 96, 96, `<rect x="10" y="14" width="16" height="7" rx="3" transform="rotate(30 18 17)" ${W}/><rect x="60" y="8" width="16" height="7" rx="3" transform="rotate(-20 68 11)" ${W}/><rect x="36" y="50" width="16" height="7" rx="3" transform="rotate(60 44 53)" ${W}/><rect x="72" y="70" width="16" height="7" rx="3" transform="rotate(10 80 73)" ${W}/><rect x="8" y="76" width="16" height="7" rx="3" transform="rotate(-45 16 79)" ${W}/>`, 0.4),
  },
};

const shine = (x, y) => `<circle cx="${x + 6}" cy="${y - 7}" r="5.5" fill="#fff" opacity="0.9"/>`;
const INKS = (w = 15) => `fill="none" stroke="${INK}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"`;
const pair = (one) => one(84) + one(172);
const EYES = {
  dots: { label: 'Round', svg: () => pair((x) => `<circle cx="${x}" cy="106" r="21" fill="${INK}"/>${shine(x, 106)}`) },
  small: { label: 'Small', svg: () => pair((x) => `<circle cx="${x}" cy="108" r="12" fill="${INK}"/>`) },
  tall: { label: 'Tall', svg: () => pair((x) => `<rect x="${x - 11}" y="80" width="22" height="50" rx="11" fill="${INK}"/>`) },
  big: { label: 'Big', svg: () => pair((x) => `<circle cx="${x}" cy="104" r="30" fill="#fff"/><circle cx="${x + 6}" cy="108" r="16" fill="${INK}"/>`) },
  happy: { label: 'Happy', svg: () => pair((x) => `<path d="M${x - 22} 114 q22 -32 44 0" ${INKS()}/>`) },
  sleepy: { label: 'Sleepy', svg: () => pair((x) => `<path d="M${x - 22} 102 q22 24 44 0" ${INKS()}/>`) },
  wink: { label: 'Wink', svg: () => `<circle cx="84" cy="106" r="21" fill="${INK}"/>${shine(84, 106)}<path d="M150 112 q22 -26 44 0" ${INKS()}/>` },
  cool: { label: 'Shades', svg: () => `<path d="M54 92 h150" ${INKS(10)}/><path d="M56 92 h56 v10 a24 24 0 0 1 -56 0 z M144 92 h56 v10 a24 24 0 0 1 -56 0 z" fill="${INK}"/><path d="M68 100 l12 -6" stroke="#fff" stroke-width="5" stroke-linecap="round" opacity="0.7"/>` },
  hearts: { label: 'Hearts', svg: () => pair((x) => `<path transform="translate(${x} 92) scale(1.6)" d="M0 6 C-10 -4 -20 4 -12 12 L0 22 L12 12 C20 4 10 -4 0 6 Z" fill="${TONGUE}"/>`) },
  stars: { label: 'Starry', svg: () => pair((x) => STAR(x, 106, 24).replace(W, `fill="${INK}"`)) },
  dizzy: { label: 'Dizzy', svg: () => pair((x) => `<path d="M${x - 15} 91 l30 30 M${x + 15} 91 l-30 30" ${INKS(12)}/>`) },
  angry: { label: 'Grumpy', svg: () => `<circle cx="84" cy="112" r="16" fill="${INK}"/><circle cx="172" cy="112" r="16" fill="${INK}"/><path d="M60 82 l44 14 M196 82 l-44 14" ${INKS(12)}/>` },
};

const clipMouth = (id, d, tongue) => `<defs><path id="m${id}" d="${d}"/><clipPath id="c${id}"><use href="#m${id}"/></clipPath></defs><use href="#m${id}" fill="${INK}"/>${tongue ? `<g clip-path="url(#c${id})">${tongue}</g>` : ''}`;
const MOUTHS = {
  open: {
    label: 'Laugh',
    svg: (id) => clipMouth(id, 'M76 150 h104 a10 10 0 0 1 10 10 c0 36 -28 60 -62 60 s-62 -24 -62 -60 a10 10 0 0 1 10 -10 z', `<ellipse cx="128" cy="228" rx="42" ry="34" fill="${TONGUE}"/>`),
  },
  grin: {
    label: 'Grin',
    svg: (id) => clipMouth(id, 'M76 150 h104 a10 10 0 0 1 10 10 c0 36 -28 60 -62 60 s-62 -24 -62 -60 a10 10 0 0 1 10 -10 z', `<rect x="60" y="140" width="140" height="26" fill="#fff"/>`),
  },
  smile: { label: 'Smile', svg: () => `<path d="M82 164 q46 46 92 0" ${INKS()}/>` },
  small: { label: 'Little smile', svg: () => `<path d="M106 170 q22 20 44 0" ${INKS(13)}/>` },
  smirk: { label: 'Smirk', svg: () => `<path d="M92 178 q40 10 72 -16" ${INKS()}/>` },
  cat: { label: 'Cat', svg: () => `<path d="M88 166 q20 26 40 0 q20 26 40 0" ${INKS(14)}/>` },
  flat: { label: 'Flat', svg: () => `<path d="M96 176 h64" ${INKS()}/>` },
  oh: { label: 'Oh', svg: () => `<ellipse cx="128" cy="180" rx="20" ry="25" fill="${INK}"/>` },
  wobbly: { label: 'Wobbly', svg: () => `<path d="M84 176 q11 -12 22 0 t22 0 t22 0 t22 0" ${INKS(12)}/>` },
  tongue: {
    label: 'Silly',
    svg: () => `<path d="M134 162 h28 v22 a14 14 0 0 1 -28 0 z" fill="${TONGUE}"/><path d="M84 162 h88" ${INKS()}/>`,
  },
  fangs: {
    label: 'Fangs',
    svg: () => `<path d="M82 160 q46 40 92 0 z" fill="${INK}"/><path d="M98 166 l8 16 l8 -12 z M158 166 l-8 16 l-8 -12 z" fill="#fff"/>`,
  },
  kiss: { label: 'Kiss', svg: () => `<path d="M120 160 q20 8 0 18 q20 8 0 18" ${INKS(12)}/>` },
};

// --- the lock (people's pictures): Opencord's lock with a face, open, shut or open the other way ---

// Eyes are cut into the body (drawn in the background colour).
// The real logo's outline (shackle and body, without its eye holes), the same shape as the built-in pictures.
const LOCK_OUTLINE = 'M177.5 87.7L177.3 84.1L176.8 80.8L176 77.2L175 73.7L173.7 70.3L172.1 67L170.3 63.8L168.3 60.8L166.1 57.9L163.7 55.2L161.1 52.6L158.5 50.5L155.5 48.4L152.4 46.4L149.2 44.8L145.8 43.3L142.4 42.1L138.9 41.2L135.3 40.5L131.6 40.1L128 40L124.7 40.1L121 40.5L117.4 41.1L114.2 42L110.7 43.1L107.4 44.5L104.1 46.1L101 48L98 50.1L95.2 52.4L92.5 54.9L90.3 57.4L88 60.3L86 63.3L84.3 66.2L82.7 69.5L81.4 72.6L80.3 76L79.5 79.3L78.8 83.8L78.5 88.3L78.4 120.6L73.7 122.2L69.5 124.2L66 126.6L62.9 129.3L60.4 132.4L58.4 135.7L56.9 139.5L55.7 143.9L54.9 150.5L54.5 158.8L54.6 176.9L55.2 185.7L56.3 191.5L58 196.2L60.4 200.4L63.4 204.1L65.4 205.9L67.7 207.5L70.2 209L72.9 210.3L79.3 212.6L87 214.2L94.6 215.2L104.3 215.8L115.1 216L135.8 216L149 215.8L158 215.4L166.3 214.6L173.1 213.5L179.2 211.8L184.5 209.7L189.2 206.9L192.8 203.8L195.4 200.7L197.6 197.2L199.1 193.4L200.3 189L200.9 184.7L201.3 179.2L201.5 159.9L201.3 153.7L201 148.8L200.3 144.4L199.5 140.6L198.2 137L196.6 133.9L194.6 131.1L192.4 128.6L190 126.6L187.4 124.8L184.5 123.2L181.6 121.9L178 120.7L174.5 119.7L165.7 118.2L156.5 117.4L144.7 117L116.6 116.9L102.4 117.2L102.4 88.6L102.7 85.2L103.6 81.8L104.6 79.2L105.9 76.5L107.5 74.2L109.3 72L111.4 70L113.6 68.3L116.1 66.9L118.6 65.7L121.9 64.7L125.2 64.1L128.5 63.9L131.9 64.2L135.3 65L138.4 66.1L141.4 67.7L144.3 69.7L146.6 71.9L148.5 74.2L150.2 76.8L151.6 79.6L152.6 82.3L153.2 84.9L153.9 92.2L155.1 95.3L156.3 97.1L157.8 98.6L159.5 99.9L161.4 100.8L164.5 101.5L167.6 101.4L170.5 100.5L173.1 98.8L175.2 96.6L176.7 93.9L177.5 91.1Z';
const BODY = `<path d="${LOCK_OUTLINE}" fill="${INK}"/>`;
const lockBody = () => BODY;
const lockPair = (one) => one(104) + one(152);
const cut = (c, w = 9) => `fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"`;
const LOCK_EYES = {
  ovals: { label: 'Ovals', svg: (c) => lockPair((x) => `<ellipse cx="${x}" cy="172" rx="11" ry="16" fill="${c}"/>`) },
  dots: { label: 'Dots', svg: (c) => lockPair((x) => `<circle cx="${x}" cy="172" r="9" fill="${c}"/>`) },
  keyhole: { label: 'Keyholes', svg: (c) => lockPair((x) => `<circle cx="${x}" cy="164" r="10" fill="${c}"/><path d="M${x - 6} 168 h12 l4 20 h-20 z" fill="${c}"/>`) },
  big: { label: 'Big', svg: (c) => lockPair((x) => `<circle cx="${x}" cy="172" r="15" fill="${c}"/><circle cx="${x + 4}" cy="175" r="7" fill="${INK}"/>`) },
  happy: { label: 'Happy', svg: (c) => lockPair((x) => `<path d="M${x - 12} 178 q12 -18 24 0" ${cut(c)}/>`) },
  sleepy: { label: 'Sleepy', svg: (c) => lockPair((x) => `<path d="M${x - 12} 168 q12 14 24 0" ${cut(c)}/>`) },
  wink: { label: 'Wink', svg: (c) => `<ellipse cx="104" cy="172" rx="11" ry="16" fill="${c}"/><path d="M140 178 q12 -16 24 0" ${cut(c)}/>` },
  lines: { label: 'Lines', svg: (c) => lockPair((x) => `<path d="M${x} 160 v24" ${cut(c, 10)}/>`) },
  hearts: { label: 'Hearts', svg: (c) => lockPair((x) => `<path transform="translate(${x} 160)" d="M0 6 C-10 -4 -20 4 -12 12 L0 22 L12 12 C20 4 10 -4 0 6 Z" fill="${c}"/>`) },
  stars: { label: 'Stars', svg: (c) => lockPair((x) => STAR(x, 172, 14).replace(W, `fill="${c}"`)) },
  dizzy: { label: 'Dizzy', svg: (c) => lockPair((x) => `<path d="M${x - 9} 163 l18 18 M${x + 9} 163 l-18 18" ${cut(c, 8)}/>`) },
  grumpy: { label: 'Grumpy', svg: (c) => lockPair((x) => `<circle cx="${x}" cy="176" r="9" fill="${c}"/>`) + `<path d="M90 156 l24 8 M166 156 l-24 8" ${cut(c, 7)}/>` },
};
const lockSvg = (eyes, bg) => {
  // Eyes are drawn a little higher, where the logo's own eyes sit. The shape never changes with them.
  return `${BODY}<g transform="translate(0 -4)">${LOCK_EYES[eyes].svg(bg)}</g>`;
};

let uid = 0;
const svgOf = (box, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box}">${body}</svg>`;
const TILE = '#c9cec6';

// The two makers: what they have, how a whole picture is drawn, and how each option's tile is drawn on its own.
const KINDS = {
  bot: {
    save: 'Use this face',
    file: 'bot-face.png',
    start: () => ({ color: '#4cc3ff', pattern: 'none', eyes: 'dots', mouth: 'open' }),
    parts: [['pattern', 'Pattern', PATTERNS], ['eyes', 'Eyes', EYES], ['mouth', 'Mouth', MOUTHS]],
    draw: (f, id) => `${PATTERNS[f.pattern].svg(id)}${EYES[f.eyes].svg(id)}${MOUTHS[f.mouth].svg(id)}`,
    tile: (key, value, id) => (key === 'eyes' ? svgOf('44 66 168 84', EYES[value].svg(id))
      : svgOf('52 132 152 104', MOUTHS[value].svg(id))),
  },
  lock: {
    save: 'Use this picture',
    file: 'avatar.png',
    start: () => ({ color: FACE_COLORS[12 + Math.floor(Math.random() * 10)], pattern: 'none', eyes: 'ovals' }),
    parts: [['pattern', 'Pattern', PATTERNS], ['eyes', 'Eyes', LOCK_EYES]],
    draw: (f) => lockSvg(f.eyes, f.color),
    // The pattern goes under the lock, so it's drawn first by the caller.
    tile: (key, value) => svgOf('70 140 116 64', `${lockBody()}${LOCK_EYES[value].svg(TILE)}`),
  },
};

function pictureSvg(kind, f) {
  const id = `bf${(uid += 1)}`;
  const k = KINDS[kind];
  const pattern = kind === 'lock' ? PATTERNS[f.pattern].svg(id) : '';
  return svgOf('0 0 256 256', `<rect width="256" height="256" fill="${f.color}"/>${pattern}${k.draw(f, id)}`);
}
function tileSvg(kind, key, value) {
  const id = `bf${(uid += 1)}`;
  if (key === 'pattern') return svgOf('0 0 256 256', `<rect width="256" height="256" fill="#8b938b"/>${PATTERNS[value].svg(id)}`);
  return KINDS[kind].tile(key, value, id);
}

// SVG → a 512px PNG file, so it uploads like any picture.
async function toPng(svg, name) {
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  canvas.getContext('2d').drawImage(img, 0, 0, 512, 512);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  return new File([blob], name, { type: 'image/png' });
}

const pic = (svg, size, cls = 'face-pic') => {
  const el = h('span', { class: cls, style: { width: `${size}px`, height: `${size}px` } });
  el.innerHTML = svg;
  return el;
};

// A maker: a row of tiles per part. Every pick calls `onChange({ url, file })`: `url` shows the picture straight
// away (in the profile preview), `file()` makes the PNG to upload when the profile is saved.
function maker(kind, onChange) {
  const k = KINDS[kind];
  const face = k.start();
  const rows = h('div', { class: 'face-rows' });
  const changed = () => {
    const svg = pictureSvg(kind, face);
    onChange({ url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, file: () => toPng(svg, k.file) });
  };
  function row(label, key, options) {
    return h('div', { class: 'face-row' }, h('span', { class: 'field-label' }, label),
      h('div', { class: 'face-options' }, options.map(([value, title]) => h('button', {
        type: 'button', class: 'face-option', title, 'aria-label': title, 'aria-pressed': String(face[key] === value),
        onclick: () => { face[key] = value; draw(); changed(); },
      }, key === 'color' ? h('span', { class: 'face-dot', style: { background: value } }) : pic(tileSvg(kind, key, value), 40, 'face-part')))));
  }
  function draw() {
    rows.replaceChildren(
      row('Colour', 'color', FACE_COLORS.map((c) => [c, c])),
      ...k.parts.map(([key, label, options]) => row(label, key, Object.entries(options).map(([v, o]) => [v, o.label]))));
  }
  draw();
  return h('div', { class: 'face-maker' }, rows);
}

export const botFaceMaker = (onChange) => maker('bot', onChange);
export const lockMaker = (onChange) => maker('lock', onChange);
