import { h } from '../dom.js';
import { iconButton, button } from '../ui.js';

const layers = () => document.getElementById('layers');

// Escape closes whatever was opened last (modal, popout, settings screen…).
const escapeStack = [];
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || !escapeStack.length) return;
  event.preventDefault();
  escapeStack.at(-1)();
});

export function onEscape(close) {
  escapeStack.push(close);
  return () => {
    const index = escapeStack.indexOf(close);
    if (index !== -1) escapeStack.splice(index, 1);
  };
}

export function openModal({ title, content, wide = false, onClose }) {
  const backdrop = h('div', {
    class: 'backdrop',
    onmousedown: (event) => { if (event.target === backdrop) close(); },
  }, h('div', { class: `modal${wide ? ' wide' : ''}`, role: 'dialog', 'aria-label': title },
    h('header', { class: 'modal-header' }, h('h2', {}, title), iconButton('x', 'Close', () => close())),
    h('div', { class: 'modal-body' }, content)));

  const release = onEscape(() => close());
  function close() {
    if (!backdrop.isConnected) return;
    release();
    backdrop.remove();
    onClose?.();
  }

  layers().append(backdrop);
  backdrop.querySelector('.modal-body input, .modal-body textarea')?.focus();
  return { close };
}

export function confirmDialog({ title, text, confirmLabel = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    let answer = false;
    const modal = openModal({
      title,
      onClose: () => resolve(answer),
      content: [
        h('p', { class: 'modal-text' }, text),
        h('div', { class: 'modal-actions' },
          button('Cancel', () => modal.close(), 'ghost'),
          button(confirmLabel, () => { answer = true; modal.close(); }, danger ? 'danger' : 'primary')),
      ],
    });
  });
}

// A small dropdown under (or above) the element that opened it. items: [label, onclick, class?] or null to skip.
export function openMenu(anchor, items) {
  const menu = h('div', { class: 'menu', role: 'menu' }, items.filter(Boolean).map(([label, action, kind]) => h('button', {
    type: 'button', class: kind || '', role: 'menuitem', onclick: () => { close(); action(); },
  }, label)));
  const release = onEscape(() => close());
  const onDown = (event) => { if (!menu.contains(event.target)) close(); };
  function close() {
    release();
    document.removeEventListener('mousedown', onDown, true);
    menu.remove();
  }
  layers().append(menu);
  place(menu, anchor);
  setTimeout(() => document.addEventListener('mousedown', onDown, true));
}

// Puts a floating element next to its anchor, kept inside the window.
export function place(el, anchor, side = 'below') {
  const a = anchor.getBoundingClientRect();
  const { offsetWidth: width, offsetHeight: height } = el;
  let left = side === 'beside' ? a.right + 8 : a.left;
  let top = side === 'beside' ? a.top : a.bottom + 4;
  if (left + width > innerWidth - 8) left = side === 'beside' ? a.left - width - 8 : innerWidth - width - 8;
  if (top + height > innerHeight - 8) top = innerHeight - height - 8;
  el.style.left = `${Math.max(8, left)}px`;
  el.style.top = `${Math.max(8, top)}px`;
}

export function openLightbox(attachment) {
  const box = h('div', { class: 'lightbox', onclick: (event) => { if (event.target.tagName !== 'A') close(); } },
    h('img', { src: attachment.url, alt: attachment.name }),
    h('a', { href: attachment.url, target: '_blank', rel: 'noopener' }, 'Open original'));
  const release = onEscape(() => close());
  function close() {
    release();
    box.remove();
  }
  layers().append(box);
}
