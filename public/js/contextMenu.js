// Right-click menus. `items` is a list of:
//   { label, icon, onClick, danger, confirm }  a row; `confirm` makes a danger row ask for a second click
//   { emojis: [...], onPick }                    a row of quick reactions
//   '-'                                          a divider
// Falsy entries are skipped, so callers can write `mine && { … }`.
import { h } from './dom.js';
import { icon } from './icons.js';
import { onEscape } from './escape.js';

let open = null; // { el, release }

export function closeMenu() {
  if (!open) return;
  const { el, release } = open;
  open = null;
  release();
  el.remove();
  document.removeEventListener('pointerdown', outside, true);
  window.removeEventListener('blur', closeMenu);
  window.removeEventListener('resize', closeMenu);
  document.removeEventListener('wheel', outside, true);
}

function outside(event) {
  if (open && !open.el.contains(event.target)) closeMenu();
}

function row(item) {
  if (item === '-') return h('div', { class: 'menu-divider', role: 'separator' });
  if (item.emojis) {
    return h('div', { class: 'menu-emojis' }, item.emojis.map((emoji) => h('button', {
      type: 'button', class: 'menu-emoji', 'aria-label': `React with ${emoji}`,
      onclick: () => { closeMenu(); item.onPick(emoji); },
    }, emoji)));
  }
  const label = h('span', { class: 'menu-label' }, item.label);
  const el = h('button', {
    type: 'button', role: item.checked !== undefined ? 'menuitemcheckbox' : 'menuitem', 'aria-checked': item.checked !== undefined ? String(Boolean(item.checked)) : null,
    class: `menu-item${item.danger ? ' danger' : ''}${item.checked ? ' checked' : ''}`,
    onclick: () => {
      if (item.confirm && !el.classList.contains('armed')) {
        el.classList.add('armed');
        label.textContent = 'Click again to confirm';
        return;
      }
      closeMenu();
      item.onClick();
    },
  }, item.face, item.dot && h('span', { class: `presence menu-dot ${item.dot}` }),
  item.swatch !== undefined && h('span', { class: 'menu-swatch', style: { background: item.swatch || 'var(--text-faint)' } }),
  label, item.badge > 0 && h('span', { class: 'ping-badge menu-badge' }, item.badge > 99 ? '99+' : item.badge),
  item.checked ? icon('check', 16) : item.icon && icon(item.icon, 16));
  return el;
}

export function showMenu(event, items, { above = false } = {}) {
  const rows = items.filter(Boolean);
  // Drop dividers at the ends or next to each other.
  const clean = rows.filter((item, i) => item !== '-' || (i > 0 && i < rows.length - 1 && rows[i - 1] !== '-'));
  if (!clean.length) return;
  event.preventDefault();
  event.stopPropagation();
  closeMenu();

  const el = h('div', { class: 'context-menu', role: 'menu', tabIndex: -1 }, clean.map(row));
  document.body.append(el);
  const { innerWidth: w, innerHeight: vh } = window;
  const box = el.getBoundingClientRect();
  const top = above ? event.clientY - box.height : event.clientY;
  el.style.left = `${Math.max(8, Math.min(event.clientX, w - box.width - 8))}px`;
  el.style.top = `${Math.max(8, Math.min(top, vh - box.height - 8))}px`;

  open = { el, release: onEscape(closeMenu) };
  document.addEventListener('pointerdown', outside, true);
  window.addEventListener('blur', closeMenu);
  window.addEventListener('resize', closeMenu);
  document.addEventListener('wheel', outside, true);
  // Focus the menu, not its first item, so nothing looks picked until you point at it (arrow keys still work).
  el.focus({ preventScroll: true });
  el.addEventListener('keydown', (e) => {
    if (!['ArrowDown', 'ArrowUp'].includes(e.key)) return;
    e.preventDefault();
    const items = [...el.querySelectorAll('button')];
    const at = items.indexOf(document.activeElement);
    items[(at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
  });
}

// Gives `el` a right-click menu built fresh each time from `build()`. Links, fields, media and selected
// text keep the browser's own menu, so "open link in new tab" and copy/paste still work.
export function withMenu(el, build) {
  el.addEventListener('contextmenu', (event) => {
    if (event.target.closest('a, input, textarea, video, audio') || String(getSelection())) return;
    showMenu(event, build(event));
  });
  return el;
}
