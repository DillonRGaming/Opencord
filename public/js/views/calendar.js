// A calendar channel: a month of days with the events on them, and a list beside it of the day you picked
// (or what's coming up). Each event says who's going, and you answer Going / Maybe / Can't.
import * as api from '../api.js';
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { state, on, canModerate } from '../store.js';
import { showNav } from '../router.js';
import { attempt, avatar, button, confirmButton, field, form, iconButton, settingRow, settingsCard } from '../ui.js';
import { openPage } from './page.js';
import { ensureMembers } from './members.js';

let view = null; // { root, channel, serverId, events: Map, month: Date (1st of it), day: 'YYYY-MM-DD' or null, loaded }

const DAY_MS = 86_400_000;
const pad = (n) => String(n).padStart(2, '0');
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const timeFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const longDay = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
const monthName = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' });
const weekdayShort = new Intl.DateTimeFormat(undefined, { weekday: 'short' });

export function closeCalendar() {
  view = null;
}

const canAdd = () => !view.channel.readOnly || canModerate(view.serverId);
const canEdit = (event) => event.creatorId === state.me.id || canModerate(view.serverId);

function eventsOn(key) {
  return [...view.events.values()].filter((e) => {
    const start = new Date(e.startsAt);
    const end = new Date(e.endsAt || e.startsAt);
    for (let d = new Date(start.getFullYear(), start.getMonth(), start.getDate()); d <= end; d = new Date(d.getTime() + DAY_MS)) {
      if (dayKey(d) === key) return true;
    }
    return false;
  }).sort((a, b) => a.startsAt - b.startsAt);
}

function when(event) {
  if (event.allDay) return 'All day';
  const start = timeFormat.format(event.startsAt);
  return event.endsAt ? `${start} – ${timeFormat.format(event.endsAt)}` : start;
}

// --- one event ---

function rsvp(event, status) {
  const mine = Object.entries(event.rsvps).find(([, ids]) => ids.includes(state.me.id))?.[0] || null;
  return attempt(() => api.put(`/api/channels/${view.channel.id}/events/${event.id}/rsvp`, { status: mine === status ? null : status }));
}

function eventCard(event) {
  const mine = Object.entries(event.rsvps).find(([, ids]) => ids.includes(state.me.id))?.[0] || null;
  const going = event.rsvps.going.map((id) => state.users.get(id)).filter(Boolean);
  const answer = (status, label) => h('button', {
    type: 'button', class: `rsvp ${status}`, 'aria-pressed': String(mine === status), onclick: () => rsvp(event, status),
  }, label, event.rsvps[status].length > 0 && h('span', {}, event.rsvps[status].length));
  return h('article', { class: 'event-card' },
    h('div', { class: 'event-head' },
      h('div', { class: 'event-when' }, h('strong', {}, event.title), h('span', {}, `${longDay.format(event.startsAt)} · ${when(event)}`)),
      canEdit(event) && iconButton('pencil', 'Edit event', () => openEventEditor(event))),
    event.location && h('div', { class: 'event-line' }, icon('mapPin', 14), h('span', {}, event.location)),
    event.description && h('p', { class: 'event-description' }, event.description),
    going.length > 0 && h('div', { class: 'event-going' }, h('span', { class: 'event-faces' }, going.slice(0, 6).map((u) => avatar(u, { size: 22 }))),
      h('span', {}, `${going.slice(0, 2).map((u) => u.displayName).join(', ')}${going.length > 2 ? ` and ${going.length - 2} more` : ''} going`)),
    h('div', { class: 'rsvps' }, answer('going', 'Going'), answer('maybe', 'Maybe'), answer('no', "Can't")));
}

// --- making and changing events ---

function openEventEditor(event = null, presetDay = null) {
  const start = event ? new Date(event.startsAt) : (() => {
    const d = presetDay ? new Date(`${presetDay}T00:00`) : new Date();
    d.setHours(presetDay ? 19 : Math.min(23, new Date().getHours() + 1), 0, 0, 0);
    return d;
  })();
  const end = event?.endsAt ? new Date(event.endsAt) : null;
  let allDay = Boolean(event?.allDay);
  const title = h('input', { class: 'input', required: true, maxLength: 100, value: event?.title || '', placeholder: 'Game night' });
  const date = h('input', { class: 'input', type: 'date', required: true, value: dayKey(start) });
  const startTime = h('input', { class: 'input', type: 'time', value: `${pad(start.getHours())}:${pad(start.getMinutes())}` });
  const endTime = h('input', { class: 'input', type: 'time', value: end ? `${pad(end.getHours())}:${pad(end.getMinutes())}` : '' });
  const location = h('input', { class: 'input', maxLength: 200, value: event?.location || '', placeholder: 'Where (a place, a link or a voice channel)' });
  const description = h('textarea', { class: 'textarea', maxLength: 1000, value: event?.description || '', placeholder: 'What’s happening' });
  const times = h('div', { class: 'event-times' }, field('Starts', startTime), field('Ends (optional)', endTime));
  const showTimes = () => { times.hidden = allDay; };

  const editor = form({
    submitLabel: event ? 'Save event' : 'Add event',
    onSubmit: async () => {
      const startsAt = new Date(`${date.value}T${allDay ? '00:00' : startTime.value || '00:00'}`).getTime();
      let endsAt = null;
      if (!allDay && endTime.value) {
        endsAt = new Date(`${date.value}T${endTime.value}`).getTime();
        if (endsAt < startsAt) endsAt += DAY_MS; // ends after midnight
      }
      const body = { title: title.value, description: description.value, location: location.value, startsAt, endsAt, allDay };
      if (event) await api.patch(`/api/channels/${view.channel.id}/events/${event.id}`, body);
      else await api.post(`/api/channels/${view.channel.id}/events`, body);
      view.day = date.value;
      const d = new Date(`${date.value}T00:00`);
      view.month = new Date(d.getFullYear(), d.getMonth(), 1);
      page.close();
      render();
    },
  }, field('Title', title), field('Date', date),
  settingRow('All day', h('div', { class: 'segmented' }, ['No', 'Yes'].map((label, i) => h('button', {
    type: 'button', 'aria-pressed': String(allDay === Boolean(i)),
    onclick: (e) => { allDay = Boolean(i); for (const b of e.currentTarget.parentElement.children) b.setAttribute('aria-pressed', String(b === e.currentTarget)); showTimes(); },
  }, label)))),
  times, field('Where', location), field('Details', description));
  showTimes();

  const page = openPage({
    title: event ? 'Edit event' : 'New event',
    content: h('div', { class: 'settings-content' }, settingsCard(null, editor),
      event && h('section', { class: 'settings-card danger' }, settingRow('Delete this event', confirmButton({
        label: 'Delete event', confirmLabel: 'Click again to delete',
        onConfirm: async () => { await api.del(`/api/channels/${view.channel.id}/events/${event.id}`); page.close(); },
      })))),
  });
  setTimeout(() => title.focus());
}

// --- the month and the list ---

function monthGrid() {
  const first = view.month;
  // Weeks start on Monday.
  const offset = (first.getDay() + 6) % 7;
  const start = new Date(first.getFullYear(), first.getMonth(), 1 - offset);
  const today = dayKey(new Date());
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const key = dayKey(d);
    const events = eventsOn(key);
    cells.push(h('button', {
      type: 'button',
      class: `cal-day${d.getMonth() !== first.getMonth() ? ' other' : ''}${key === today ? ' today' : ''}${key === view.day ? ' picked' : ''}${events.length ? ' busy' : ''}`,
      'aria-label': `${longDay.format(d)}${events.length ? `, ${events.length} event${events.length === 1 ? '' : 's'}` : ''}`,
      onclick: () => { view.day = view.day === key ? null : key; render(); },
      ondblclick: () => canAdd() && openEventEditor(null, key),
    }, h('span', { class: 'cal-num' }, d.getDate()),
    h('span', { class: 'cal-events' }, events.slice(0, 2).map((e) => h('span', { class: 'cal-chip' }, e.title)),
      events.length > 2 && h('span', { class: 'cal-more' }, `+${events.length - 2}`)),
    events.length > 0 && h('span', { class: 'cal-dot' })));
  }
  const names = [];
  for (let i = 0; i < 7; i++) names.push(h('span', { class: 'cal-weekday' }, weekdayShort.format(new Date(2024, 0, 1 + i))));
  const shift = (by) => { view.month = new Date(first.getFullYear(), first.getMonth() + by, 1); render(); };
  return h('section', { class: 'cal-month' },
    h('div', { class: 'cal-bar' },
      h('h2', {}, monthName.format(first)),
      iconButton('chevronLeft', 'Previous month', () => shift(-1)),
      button('Today', () => { const n = new Date(); view.month = new Date(n.getFullYear(), n.getMonth(), 1); view.day = dayKey(n); render(); }, 'ghost small'),
      iconButton('chevronRight', 'Next month', () => shift(1))),
    h('div', { class: 'cal-grid' }, names, cells));
}

function sideList() {
  if (view.day) {
    const events = eventsOn(view.day);
    return h('section', { class: 'cal-list' },
      h('div', { class: 'cal-list-head' }, h('h3', {}, longDay.format(new Date(`${view.day}T00:00`))),
        canAdd() && iconButton('plus', 'New event on this day', () => openEventEditor(null, view.day))),
      events.length ? events.map(eventCard) : h('p', { class: 'muted' }, 'Nothing on this day.'));
  }
  const now = Date.now();
  const upcoming = [...view.events.values()].filter((e) => (e.endsAt || e.startsAt + (e.allDay ? DAY_MS : 0)) >= now - 3_600_000)
    .sort((a, b) => a.startsAt - b.startsAt).slice(0, 20);
  return h('section', { class: 'cal-list' },
    h('div', { class: 'cal-list-head' }, h('h3', {}, 'Coming up')),
    upcoming.length ? upcoming.map(eventCard) : h('p', { class: 'muted' }, view.loaded ? 'No events coming up.' : 'Loading…'));
}

function render() {
  if (!view?.root.isConnected) return;
  const { channel } = view;
  const scroll = view.root.querySelector('.page-scroll')?.scrollTop || 0;
  view.root.replaceChildren(
    h('header', { class: 'main-header' },
      iconButton('back', 'Back', () => showNav(), 'back-button'),
      h('div', { class: 'main-title' }, icon('calendar', 18), h('span', {}, channel.name)),
      channel.topic ? h('div', { class: 'main-topic', title: channel.topic }, channel.topic) : h('div', { class: 'main-spacer' }),
      canAdd() && button('New event', () => openEventEditor(null, view.day), 'accent small')),
    h('div', { class: 'page-scroll' }, h('div', { class: 'calendar-page' }, monthGrid(), sideList())));
  view.root.querySelector('.page-scroll').scrollTop = scroll;
}

on('event:update', (event) => {
  if (event.channelId !== view?.channel.id) return;
  view.events.set(event.id, event);
  render();
});
on('event:delete', ({ channelId, id }) => {
  if (channelId !== view?.channel.id) return;
  view.events.delete(id);
  render();
});
on('users members', () => render());

export async function showCalendar(container, channel, serverId) {
  if (view?.channel.id === channel.id && view.root === container && container.isConnected) {
    view.channel = channel;
    return render();
  }
  const now = new Date();
  view = { root: container, channel, serverId, events: new Map(), month: new Date(now.getFullYear(), now.getMonth(), 1), day: null, loaded: false };
  ensureMembers(serverId);
  render();
  const events = await api.get(`/api/channels/${channel.id}/events`).catch(() => []);
  if (view?.channel.id !== channel.id) return undefined;
  for (const e of events) view.events.set(e.id, e);
  view.loaded = true;
  return render();
}
