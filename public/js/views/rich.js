// The rich parts a bot message can carry besides buttons, drawn as real elements (the Dev server uses these):
//   { type: 'tiles', items: [{ label, value, sub }] }
//   { type: 'table', columns: [{ label, align }], rows: [[cell, …]] }
//        a cell is text, a number, { text, sub, tone: 'good' | 'bad' | 'muted' }, or { user: User, sub }
//   { type: 'chart', title, unit, format: 'minutes' | 'bytes', points: [{ label, n }] }
//   { type: 'meter', label, used, of, text }
// People in tables open their stats page for the owner and admins, and their profile for anyone else.
import { h } from '../dom.js';
import { state, remember } from '../store.js';
import { avatar } from '../ui.js';
import { formatSize } from '../format.js';
import { barChart, minutesText } from '../charts.js';
import { openProfile } from './profile.js';
import { openPersonStats } from './personStats.js';

export const RICH_TYPES = ['tiles', 'table', 'chart', 'meter'];

const FORMATS = { minutes: minutesText, bytes: (n) => formatSize(n), count: (n) => n.toLocaleString() };

function openPerson(user) {
  remember(user);
  if (['owner', 'admin'].includes(state.me?.appRole)) openPersonStats(user);
  else openProfile(user);
}

function cell(value, align) {
  if (value && typeof value === 'object' && value.user) {
    const u = value.user;
    return h('td', { class: 'rc-person-cell' }, h('button', { type: 'button', class: 'rc-person', onclick: () => openPerson(u) },
      avatar(u, { size: 28 }),
      h('span', { class: 'rc-person-text' }, h('span', { class: 'rc-person-name' }, u.displayName), h('span', { class: 'rc-sub' }, value.sub ?? `@${u.username}`))));
  }
  if (value && typeof value === 'object') {
    return h('td', { class: [align === 'right' ? 'num' : '', value.tone ? `tone-${value.tone}` : ''].join(' ').trim() },
      h('span', {}, String(value.text ?? '')), value.sub && h('span', { class: 'rc-sub' }, value.sub));
  }
  return h('td', { class: align === 'right' ? 'num' : '' }, value == null || value === '' ? '—' : String(value));
}

const VIEWS = {
  tiles: (c) => h('div', { class: 'rc-tiles' }, c.items.map((t) => h('div', { class: 'rc-tile' },
    h('span', { class: 'rc-tile-label' }, t.label), h('strong', { class: 'rc-tile-value' }, String(t.value)), t.sub && h('span', { class: 'rc-sub' }, t.sub)))),
  table: (c) => h('div', { class: 'rc-table-wrap' }, h('table', { class: 'rc-table' },
    h('thead', {}, h('tr', {}, c.columns.map((col) => h('th', { class: col.align === 'right' ? 'num' : '' }, col.label)))),
    h('tbody', {}, c.rows.map((row) => h('tr', {}, row.map((v, i) => cell(v, c.columns[i]?.align))))))),
  chart: (c) => h('div', { class: 'rc-chart' },
    c.title && h('div', { class: 'rc-chart-title' }, c.title),
    barChart(c.points, { unit: c.unit, format: FORMATS[c.format] || FORMATS.count })),
  meter: (c) => {
    const pct = c.of ? Math.min(100, (c.used / c.of) * 100) : 0;
    return h('div', { class: 'rc-meter' },
      h('div', { class: 'rc-meter-head' }, h('span', {}, c.label), h('span', { class: 'rc-sub' }, c.text)),
      h('div', { class: 'rc-meter-bar' }, h('span', { style: { width: `${Math.max(pct, pct ? 1 : 0)}%` } })));
  },
};

export function richView(component) {
  try {
    return VIEWS[component.type]?.(component) || null;
  } catch {
    return null; // a malformed part shouldn't break the whole message
  }
}
