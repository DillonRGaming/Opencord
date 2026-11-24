// Appearance settings. They live in me.settings on the server (so they follow the account between
// devices) and are mirrored in localStorage so the page doesn't flash the wrong theme while loading.

import { setClock } from './format.js';

export const DEFAULTS = {
  theme: 'onyx',
  accent: '#ffffff',
  fontSize: 16,
  density: 'cozy',
  avatarShape: 'round',
  font: 'geist',
  lineHeight: 'normal',
  corners: 'normal',
  spacing: 'normal',
  sidebarWidth: 240,
  chatAvatars: true,
  clock: 'auto',
  contrast: 'normal',
  motion: 'full',
  customCss: '',
  railPosition: 'left',
};

export const FONTS = [
  ['geist', 'Geist', 'var(--font-geist)'],
  ['system', 'System', 'system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", sans-serif'],
  ['serif', 'Serif', 'Charter, "Iowan Old Style", Georgia, "Noto Serif", serif'],
  ['mono', 'Mono', 'var(--mono)'],
  ['rounded', 'Rounded', 'ui-rounded, "SF Pro Rounded", "Nunito", "Varela Round", system-ui, sans-serif'],
];
const pick = (value, options, fallback) => (options.includes(value) ? value : fallback);

// Dark themes first, then light ones (the picker shows them in two groups).
export const THEMES = [
  { id: 'graphite', name: 'Graphite' },
  { id: 'moss', name: 'Moss' },
  { id: 'oled', name: 'OLED' },
  { id: 'onyx', name: 'Onyx' },
  { id: 'slate', name: 'Slate' },
  { id: 'ocean', name: 'Ocean' },
  { id: 'deepsea', name: 'Deep Sea' },
  { id: 'teal', name: 'Teal' },
  { id: 'olive', name: 'Olive' },
  { id: 'dusk', name: 'Dusk' },
  { id: 'plum', name: 'Plum' },
  { id: 'wine', name: 'Wine' },
  { id: 'rose', name: 'Rosewood' },
  { id: 'ember', name: 'Ember' },
  { id: 'mocha', name: 'Mocha' },
  { id: 'paper', name: 'Paper', light: true },
  { id: 'sky', name: 'Sky', light: true },
  { id: 'mint', name: 'Mint', light: true },
  { id: 'sage', name: 'Sage', light: true },
  { id: 'lavender', name: 'Lavender', light: true },
  { id: 'blush', name: 'Blush', light: true },
  { id: 'peach', name: 'Peach', light: true },
];

// Themes that were renamed, so settings saved before keep working.
const RENAMED = { light: 'paper', dark: 'graphite', midnight: 'moss' };

export const ACCENTS = ['#ffffff', '#8b5cf6', '#6366f1', '#3b82f6', '#0ea5e9', '#14b8a6', '#22c55e', '#eab308', '#f97316', '#ef4444', '#ec4899', '#000000'];

const CACHE_KEY = 'oc_appearance';

// Black or white, whichever is easier to read on the given colour.
export function contrastOn(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? '#101114' : '#ffffff';
}

export function apply(settings) {
  const s = { ...DEFAULTS, ...settings };
  const root = document.documentElement;
  const accent = /^#[0-9a-f]{6}$/i.test(s.accent) ? s.accent : DEFAULTS.accent;
  const themeId = RENAMED[s.theme] || s.theme;
  root.dataset.theme = THEMES.some((t) => t.id === themeId) ? themeId : DEFAULTS.theme;
  root.dataset.tone = THEMES.find((t) => t.id === root.dataset.theme)?.light ? 'light' : 'dark';
  root.dataset.density = s.density === 'compact' ? 'compact' : 'cozy';
  root.dataset.avatars = s.avatarShape === 'square' ? 'square' : 'round';
  const font = FONTS.find(([id]) => id === s.font) || FONTS[0];
  const vars = {
    '--accent': accent,
    '--accent-text': contrastOn(accent),
    '--font': font[2],
    '--sidebar-width': `${Math.min(Math.max(Number(s.sidebarWidth) || 240, 200), 360)}px`,
    '--font-size': `${Math.min(Math.max(Number(s.fontSize) || 16, 12), 24)}px`,
  };
  root.dataset.lineHeight = pick(s.lineHeight, ['tight', 'normal', 'relaxed'], 'normal');
  root.dataset.corners = pick(s.corners, ['sharp', 'normal', 'round'], 'normal');
  root.dataset.spacing = pick(s.spacing, ['tight', 'normal', 'roomy'], 'normal');
  root.dataset.chatAvatars = String(s.chatAvatars !== false);
  root.dataset.contrast = pick(s.contrast, ['normal', 'high'], 'normal');
  root.dataset.motion = pick(s.motion, ['full', 'reduced'], 'full');
  root.dataset.linkPreviews = String(s.linkPreviews !== false);
  root.dataset.jumbo = String(s.jumboEmoji !== false);
  root.dataset.spoilers = pick(s.spoilers, ['click', 'always'], 'click');
  root.dataset.media = pick(s.mediaSize, ['small', 'normal', 'large'], 'normal');
  root.dataset.showTyping = String(s.showTyping !== false);
  root.dataset.bubbles = String(Boolean(s.bubbles));
  root.dataset.rail = pick(s.railPosition, ['left', 'top'], 'left');
  root.dataset.underlineLinks = String(Boolean(s.underlineLinks));
  root.dataset.timestamps = pick(s.timestamps, ['hover', 'always'], 'hover');
  setClock(pick(s.clock, ['auto', '12', '24'], 'auto'));
  // In the app's layer (not inline styles), so custom CSS can still override them.
  document.getElementById('theme-vars').textContent = `@layer app { :root:root:root { ${Object.entries(vars).map(([k, v]) => `${k}: ${v};`).join(' ')} } }`;
  for (const name of Object.keys(vars)) root.style.removeProperty(name);
  document.getElementById('custom-css').textContent = String(s.customCss || '');
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(s));
  } catch {
    // private mode: nothing to cache, the server copy still applies
  }
}

export function applyCached() {
  try {
    apply(JSON.parse(localStorage.getItem(CACHE_KEY)) || {});
  } catch {
    apply({});
  }
}
