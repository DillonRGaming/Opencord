import { h } from '../dom.js';
import { on } from '../store.js';
import { iconButton } from '../ui.js';
import { onEscape } from '../escape.js';
import { closePanel } from './side.js';
import { pushLayer, leaveLayer, currentLayers } from '../router.js';

// Full pages in the main column (settings, add a server, invite people…). The chat underneath is only
// hidden, not closed, so a half-typed message or a running upload survives. Going anywhere closes the page.

let column = null;
let current = null; // { el, release, onClose }

export function mountPages(el) {
  column = el;
}

// `content` is a node or a list of nodes. `actions` are extra controls for the header (tabs…). Returns { close }.
// `key` puts the page in the address (?page=key), so a refresh opens it again: see registerPage.
export function openPage({ title, content, actions, onClose, key = null }) {
  closePage();
  closePanel();
  const el = h('section', { class: 'page-view', 'aria-label': title },
    h('header', { class: 'main-header' },
      iconButton('back', 'Back', () => dismissPage(), 'page-back'),
      h('h1', { class: 'main-title' }, title),
      actions,
      h('span', { class: 'main-spacer' }),
      iconButton('x', 'Close', () => dismissPage())),
    h('div', { class: 'page-scroll' }, h('div', { class: 'page-content' }, content)));
  const mine = { el, onClose, key, release: onEscape(() => dismissPage()) };
  pushLayer('page');
  current = mine;
  column.append(el);
  column.classList.add('page-open');
  setPageKey(key);
  document.body.dataset.panel = 'main';
  // Only with a mouse: on a touch screen, focusing a box pops the keyboard up over what you opened.
  if (matchMedia('(hover: hover)').matches) el.querySelector('.page-content input:not([readonly]):not([type="color"]), .page-content textarea')?.focus();
  return { el, close: () => { if (current === mine) closePage(); } };
}

export function closePage() {
  if (!current) return;
  const { el, release, onClose } = current;
  current = null;
  release();
  el.remove();
  column.classList.remove('page-open');
  setPageKey(null);
  onClose?.();
}

// --- pages in the address ---
// ?page=settings:privacy, ?page=server:<id>:roles, ?page=bot:<serverId>:<botId>… A refresh (or a shared
// link) reopens the page through the opener registered for its first part.

const openers = new Map();

export function registerPage(name, open) {
  openers.set(name, open);
}

// Changes the address without a new history entry. Sections inside a page call this as they switch.
export function setPageKey(key) {
  const url = new URL(location.href);
  if (key) url.searchParams.set('page', key);
  else url.searchParams.delete('page');
  if (url.href !== location.href) history.replaceState(history.state, '', url.pathname + url.search);
  if (current) current.key = key;
}

export async function restorePage() {
  const key = new URL(location.href).searchParams.get('page');
  if (!key) return;
  const [name, ...args] = key.split(':');
  const open = openers.get(name);
  try {
    if (!open || !(await open(...args))) setPageKey(null);
  } catch {
    setPageKey(null);
  }
}

// The back arrow, the close button and Escape: through history on a phone, so the entry it added goes too.
export function dismissPage() {
  leaveLayer('page', closePage);
}

on('route', () => closePage());
on('layers', () => { if (current && !currentLayers().includes('page')) closePage(); });
