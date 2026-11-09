import { h } from './dom.js';

// --- light markdown: **bold**, *italic*, ~~strike~~, `code`, ``` blocks ```, links ---
// Everything is built as DOM nodes; user text only ever lands in text nodes.

const BLOCK = /```(?:[a-z0-9+#-]*\n)?([\s\S]*?)```/gi;
const INLINE = /`([^`\n]+)`|\*\*(.+?)\*\*|~~(.+?)~~|\*(.+?)\*|(https?:\/\/[^\s<>]+)/g;

export function renderMarkdown(text) {
  const fragment = document.createDocumentFragment();
  let last = 0;
  for (const match of text.matchAll(BLOCK)) {
    appendInline(fragment, text.slice(last, match.index));
    fragment.append(h('pre', {}, h('code', {}, match[1].replace(/\n$/, ''))));
    last = match.index + match[0].length;
  }
  appendInline(fragment, text.slice(last));
  return fragment;
}

function appendInline(parent, text) {
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    parent.append(text.slice(last, match.index));
    const [whole, code, bold, strike, italic, url] = match;
    if (code) parent.append(h('code', {}, code));
    else if (bold) parent.append(nested('strong', bold));
    else if (strike) parent.append(nested('s', strike));
    else if (italic) parent.append(nested('em', italic));
    else parent.append(...link(url));
    last = match.index + whole.length;
  }
  parent.append(text.slice(last));
}

function nested(tag, text) {
  const el = h(tag);
  appendInline(el, text);
  return el;
}

// Punctuation right after a link belongs to the sentence, not the link.
function link(url) {
  const trailing = /[.,!?;:)\]'"]+$/.exec(url)?.[0] || '';
  const href = url.slice(0, url.length - trailing.length);
  return [h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, href), trailing];
}

// --- times and sizes ---

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const dateFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const dayFormat = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

export const formatTime = (ms) => timeFormat.format(ms);
export const formatDay = (ms) => dayFormat.format(ms);
export const formatDate = (ms) => dateFormat.format(ms);

export function sameDay(a, b) {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

export function formatStamp(ms) {
  const now = Date.now();
  if (sameDay(ms, now)) return `Today at ${formatTime(ms)}`;
  if (sameDay(ms, now - 86400000)) return `Yesterday at ${formatTime(ms)}`;
  return `${formatDate(ms)} ${formatTime(ms)}`;
}

export function formatSize(bytes) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? value : value.toFixed(value < 10 ? 2 : 1)} ${units[unit]}`;
}
