// Opencord's own colour picker, used everywhere a colour is chosen: a saturation × brightness square, a hue
// bar, a hex box and a row of presets. `colorField()` is the swatch button that opens it.
import { h } from './dom.js';
import { onEscape } from './escape.js';

const PRESETS = ['#ef4444', '#f97316', '#eab308', '#84cc16', '#22c55e', '#14b8a6', '#0ea5e9', '#3b82f6', '#6366f1', '#8b5cf6', '#ec4899', '#f2f2ee', '#9ca3af', '#4b5563', '#1f2937'];
const HEX = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i;

export function normalizeHex(value) {
  const m = HEX.exec(String(value || '').trim());
  if (!m) return null;
  const hex = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
  return `#${hex.toLowerCase()}`;
}

function hexToHsv(hex) {
  const n = Number.parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let hue = 0;
  if (d) {
    if (max === r) hue = ((g - b) / d) % 6;
    else if (max === g) hue = (b - r) / d + 2;
    else hue = (r - g) / d + 4;
  }
  return { h: (hue * 60 + 360) % 360, s: max ? d / max : 0, v: max };
}

function hsvToHex({ h: hue, s, v }) {
  const f = (n) => {
    const k = (n + hue / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return `#${[f(5), f(3), f(1)].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('')}`;
}

let open = null;

export function closeColorPicker() {
  if (!open) return;
  open.release();
  open.el.remove();
  document.removeEventListener('pointerdown', open.outside, true);
  const { done } = open;
  open = null;
  done?.();
}

// Drag inside an element; `move` gets the pointer position as fractions 0–1 across and down.
function dragArea(el, move) {
  el.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    el.setPointerCapture(event.pointerId);
    const at = (e) => {
      const box = el.getBoundingClientRect();
      move(Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)), Math.min(1, Math.max(0, (e.clientY - box.top) / box.height)));
    };
    at(event);
    const onMove = (e) => at(e);
    const up = () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  });
}

// Opens the picker next to `anchor`. `onInput` fires while dragging; `onChange` once when it closes with a
// new colour (or null when "None" is picked and allowed).
export function openColorPicker(anchor, { value, onInput, onChange, allowNone = false } = {}) {
  closeColorPicker();
  const start = normalizeHex(value);
  let hsv = hexToHsv(start || '#8b5cf6');
  let current = start;
  let changed = false;

  const square = h('div', { class: 'cp-square' }, h('span', { class: 'cp-knob' }));
  const hue = h('div', { class: 'cp-hue' }, h('span', { class: 'cp-knob' }));
  const preview = h('span', { class: 'cp-preview' });
  const hex = h('input', {
    class: 'cp-hex', maxLength: 7, spellcheck: false, autocapitalize: 'none', 'aria-label': 'Hex colour',
    oninput: () => {
      const next = normalizeHex(hex.value);
      if (next) set(hexToHsv(next), false);
    },
    onkeydown: (event) => { if (event.key === 'Enter') closeColorPicker(); },
  });

  function paint(updateText = true) {
    current = hsvToHex(hsv);
    square.style.setProperty('--hue', `hsl(${hsv.h} 100% 50%)`);
    square.firstChild.style.left = `${hsv.s * 100}%`;
    square.firstChild.style.top = `${(1 - hsv.v) * 100}%`;
    hue.firstChild.style.left = `${(hsv.h / 360) * 100}%`;
    hue.firstChild.style.background = `hsl(${hsv.h} 100% 50%)`;
    square.firstChild.style.background = current;
    preview.style.background = current;
    if (updateText) hex.value = current;
  }
  function set(next, updateText = true) {
    changed = true;
    hsv = next;
    paint(updateText);
    onInput?.(current);
  }

  dragArea(square, (x, y) => set({ ...hsv, s: x, v: 1 - y }));
  dragArea(hue, (x) => set({ ...hsv, h: Math.min(359.9, x * 360) }));

  const presets = h('div', { class: 'cp-presets' }, PRESETS.map((c) => h('button', {
    type: 'button', class: 'cp-preset', style: { background: c }, title: c, 'aria-label': `Colour ${c}`,
    onclick: () => set(hexToHsv(c)),
  })));
  const none = allowNone && h('button', {
    type: 'button', class: 'cp-none', onclick: () => { current = null; changed = true; closeColorPicker(); },
  }, 'None');

  const el = h('div', { class: 'color-picker', role: 'dialog', 'aria-label': 'Pick a colour' },
    square, hue, h('div', { class: 'cp-row' }, preview, hex, none), presets);
  document.body.append(el);
  paint();
  if (!start) hex.value = '';

  const a = anchor.getBoundingClientRect();
  const box = el.getBoundingClientRect();
  el.style.left = `${Math.max(8, Math.min(a.left, innerWidth - box.width - 8))}px`;
  el.style.top = `${a.bottom + 8 + box.height < innerHeight ? a.bottom + 8 : Math.max(8, a.top - box.height - 8)}px`;

  const outside = (event) => { if (!el.contains(event.target) && !anchor.contains(event.target)) closeColorPicker(); };
  document.addEventListener('pointerdown', outside, true);
  open = {
    el, outside,
    release: onEscape(closeColorPicker),
    done: () => { if (changed && current !== start) onChange?.(current); },
  };
}

// A round swatch button that opens the picker. Returns the button; `.value` holds the current colour.
export function colorField({ value = null, onChange, onInput, allowNone = false, label = 'Colour', disabled = false } = {}) {
  const el = h('button', {
    type: 'button', class: 'color-field', title: label, 'aria-label': label, disabled,
    onclick: () => openColorPicker(el, {
      value: el.value, allowNone,
      onInput: (c) => { paint(c); onInput?.(c); },
      onChange: (c) => { el.value = c; paint(c); onChange?.(c); },
    }),
  });
  const paint = (c) => {
    el.style.background = c || '';
    el.classList.toggle('empty', !c);
  };
  el.value = normalizeHex(value);
  paint(el.value);
  return el;
}
