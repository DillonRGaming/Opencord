import { h } from '../dom.js';
import { on } from '../store.js';
import { iconButton } from '../ui.js';
import { onEscape } from '../escape.js';
import { closePanel } from './side.js';

// Full pages in the main column (settings, add a server, invite people…). The chat underneath is only
// hidden, not closed, so a half-typed message or a running upload survives. Going anywhere closes the page.

let column = null;
let current = null; // { el, release, onClose }

export function mountPages(el) {
  column = el;
}

// `content` is a node or a list of nodes. `actions` are extra controls for the header (tabs…). Returns { close }.
export function openPage({ title, content, actions, onClose }) {
  closePage();
  closePanel();
  const el = h('section', { class: 'page-view', 'aria-label': title },
    h('header', { class: 'main-header' },
      iconButton('back', 'Back', () => closePage(), 'page-back'),
      h('h1', { class: 'main-title' }, title),
      actions,
      h('span', { class: 'main-spacer' }),
      iconButton('x', 'Close', () => closePage())),
    h('div', { class: 'page-scroll' }, h('div', { class: 'page-content' }, content)));
  const mine = { el, onClose, release: onEscape(() => closePage()) };
  current = mine;
  column.append(el);
  column.classList.add('page-open');
  document.body.dataset.panel = 'main';
  el.querySelector('.page-content input:not([readonly]):not([type="color"]), .page-content textarea')?.focus();
  return { el, close: () => { if (current === mine) closePage(); } };
}

export function closePage() {
  if (!current) return;
  const { el, release, onClose } = current;
  current = null;
  release();
  el.remove();
  column.classList.remove('page-open');
  onClose?.();
}

on('route', () => closePage());
