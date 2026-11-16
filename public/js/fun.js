// The GIF picker and Emoji Kitchen. Both are pop-ups above the message box; picking one sends its link,
// which the chat shows as the picture. Pictures load through /media/remote so other sites never see viewers.
import * as api from './api.js';
import { h } from './dom.js';
import { icon } from './icons.js';
import { onEscape } from './escape.js';
import { searchEmoji } from './emojiData.js';

export const remote = (url) => `/media/remote?url=${encodeURIComponent(url)}`;

let open = null;

export function closeFunPicker() {
  if (!open) return;
  open.release();
  open.el.remove();
  document.removeEventListener('pointerdown', open.outside, true);
  open = null;
}

// A pop-up sitting above (or below) the anchor, kept on screen. Toggles when the same anchor is pressed again.
// Also used for the music player's speed and volume panels.
export function openPopover(anchor, className, label, children) {
  return popover(anchor, className, label, children);
}

function popover(anchor, className, label, children) {
  if (open?.anchor === anchor) { closeFunPicker(); return null; }
  closeFunPicker();
  const el = h('div', { class: `emoji-picker fun-picker ${className}`, role: 'dialog', 'aria-label': label }, children);
  document.body.append(el);
  const a = anchor.getBoundingClientRect();
  const box = el.getBoundingClientRect();
  el.style.left = `${Math.max(8, Math.min(a.right - box.width, innerWidth - box.width - 8))}px`;
  el.style.top = `${a.top - box.height - 8 > 8 ? a.top - box.height - 8 : Math.min(a.bottom + 8, innerHeight - box.height - 8)}px`;
  const outside = (event) => { if (!el.contains(event.target) && !anchor.contains(event.target)) closeFunPicker(); };
  document.addEventListener('pointerdown', outside, true);
  open = { el, anchor, outside, release: onEscape(closeFunPicker) };
  return el;
}

// --- GIFs ---

const GIF_TOPICS = ['happy', 'lol', 'yes', 'no', 'wow', 'sad', 'love', 'dance', 'thumbs up', 'cat', 'facepalm', 'hello'];

export function openGifPicker(anchor, onPick) {
  const grid = h('div', { class: 'gif-grid' });
  const status = h('p', { class: 'note picker-empty' }, 'Loading…');
  let timer = null;
  let asked = 0;
  const search = h('input', {
    class: 'input', type: 'search', placeholder: 'Search GIFs', 'aria-label': 'Search GIFs',
    oninput: () => { clearTimeout(timer); timer = setTimeout(() => load(search.value.trim()), 350); },
  });
  const chips = h('div', { class: 'gif-chips' }, GIF_TOPICS.map((t) => h('button', { type: 'button', class: 'chip', onclick: () => { search.value = t; load(t); } }, t)));

  async function load(q) {
    const mine = ++asked;
    grid.replaceChildren();
    status.textContent = 'Loading…';
    status.hidden = false;
    try {
      const gifs = await api.get(`/api/fun/gifs${q ? `?q=${encodeURIComponent(q)}` : ''}`);
      if (mine !== asked) return;
      status.hidden = gifs.length > 0;
      status.textContent = 'No GIFs found.';
      // Two columns filled side by side, like a masonry wall.
      const cols = [h('div', { class: 'gif-col' }), h('div', { class: 'gif-col' })];
      gifs.forEach((gif, i) => cols[i % 2].append(h('button', {
        type: 'button', class: 'gif-cell', title: gif.title, 'aria-label': gif.title,
        onclick: () => { closeFunPicker(); onPick(gif.url); },
      }, h('img', { src: remote(gif.preview), alt: gif.title, loading: 'lazy' }))));
      grid.replaceChildren(...cols);
    } catch (err) {
      if (mine === asked) status.textContent = err.message;
    }
  }

  const el = popover(anchor, 'gif-picker', 'GIFs', [
    h('div', { class: 'picker-top' }, search), chips, h('div', { class: 'gif-scroll' }, status, grid),
    h('div', { class: 'picker-preview gif-credit' }, 'GIFs from Tenor'),
  ]);
  if (!el) return;
  if (matchMedia('(hover: hover)').matches) search.focus();
  load('');
}

// --- Emoji Kitchen ---

let mixable = null; // Promise<string[]> of every emoji that can be mixed
const RECENT_KEY = 'oc:kitchen';

function recentMixes() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]').slice(0, 12); } catch { return []; }
}
function rememberMix(url) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify([url, ...recentMixes().filter((u) => u !== url)].slice(0, 12))); } catch { /* fine */ }
}

// Pick a first emoji, then every sticker it makes shows up; tap one to send it.
export function openKitchen(anchor, onPick) {
  mixable ??= api.get('/api/fun/kitchen').catch((err) => { mixable = null; throw err; });
  let first = null;
  const left = h('div', { class: 'kitchen-list' });
  const right = h('div', { class: 'kitchen-mixes' });
  const head = h('div', { class: 'kitchen-head' });
  const search = h('input', { class: 'input', type: 'search', placeholder: 'Find an emoji', 'aria-label': 'Find an emoji', oninput: () => drawLeft() });

  const send = (url) => { rememberMix(url); closeFunPicker(); onPick(url); };
  const sticker = (url, title) => h('button', { type: 'button', class: 'kitchen-sticker', title, 'aria-label': title, onclick: () => send(url) },
    h('img', { src: remote(url), alt: title, loading: 'lazy' }));

  async function drawLeft() {
    let all;
    try { all = await mixable; } catch (err) { left.replaceChildren(h('p', { class: 'note' }, err.message)); return; }
    const q = search.value.trim().toLowerCase();
    let list = all;
    if (q) {
      const found = new Set(searchEmoji(q, 200).map((e) => e.char.replace(/️/g, '')));
      list = all.filter((e) => found.has(e.replace(/️/g, '')));
    }
    left.replaceChildren(...list.map((e) => h('button', {
      type: 'button', class: `picker-emoji${e === first ? ' on' : ''}`, 'aria-pressed': String(e === first), onclick: () => pickFirst(e),
    }, e)));
    if (!list.length) left.replaceChildren(h('p', { class: 'note' }, 'None of those mix.'));
  }

  async function pickFirst(e) {
    first = e;
    drawLeft();
    head.replaceChildren(h('span', { class: 'kitchen-first' }, e), h('span', {}, '+ pick a sticker'));
    right.replaceChildren(h('p', { class: 'note' }, 'Mixing…'));
    try {
      const mixes = await api.get(`/api/fun/kitchen/${encodeURIComponent(e)}`);
      if (first !== e) return;
      right.replaceChildren(...mixes.map((m) => sticker(m.url, `${e} + ${m.emoji}`)));
    } catch (err) {
      right.replaceChildren(h('p', { class: 'note' }, err.message));
    }
  }

  function drawStart() {
    head.replaceChildren(h('span', {}, 'Pick an emoji to mix'));
    const recent = recentMixes();
    right.replaceChildren(...(recent.length ? [h('div', { class: 'picker-heading' }, 'Recent'), ...recent.map((url) => sticker(url, 'Recent sticker'))]
      : [h('div', { class: 'kitchen-hint' }, icon('sparkles', 28), h('span', {}, 'Google’s Emoji Kitchen: pick an emoji on the left and see every sticker it makes.'))]));
  }

  const el = popover(anchor, 'kitchen-picker', 'Emoji Kitchen', [
    h('div', { class: 'picker-top' }, search), head, h('div', { class: 'kitchen-body' }, left, right),
  ]);
  if (!el) return;
  drawStart();
  drawLeft();
}
