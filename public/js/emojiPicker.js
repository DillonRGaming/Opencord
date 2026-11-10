// The emoji picker: a floating panel with search, recent emoji, every server's custom emoji and the
// standard set. onPick gets either a unicode emoji or a custom one as "<:name:id>".
import { h } from './dom.js';
import { icon } from './icons.js';
import { state } from './store.js';
import { onEscape } from './escape.js';
import { CATEGORIES, EMOJI, recentEmoji, rememberEmoji, searchEmoji } from './emojiData.js';

let open = null;

export function closeEmojiPicker() {
  if (!open) return;
  open.release();
  open.el.remove();
  document.removeEventListener('pointerdown', open.outside, true);
  open = null;
}

export function customEmojis() {
  return [...state.servers.values()].flatMap((server) => (server.emojis || []).map((e) => ({ ...e, serverName: server.name, serverId: server.id })));
}

export const customCode = (emoji) => `<:${emoji.name}:${emoji.id}>`;

// Draws a stored reaction or picked value: unicode as text, custom as an image.
export function emojiFace(value, className = 'emoji-img') {
  const custom = /^<a?:([a-z0-9_]+):([\w-]+)>$/i.exec(value);
  if (custom) return h('img', { class: className, src: `/media/emojis/${custom[2]}`, alt: `:${custom[1]}:`, title: `:${custom[1]}:`, draggable: false });
  return value;
}

export function openEmojiPicker(anchor, onPick, { keepOpen = false } = {}) {
  if (open?.anchor === anchor) return closeEmojiPicker();
  closeEmojiPicker();
  const grid = h('div', { class: 'picker-grid' });
  const tabs = h('div', { class: 'picker-tabs' });
  const preview = h('div', { class: 'picker-preview' }, 'Pick an emoji');
  const search = h('input', { class: 'input', type: 'search', placeholder: 'Find an emoji', oninput: () => draw() });

  const pick = (value) => {
    rememberEmoji(value);
    onPick(value);
    if (!keepOpen) closeEmojiPicker();
  };
  const cell = (value, title, face) => h('button', {
    type: 'button', class: 'picker-emoji', title, 'aria-label': title,
    onclick: () => pick(value),
    onmouseenter: () => preview.replaceChildren(h('span', { class: 'picker-preview-face' }, face ?? value), h('span', {}, title)),
  }, face ?? value);
  const section = (title, cells) => cells.length && [h('div', { class: 'picker-heading', id: `picker-${title}` }, title), h('div', { class: 'picker-cells' }, cells)];
  const customCell = (e) => cell(customCode(e), `:${e.name}:  ·  ${e.serverName}`, h('img', { class: 'emoji-img', src: e.url, alt: e.name, loading: 'lazy' }));

  function draw() {
    const q = search.value.trim().toLowerCase().replace(/:/g, '');
    if (q) {
      const customs = customEmojis().filter((e) => e.name.includes(q)).map(customCell);
      const standard = searchEmoji(q, 120).map((e) => cell(e.char, `:${e.name}:`));
      grid.replaceChildren(...[section('Results', [...customs, ...standard])].flat().filter(Boolean));
      if (!customs.length && !standard.length) grid.replaceChildren(h('p', { class: 'note picker-empty' }, 'No emoji match that.'));
      return;
    }
    const recent = recentEmoji().map((value) => cell(value, value.startsWith('<') ? value.split(':')[1] : value, emojiFace(value)));
    const byServer = new Map();
    for (const e of customEmojis()) {
      if (!byServer.has(e.serverName)) byServer.set(e.serverName, []);
      byServer.get(e.serverName).push(customCell(e));
    }
    grid.replaceChildren(...[
      section('Recent', recent),
      ...[...byServer].map(([name, cells]) => section(name, cells)),
      ...CATEGORIES.map((category) => section(category, EMOJI.filter((e) => e.category === category).map((e) => cell(e.char, `:${e.name}:`)))),
    ].flat().filter(Boolean));
  }

  const jump = (title) => grid.querySelector(`[id="picker-${title}"]`)?.scrollIntoView({ block: 'start' });
  const tabIcons = { Recent: '🕘', People: '😀', Nature: '🌿', Food: '🍕', Activities: '🎮', Travel: '🚀', Objects: '💡', Symbols: '❤️' };
  tabs.append(...['Recent', ...CATEGORIES].map((title) => h('button', { type: 'button', class: 'picker-tab', title, onclick: () => { search.value = ''; draw(); jump(title); } }, tabIcons[title])));
  if (customEmojis().length) tabs.insertBefore(h('button', { type: 'button', class: 'picker-tab', title: 'Server emoji', onclick: () => { search.value = ''; draw(); grid.querySelector('.picker-heading:nth-of-type(2)')?.scrollIntoView(); } }, icon('smile', 16)), tabs.children[1]);

  const el = h('div', { class: 'emoji-picker', role: 'dialog', 'aria-label': 'Emoji picker' },
    h('div', { class: 'picker-top' }, search), tabs, grid, preview);
  document.body.append(el);
  draw();

  // Sit above the anchor, kept on screen.
  const a = anchor.getBoundingClientRect();
  const box = el.getBoundingClientRect();
  const left = Math.max(8, Math.min(a.right - box.width, innerWidth - box.width - 8));
  const top = a.top - box.height - 8 > 8 ? a.top - box.height - 8 : Math.min(a.bottom + 8, innerHeight - box.height - 8);
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
  search.focus();

  const outside = (event) => { if (!el.contains(event.target) && !anchor.contains(event.target)) closeEmojiPicker(); };
  document.addEventListener('pointerdown', outside, true);
  open = { el, anchor, outside, release: onEscape(closeEmojiPicker) };
}
