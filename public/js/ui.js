// Small pieces shared by several views.
import { h } from './dom.js';
import { icon } from './icons.js';
import { state } from './store.js';

const AVATAR_COLORS = ['#e8684a', '#d99a1c', '#35a873', '#1d9bb3', '#3d78e0', '#8459e0', '#d54c88', '#6e7a8f'];

function colorFor(id) {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

function initials(name) {
  return [...name.trim()].slice(0, 1).join('').toUpperCase() || '?';
}

export function avatar(user, { size = 40, presence = false } = {}) {
  const face = user.avatar
    ? h('img', { class: 'avatar-face', src: user.avatar, alt: '', draggable: false })
    : h('span', { class: 'avatar-face', style: { background: colorFor(user.id) } }, initials(user.displayName));
  const dot = presence && h('span', {
    class: `presence${state.online.has(user.id) ? ' online' : ''}`,
    dataset: { presence: user.id },
  });
  return h('span', { class: 'avatar', style: { '--size': `${size}px` } }, face, dot);
}

export function serverIcon(server, size = 48) {
  const face = server.icon
    ? h('img', { src: server.icon, alt: '', draggable: false })
    : h('span', {}, server.name.split(/\s+/).map(initials).slice(0, 3).join(''));
  return h('span', { class: 'server-icon', style: { '--size': `${size}px` } }, face);
}

// Presence dots are updated in place, so views don't need to re-render when someone comes online.
export function refreshPresenceDots() {
  for (const dot of document.querySelectorAll('[data-presence]')) {
    dot.classList.toggle('online', state.online.has(dot.dataset.presence));
  }
}

export function iconButton(name, label, onclick, extraClass = '') {
  return h('button', { class: `icon-button ${extraClass}`, type: 'button', title: label, 'aria-label': label, onclick }, icon(name));
}

export function button(label, onclick, kind = 'primary') {
  return h('button', { class: `button ${kind}`, type: 'button', onclick }, label);
}

export function toast(message, kind = 'error') {
  const el = h('div', { class: `toast ${kind}`, role: 'status' }, message);
  document.getElementById('layers').append(el);
  setTimeout(() => el.remove(), 4500);
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

export function field(label, control, hint) {
  return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), control, hint && h('span', { class: 'field-hint' }, hint));
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
