// Everything about one person, for the owner and admins: their profile with a Message button, counts, and charts
// of messages and online time by day and by hour of the day (in your own time zone).
import * as api from '../api.js';
import { h } from '../dom.js';
import { state, remember } from '../store.js';
import { attempt, avatar, button, confirmButton } from '../ui.js';
import { formatSize, formatStamp, timeAgo } from '../format.js';
import { openDm } from '../actions.js';
import { barChart, shortDay, minutesText } from '../charts.js';
import { openPage, closePage } from './page.js';
import { openProfile } from './profile.js';

const tile = (label, value, sub) => h('div', { class: 'rc-tile' },
  h('span', { class: 'rc-tile-label' }, label), h('strong', { class: 'rc-tile-value' }, String(value)), sub && h('span', { class: 'rc-sub' }, sub));

const section = (title, ...children) => h('section', { class: 'ps-section' }, h('h2', { class: 'ps-title' }, title), children);

const hourLabel = (hr) => new Date(2000, 0, 1, hr).toLocaleTimeString(undefined, { hour: 'numeric' });

// The owner can hand out admin and suspend; admins can suspend regular people.
function ownerActions(p) {
  const u = p.user;
  const me = state.me;
  if (u.id === me.id || u.bot || p.appRole === 'owner') return [];
  const reopen = () => openPersonStats(u);
  const out = [];
  if (me.appRole === 'owner' && !p.suspendedAt) {
    const admin = p.appRole === 'admin';
    out.push(button(admin ? 'Remove admin' : 'Make admin', () => attempt(async () => {
      await api.put(`/api/admin/people/${u.id}/role`, { role: admin ? null : 'admin' });
      reopen();
    }), 'ghost small'));
  }
  if (p.appRole !== 'admin' || me.appRole === 'owner') {
    out.push(p.suspendedAt
      ? button('Unsuspend', () => attempt(async () => { await api.put(`/api/admin/people/${u.id}/suspension`, { suspended: false }); reopen(); }), 'ghost small')
      : confirmButton({
        label: 'Suspend', confirmLabel: 'Suspend?', className: 'button ghost small danger',
        onConfirm: () => attempt(async () => { await api.put(`/api/admin/people/${u.id}/suspension`, { suspended: true }); reopen(); }),
      }));
  }
  return out;
}

function body(p) {
  const u = p.user;
  const c = p.counts;
  const badges = [p.appRole === 'owner' && 'Owner', p.appRole === 'admin' && 'Admin', p.suspendedAt && 'Suspended', u.bot && 'Bot'].filter(Boolean);
  const hours = (values, unit, format) => barChart(values.map((n, hr) => ({ label: hourLabel(hr), n })), {
    unit, format, ticks: [hourLabel(0), hourLabel(6), hourLabel(12), hourLabel(18), hourLabel(23)],
  });
  return h('div', { class: 'ps' },
    h('header', { class: 'ps-head' },
      avatar(u, { size: 88, presence: true }),
      h('div', { class: 'ps-names' },
        h('div', { class: 'ps-name' }, u.displayName, badges.map((b) => h('span', { class: 'ps-badge' }, b))),
        h('div', { class: 'rc-sub' }, `@${u.username} · ${p.online ? 'online now' : p.lastSeen ? `last online ${timeAgo(p.lastSeen)}` : 'offline'}`),
        u.statusText && h('div', { class: 'ps-status' }, u.statusText)),
      h('div', { class: 'ps-actions' },
        u.id !== state.me.id && !u.bot && button('Message', () => attempt(async () => { closePage(); await openDm(u.id); }), 'accent small'),
        button('Profile', () => openProfile(u), 'ghost small'),
        ...ownerActions(p))),
    h('div', { class: 'rc-tiles' },
      tile('Messages', c.messages.toLocaleString(), `${c.messagesThisMonth.toLocaleString()} in the last 30 days`),
      tile('Online', minutesText(c.onlineMinutes), 'in the last 30 days'),
      tile('Active days', `${c.activeDays} of 30`),
      tile('Joined', timeAgo(p.joinedAt), formatStamp(p.joinedAt)),
      tile('Friends', c.friends.toLocaleString(), `${c.dms} DMs`),
      tile('Servers', c.servers.toLocaleString(), `owns ${c.serversOwned}`),
      tile('Uploads', c.uploads.toLocaleString(), formatSize(c.uploadBytes)),
      tile('Reactions', c.reactions.toLocaleString(), 'given'),
      tile('In servers / DMs', `${c.messagesInServers.toLocaleString()} / ${c.messagesInDms.toLocaleString()}`, 'messages'),
      tile('Logged in on', `${c.sessions}`, c.sessions === 1 ? 'device or browser' : 'devices or browsers')),
    h('div', { class: 'ps-grid' },
      section('Messages per day', barChart(p.messagesPerDay.map((d) => ({ label: shortDay(d.day), n: d.n })), { unit: 'messages' })),
      section('Time online per day', barChart(p.onlinePerDay.map((d) => ({ label: shortDay(d.day), n: d.n })), { unit: 'online', format: minutesText })),
      section('Messages by time of day', hours(p.messagesByHour, 'messages')),
      section('Online by time of day', hours(p.onlineByHour, 'online', minutesText))),
    h('div', { class: 'ps-grid' },
      section('Recent sessions', p.recentSessions.length ? h('table', { class: 'rc-table' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Came online'), h('th', { class: 'num' }, 'For'))),
        h('tbody', {}, p.recentSessions.map((s) => h('tr', {},
          h('td', { title: formatStamp(s.start) }, formatStamp(s.start)),
          h('td', { class: 'num' }, s.end ? minutesText((s.end - s.start) / 60000) : 'still online')))))
        : h('p', { class: 'rc-sub' }, 'No sessions recorded yet.')),
      section('Where they talk', p.topPlaces.length ? h('table', { class: 'rc-table' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Place'), h('th', { class: 'num' }, 'Messages'))),
        h('tbody', {}, p.topPlaces.map((t) => h('tr', {}, h('td', {}, t.name), h('td', { class: 'num' }, t.n.toLocaleString())))))
        : h('p', { class: 'rc-sub' }, 'No messages yet.'))),
    h('p', { class: 'rc-sub' }, 'Days and hours are in your time zone. Online time is counted from when tracking started.'));
}

export async function openPersonStats(user) {
  const holder = h('div', { class: 'ps-loading' }, 'Loading…');
  openPage({ title: user.displayName, content: holder });
  const p = await attempt(() => api.get(`/api/admin/people/${user.id}?tz=${new Date().getTimezoneOffset()}`));
  if (!p || !holder.isConnected) return;
  remember(p.user);
  holder.replaceWith(body(p));
}
