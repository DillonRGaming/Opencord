// Small pieces shared by several views.
import { h } from './dom.js';
import { icon } from './icons.js';
import { state } from './store.js';

// Soft, light faces with dark letters. No blues.
const AVATAR_COLORS = ['#e1c9a2', '#b9cfae', '#d8bfc4', '#d6dbd3', '#cdbfdc', '#e3b49c', '#c9cf9e', '#a9cbbb'];

export function colorFor(id) {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

function initials(name) {
  return [...name.trim()].slice(0, 1).join('').toUpperCase() || '?';
}

const markLoaded = (event) => event.currentTarget.classList.add('loaded');

export function avatar(user, { size = 40, presence = false } = {}) {
  const face = user.avatar
    ? h('img', { class: 'avatar-face', src: user.avatar, alt: '', draggable: false, onload: markLoaded })
    : h('span', { class: 'avatar-face', style: { background: colorFor(user.id) } }, initials(user.displayName));
  const dot = presence && h('span', { class: `presence ${statusOf(user)}`, dataset: { presence: user.id } });
  return h('span', { class: 'avatar', style: { '--size': `${size}px` } }, face, dot);
}

export function serverIcon(server, size = 48) {
  const face = server.icon
    ? h('img', { src: server.icon, alt: '', draggable: false, onload: markLoaded })
    : h('span', {}, server.name.split(/\s+/).map(initials).slice(0, 3).join(''));
  return h('span', { class: 'server-icon', style: { '--size': `${size}px` } }, face);
}

// 'online' / 'idle' / 'dnd' / 'offline' for a dot. Bots are always online; my own dot shows what I picked.
export function statusOf(user) {
  if (user.bot) return 'online';
  if (user.id === state.me?.id) {
    const mine = state.me.presence || 'online';
    return mine === 'invisible' ? 'offline' : mine === 'online' ? (state.statuses.get(user.id) || 'online') : mine;
  }
  if (!state.online.has(user.id)) return 'offline';
  return state.statuses.get(user.id) || 'online';
}

export const STATUS_LABELS = { online: 'Online', idle: 'Idle', dnd: 'Do not disturb', offline: 'Offline', invisible: 'Invisible' };

// Presence dots are updated in place, so views don't need to re-render when someone comes online.
export function refreshPresenceDots() {
  for (const dot of document.querySelectorAll('[data-presence]')) {
    const user = state.users.get(dot.dataset.presence) || { id: dot.dataset.presence };
    dot.className = `presence ${statusOf(user)}`;
  }
}

export function iconButton(name, label, onclick, extraClass = '') {
  return h('button', { class: `icon-button ${extraClass}`, type: 'button', title: label, 'aria-label': label, onclick }, icon(name));
}

export function button(label, onclick, kind = 'primary') {
  return h('button', { class: `button ${kind}`, type: 'button', onclick }, label);
}

// Used instead of an "Are you sure?" dialog: the first click turns the button into "<confirmLabel>",
// a second click within a few seconds runs `onConfirm`. `face` is what it shows before that (text or an icon).
export function confirmButton({ label, confirmLabel, onConfirm, face = label, className = 'button danger small' }) {
  let timer = null;
  const el = h('button', {
    type: 'button', class: className, title: label, 'aria-label': label,
    onclick: () => {
      if (!timer) {
        el.classList.add('armed');
        el.replaceChildren(confirmLabel);
        el.setAttribute('aria-label', confirmLabel);
        timer = setTimeout(disarm, 4000);
        return;
      }
      disarm();
      attempt(onConfirm);
    },
  }, face);
  function disarm() {
    clearTimeout(timer);
    timer = null;
    el.classList.remove('armed');
    el.replaceChildren(...[face].flat());
    el.setAttribute('aria-label', label);
  }
  return el;
}

// Feedback ("Copied.", an error) shows up inline, right where you did the thing: in the message box when it
// came from the chat, or as a line at the bottom of the card, form or panel you were using. Nothing floats.
let lastTarget = null;
document.addEventListener('pointerdown', (event) => {
  // A click in a menu doesn't count: the menu closes, so the thing it was opened on is the better place.
  if (!event.target.closest?.('.menu, .emoji-picker, .color-picker')) lastTarget = event.target;
}, true);
document.addEventListener('keydown', () => {
  if (document.activeElement && document.activeElement !== document.body) lastTarget = document.activeElement;
}, true);

const NOTICE_HOSTS = '.settings-card, .post-draft, .wiki-editor, .wiki-page, .event-card, .music-now, .music-queue, .role-editor, '
  + '.add-friend, .friend, .side-body, .vc-call, .vc-lobby, .user-panel, .sidebar-scroll, .page-scroll, .ring-card, .main-header';

function noticeHost(anchor) {
  const el = anchor?.isConnected ? anchor : null;
  // (Not `a || (!el && b)`: that's `false` when the click wasn't in a chat, and false?.querySelector throws.)
  const chat = el ? el.closest?.('.chat') : document.querySelector('.column-content .chat');
  const composer = chat ? chat.querySelector('.composer') : null;
  if (composer) return { composer };
  const host = el?.closest?.(NOTICE_HOSTS) || document.querySelector('.page-open .page-scroll, .column-content .page-scroll, .column-content .main-header');
  return { host };
}

export function toast(message, kind = 'error', anchor = lastTarget) {
  if (!message) return;
  const { composer, host } = noticeHost(anchor);
  if (composer) {
    composer.dispatchEvent(new CustomEvent('notice', { detail: { message, kind } }));
    return;
  }
  if (!host) return;
  const note = h('p', { class: `inline-notice ${kind}`, role: kind === 'error' ? 'alert' : 'status' }, message);
  // One notice per place: a new one replaces the last.
  const box = host.matches('.main-header') ? host.parentElement : host;
  if (!box) return;
  box.querySelector(':scope > .inline-notice')?.remove();
  if (host.matches('.main-header')) host.after(note);
  else box.append(note);
  setTimeout(() => note.remove(), kind === 'error' ? 7000 : 3500);
}

// Runs an async action from a click handler and shows a toast if it fails.
export async function attempt(action) {
  try {
    return await action();
  } catch (err) {
    toast(err.message);
    return undefined;
  }
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const input = h('textarea', { value: text });
    document.body.append(input);
    input.select();
    document.execCommand('copy');
    input.remove();
  }
}

// Opens the file picker and resolves with the chosen files.
export function pickFiles({ accept = '', multiple = false } = {}) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept, multiple, onchange: () => resolve([...input.files]) });
    input.click();
  });
}

// A labelled form field. (A third "hint" argument is still accepted but no longer shown: no explainer text under fields.)
export function field(label, control) {
  return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), control);
}

// A form with one submit button. While onSubmit runs the button is disabled; if it throws, the message is shown.
export function form({ submitLabel, onSubmit, kind = 'primary' }, ...fields) {
  const error = h('p', { class: 'form-error', role: 'alert' });
  const submit = h('button', { class: `button ${kind}`, type: 'submit' }, submitLabel);
  return h('form', {
    class: 'form',
    onsubmit: async (event) => {
      event.preventDefault();
      error.textContent = '';
      submit.disabled = true;
      try {
        await onSubmit();
      } catch (err) {
        error.textContent = err.message;
      } finally {
        submit.disabled = false;
      }
    },
  }, fields, error, h('div', { class: 'form-actions' }, submit));
}

// Page tabs, the same everywhere: in the header on a computer, in their own row at the top of the page on a phone.
// `items` are [id, label, badge?]. Returns { header, page, set(id) }: put `header` in the page header and `page`
// at the top of the page's content.
export function pageTabs(items, current, onPick) {
  const make = (extra) => h('div', { class: `tabs ${extra}`, role: 'tablist' }, items.map(([id, label, badge]) => h('button', {
    type: 'button', role: 'tab', class: 'tab', 'aria-selected': String(id === current), dataset: { tab: String(id) },
    onclick: () => { set(id); onPick(id); },
  }, label, badge > 0 && h('span', { class: 'badge' }, badge))));
  const header = make('header-tabs');
  const page = make('page-tabs');
  function set(id) {
    current = id;
    for (const tab of [...header.children, ...page.children]) tab.setAttribute('aria-selected', String(tab.dataset.tab === String(id)));
  }
  return { header, page, set };
}

// A row of buttons where exactly one is pressed.
export function segmented(options, current, onChange) {
  const el = h('div', { class: 'segmented' }, options.map(([value, label]) => h('button', {
    type: 'button',
    'aria-pressed': String(value === current),
    onclick: (event) => {
      for (const other of el.children) other.setAttribute('aria-pressed', String(other === event.currentTarget));
      onChange(value);
    },
  }, label)));
  return el;
}

// What an empty list shows, the same everywhere: an icon, a line, and maybe a hint under it.
export function emptyList(iconName, title, text = null) {
  return h('div', { class: 'empty-state small' }, h('span', { class: 'empty-icon' }, icon(iconName, 22)), h('strong', {}, title), text && h('span', {}, text));
}

// An on/off switch: the one control for every yes/no setting.
export function switchControl(on, onChange, label, disabled = false) {
  const el = h('button', {
    type: 'button', class: `switch${on ? ' on' : ''}`, role: 'switch', 'aria-checked': String(on), 'aria-label': label, disabled,
    onclick: () => {
      const next = el.getAttribute('aria-checked') !== 'true';
      el.setAttribute('aria-checked', String(next));
      el.classList.toggle('on', next);
      onChange(next);
    },
  }, h('span', { class: 'switch-knob' }));
  return el;
}

// Settings pages are built from these: a card per topic, and rows of "label … control" inside it.
export function settingsCard(title, ...children) {
  return h('section', { class: 'settings-card' }, title && h('h2', { class: 'settings-card-title' }, title), children);
}

export function settingRow(label, control) {
  return h('div', { class: 'setting-row' }, h('span', { class: 'setting-label' }, label), h('div', { class: 'setting-control' }, control));
}

// The top card of a settings-style page: a big picture, a name, a line under it, and actions on the right.
export function settingsHero(picture, title, meta, ...actions) {
  return h('section', { class: 'settings-card settings-hero' }, picture,
    h('div', { class: 'settings-hero-text' }, h('div', { class: 'settings-hero-title' }, title), meta && h('div', { class: 'settings-hero-meta' }, meta)),
    actions.length > 0 && h('div', { class: 'settings-hero-actions' }, actions));
}

// --- skeletons: grey shimmering placeholders shaped like what's loading ---

const skel = (cls, style) => h('span', { class: `skel ${cls}`, style });
const widths = [62, 38, 80, 54, 70, 46, 88, 58];

// Chat messages: a picture, a name line and one or two text lines each.
export function skeletonMessages(count = 8) {
  return h('div', { class: 'skel-messages', 'aria-hidden': 'true' }, Array.from({ length: count }, (_, i) => h('div', { class: 'skel-message' },
    skel('skel-circle', { width: '40px', height: '40px' }),
    h('div', { class: 'skel-lines' },
      skel('skel-line', { width: `${70 + (i * 37) % 60}px`, height: '12px' }),
      skel('skel-line', { width: `${widths[i % widths.length]}%` }),
      i % 3 === 0 && skel('skel-line', { width: `${widths[(i + 3) % widths.length] / 1.6}%` })))));
}

// Rows of people (members, DMs, friends): a small picture and a name.
export function skeletonRows(count = 6, size = 32) {
  return h('div', { class: 'skel-rows', 'aria-hidden': 'true' }, Array.from({ length: count }, (_, i) => h('div', { class: 'skel-row' },
    skel('skel-circle', { width: `${size}px`, height: `${size}px` }),
    skel('skel-line', { width: `${widths[i % widths.length]}%` }))));
}

// The whole app while it first loads: server rail, sidebar, chat and members, all as placeholders.
export function skeletonApp() {
  return h('div', { class: 'app skel-app', 'aria-busy': 'true', 'aria-label': 'Loading' },
    h('nav', { class: 'rail' }, Array.from({ length: 4 }, () => skel('skel-square', { width: '48px', height: '48px' }))),
    h('aside', { class: 'sidebar panel' }, h('div', { class: 'skel-pad' }, skel('skel-line', { width: '55%', height: '14px' })), skeletonRows(9)),
    h('main', { class: 'main' },
      h('div', { class: 'column panel' }, h('div', { class: 'skel-pad skel-head' }, skel('skel-line', { width: '140px', height: '14px' })), skeletonMessages(7)),
      h('aside', { class: 'side panel' }, skeletonRows(8))));
}
