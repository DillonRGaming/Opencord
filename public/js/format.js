import { h } from './dom.js';
import { state } from './store.js';

export { renderMarkdown, mentionsMe } from './markdown.js';

// --- times and sizes ---

let timeFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

// 'auto' follows the browser's locale; '12' and '24' force a clock.
export function setClock(clock) {
  const hour12 = clock === 'auto' ? undefined : clock === '12';
  timeFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', hour12 });
}
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
