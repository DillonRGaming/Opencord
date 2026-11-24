// Custom dropdowns for every <select> in the app. Each select is upgraded in place: it stays in the page (hidden)
// as the real value, so code that reads `select.value` or listens for `change` keeps working, and a button plus a
// menu in the app's own style replace how it looks. New selects are upgraded as soon as they're added.
// Opt out with data-native on a select.

import { h } from './dom.js';
import { icon } from './icons.js';

let openMenu = null; // { menu, select, button, close }

const valueOf = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
const indexOf = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'selectedIndex');

function upgrade(select) {
  // An upgraded select that got moved out of its wrapper (a redraw reusing the element) goes back in.
  if (select.dd) {
    if (select.parentNode !== select.dd.wrap) { select.replaceWith(select.dd.wrap); select.dd.wrap.append(select); }
    return;
  }
  if (select.dataset.dd || select.multiple || select.size > 1 || 'native' in select.dataset) return;
  select.dataset.dd = '1';
  const label = h('span', { class: 'dd-label' });
  const button = h('button', {
    type: 'button', class: `${select.className} dd-button`.trim(), 'aria-haspopup': 'listbox', 'aria-expanded': 'false',
  }, label, icon('chevronDown', 16));
  if (select.getAttribute('aria-label')) button.setAttribute('aria-label', select.getAttribute('aria-label'));
  if (select.title) button.title = select.title;
  if (select.style.cssText) button.style.cssText = select.style.cssText;
  if (select.id) { button.id = select.id; select.removeAttribute('id'); } // so <label for> still points at something you can click
  const wrap = h('span', { class: 'dd' });
  select.replaceWith(wrap);
  wrap.append(button, select);
  select.classList.add('dd-native');
  select.tabIndex = -1;
  select.setAttribute('aria-hidden', 'true');

  const sync = () => {
    const option = select.options[select.selectedIndex];
    label.textContent = option ? option.textContent : '';
    button.disabled = select.disabled;
  };
  select.dd = { sync, button, wrap };
  // Code that sets the value directly (not through the menu) still updates the button.
  Object.defineProperty(select, 'value', { configurable: true, get() { return valueOf.get.call(this); }, set(v) { valueOf.set.call(this, v); sync(); } });
  Object.defineProperty(select, 'selectedIndex', { configurable: true, get() { return indexOf.get.call(this); }, set(v) { indexOf.set.call(this, v); sync(); } });
  select.addEventListener('change', sync);
  new MutationObserver(sync).observe(select, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'selected', 'label'] });
  sync();

  button.addEventListener('click', () => (openMenu?.select === select ? close() : open(select, button)));
  button.addEventListener('keydown', (event) => {
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
      event.preventDefault();
      if (openMenu?.select !== select) open(select, button);
    }
  });
}

function close(refocus = false) {
  if (!openMenu) return;
  const { menu, button } = openMenu;
  menu.remove();
  button.setAttribute('aria-expanded', 'false');
  openMenu = null;
  if (refocus) button.focus();
}

function choose(select, value) {
  if (select.value !== value) {
    select.value = value;
    select.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }
  close(true);
}

function open(select, button) {
  close();
  const items = [];
  const rows = [];
  const add = (option) => {
    const selected = option.value === select.value && option.index === select.selectedIndex;
    const item = h('button', {
      type: 'button', role: 'option', class: `menu-item dd-item${selected ? ' checked' : ''}`, disabled: option.disabled,
      'aria-selected': String(selected), onclick: () => choose(select, option.value),
    }, h('span', { class: 'menu-label' }, option.textContent), selected ? icon('check', 16) : '');
    items.push(item);
    rows.push(item);
  };
  for (const child of select.children) {
    if (child.tagName === 'OPTGROUP') {
      rows.push(h('div', { class: 'dd-group' }, child.label));
      [...child.children].forEach(add);
    } else if (child.tagName === 'OPTION' && !child.hidden) add(child);
  }
  const menu = h('div', { class: 'context-menu dd-menu', role: 'listbox' }, rows);
  document.body.append(menu);
  button.setAttribute('aria-expanded', 'true');

  // Below the button, or above it when there's more room there. At least as wide as the button.
  const r = button.getBoundingClientRect();
  const below = innerHeight - r.bottom - 8;
  const above = r.top - 8;
  const up = below < 220 && above > below;
  menu.style.minWidth = `${r.width}px`;
  menu.style.maxHeight = `${Math.min(340, up ? above : below) - 4}px`;
  menu.style.left = `${Math.max(8, Math.min(r.left, innerWidth - menu.offsetWidth - 8))}px`;
  if (up) menu.style.bottom = `${innerHeight - r.top + 4}px`;
  else menu.style.top = `${r.bottom + 4}px`;

  let active = Math.max(0, items.findIndex((i) => i.classList.contains('checked')));
  const focusItem = (i) => {
    const enabled = items.filter((it) => !it.disabled);
    if (!enabled.length) return;
    active = (i + items.length) % items.length;
    while (items[active].disabled) active = (active + 1) % items.length;
    items[active].focus({ preventScroll: true });
    items[active].scrollIntoView({ block: 'nearest' });
  };
  focusItem(active);

  let typed = '';
  let typedAt = 0;
  menu.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); focusItem(active + 1); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); focusItem(active - 1); }
    else if (event.key === 'Home') { event.preventDefault(); focusItem(0); }
    else if (event.key === 'End') { event.preventDefault(); focusItem(items.length - 1); }
    else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
    else if (event.key === 'Tab') close(true);
    else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
      // Type to jump to an option.
      typed = Date.now() - typedAt > 700 ? event.key.toLowerCase() : typed + event.key.toLowerCase();
      typedAt = Date.now();
      const i = items.findIndex((it) => !it.disabled && it.textContent.trim().toLowerCase().startsWith(typed));
      if (i >= 0) focusItem(i);
    }
  });
  menu.addEventListener('focusout', () => setTimeout(() => {
    if (openMenu?.menu === menu && !menu.contains(document.activeElement) && document.activeElement !== button) close();
  }));
  openMenu = { menu, select, button };
}

// Clicking elsewhere, scrolling the page behind, or resizing closes the open menu.
addEventListener('pointerdown', (event) => {
  if (openMenu && !openMenu.menu.contains(event.target) && !openMenu.button.contains(event.target)) close();
}, true);
addEventListener('scroll', (event) => { if (openMenu && !openMenu.menu.contains(event.target)) close(); }, true);
addEventListener('resize', () => close());

export function startDropdowns(root = document.body) {
  root.querySelectorAll('select').forEach(upgrade);
  new MutationObserver((changes) => {
    for (const change of changes) {
      for (const node of change.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.tagName === 'SELECT') upgrade(node);
        else node.querySelectorAll?.('select').forEach(upgrade);
      }
    }
  }).observe(root, { childList: true, subtree: true });
}
