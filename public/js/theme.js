// Appearance settings. They live in me.settings on the server (so they follow the account between
// devices) and are mirrored in localStorage so the page doesn't flash the wrong theme while loading.

export const DEFAULTS = {
  theme: 'light',
  accent: '#ee6a3f',
  fontSize: 16,
  density: 'cozy',
  avatarShape: 'round',
  customCss: '',
};

export const THEMES = [
  { id: 'light', name: 'Light' },
  { id: 'dark', name: 'Dark' },
  { id: 'midnight', name: 'Midnight' },
  { id: 'oled', name: 'OLED' },
];

export const ACCENTS = ['#ee6a3f', '#f5a524', '#3ecf8e', '#22b8cf', '#4c8dff', '#9b6dff', '#f0619a', '#8b95a7'];

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
  root.dataset.theme = THEMES.some((t) => t.id === s.theme) ? s.theme : DEFAULTS.theme;
  root.dataset.density = s.density === 'compact' ? 'compact' : 'cozy';
  root.dataset.avatars = s.avatarShape === 'square' ? 'square' : 'round';
  root.style.setProperty('--accent', accent);
  root.style.setProperty('--accent-text', contrastOn(accent));
  root.style.setProperty('--font-size', `${Math.min(Math.max(Number(s.fontSize) || 16, 12), 24)}px`);
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
