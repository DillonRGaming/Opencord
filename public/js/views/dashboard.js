// The Opencord dashboard: how many people use the app, how much they do, and how much of Cloudflare's free
// plan that would use. Only the app's owner and admins see it (an app-wide role, not a server role).
import * as api from '../api.js';
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { state } from '../store.js';
import { showNav } from '../router.js';
import { attempt, button, confirmButton, iconButton, segmented, toast } from '../ui.js';
import { formatSize, formatStamp, timeAgo } from '../format.js';

const FREE_REQUESTS_PER_DAY = 100000;
const SVG = 'http://www.w3.org/2000/svg';

let root = null;
let loading = 0;

export function canSeeDashboard() {
  return ['owner', 'admin'].includes(state.me?.appRole);
}

export async function showDashboard(container) {
  root = container;
  const ticket = ++loading;
  container.replaceChildren(header(), h('div', { class: 'page-scroll' }, h('div', { class: 'dash-page dash-loading' }, 'Loading…')));
  const data = await attempt(() => Promise.all([
    api.get('/api/admin/overview'), api.get('/api/admin/people'), api.get('/api/admin/servers'),
  ]));
  if (!data || ticket !== loading || !root?.isConnected) return;
  const [overview, people, servers] = data;
  root.replaceChildren(header(), h('div', { class: 'page-scroll' }, page(overview, people, servers)));
}

function header() {
  return h('header', { class: 'main-header' },
    iconButton('back', 'Back', () => showNav(), 'back-button'),
    h('div', { class: 'main-title' }, icon('gauge', 18), h('span', {}, 'Dashboard')),
    h('span', { class: 'main-spacer' }),
    iconButton('refresh', 'Refresh', () => showDashboard(root)));
}

const plural = (n, word) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;
const shortDay = (day) => new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });

function tile(label, value, sub) {
  return h('div', { class: 'dash-tile' },
    h('span', { class: 'dash-tile-label' }, label),
    h('strong', { class: 'dash-tile-value' }, value),
    sub && h('span', { class: 'dash-tile-sub' }, sub));
}

function card(title, note, ...children) {
  return h('section', { class: 'dash-card' },
    h('div', { class: 'dash-card-head' }, h('h2', {}, title), note && h('span', { class: 'dash-note' }, note)),
    children);
}

// A meter for "used out of the free amount".
function meter(used, limit) {
  const pct = Math.min(100, (used / limit) * 100);
  return h('div', { class: 'dash-meter', role: 'meter', 'aria-valuemin': 0, 'aria-valuemax': limit, 'aria-valuenow': used },
    h('span', { style: { width: `${Math.max(pct, 0.6)}%` } }));
}

// One series of daily bars (last 30 days), with a hover tooltip per day.
function barChart(points, unit) {
  const W = 600; const H = 150; const top = 14; const bottom = 22; const gap = 2;
  const max = Math.max(1, ...points.map((p) => p.n));
  const slot = W / points.length;
  const barW = slot - gap;
  const plotH = H - top - bottom;
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'dash-chart-svg');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `${unit} per day for the last 30 days, up to ${max.toLocaleString()} a day`);
  const el = (name, attrs) => {
    const node = document.createElementNS(SVG, name);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    svg.append(node);
    return node;
  };
  // Recessive guides: the top value and the baseline.
  el('line', { x1: 0, x2: W, y1: top, y2: top, class: 'dash-grid' });
  el('line', { x1: 0, x2: W, y1: top + plotH, y2: top + plotH, class: 'dash-axis' });
  const tip = h('div', { class: 'dash-tip', hidden: true });
  points.forEach((p, i) => {
    const x = i * slot + gap / 2;
    const hgt = p.n ? Math.max(2, (p.n / max) * plotH) : 0;
    const y = top + plotH - hgt;
    if (hgt) {
      const r = Math.min(4, barW / 2, hgt);
      el('path', {
        class: 'dash-bar',
        d: `M${x} ${top + plotH}V${y + r}q0 ${-r} ${r} ${-r}h${barW - 2 * r}q${r} 0 ${r} ${r}V${top + plotH}Z`,
      });
    }
    const hit = el('rect', { x: i * slot, y: 0, width: slot, height: H - bottom, class: 'dash-hit' });
    const show = () => {
      tip.replaceChildren(h('strong', {}, p.n.toLocaleString()), ` ${unit} · ${shortDay(p.day)}`);
      tip.hidden = false;
      tip.style.left = `${((i + 0.5) / points.length) * 100}%`;
      hit.classList.add('on');
    };
    const hide = () => { tip.hidden = true; hit.classList.remove('on'); };
    hit.addEventListener('pointerenter', show);
    hit.addEventListener('pointerleave', hide);
  });
  const labels = h('div', { class: 'dash-x' },
    h('span', {}, shortDay(points[0].day)), h('span', {}, shortDay(points[Math.floor(points.length / 2)].day)), h('span', {}, 'Today'));
  return h('div', { class: 'dash-chart' }, h('span', { class: 'dash-y' }, max.toLocaleString()), svg, tip, labels);
}

function chartCard(title, points, unit, note) {
  const total = points.reduce((sum, p) => sum + p.n, 0);
  return card(title, note || `${total.toLocaleString()} in 30 days`, barChart(points, unit));
}

function roleBadge(role) {
  return role && h('span', { class: `dash-role ${role}` }, role === 'owner' ? 'Owner' : 'Admin');
}

// Time left until midnight UTC, when Cloudflare's daily allowances start over.
function untilReset() {
  const now = new Date();
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  const mins = Math.round((next - now) / 60000);
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

const per = (ms) => (ms >= 86400000 ? 'a day' : ms >= 3600000 ? 'an hour' : ms >= 60000 ? `${ms / 60000} min` : `${ms / 1000} s`);
const limitValue = (l) => (l.unit === 'bytes' ? formatSize(l.value) : l.value.toLocaleString());

// Every limit, its value, and how often it stopped someone. Ones that fired today stand out.
function limitsTable(limits) {
  const rows = [
    ...limits.rates.map((l) => ({ ...l, value: `${l.limit.toLocaleString()} per ${per(l.windowMs)}` })),
    ...limits.sizes.map((l) => ({ ...l, value: limitValue(l) })),
  ];
  return h('div', { class: 'dash-table-wrap' }, h('table', { class: 'dash-table' },
    h('thead', {}, h('tr', {}, h('th', {}, 'Limit'), h('th', {}, 'Allowed'), h('th', { class: 'num' }, 'Hit today'), h('th', { class: 'num' }, 'Last 7 days'))),
    h('tbody', {}, rows.map((l) => h('tr', { class: l.hitsToday ? 'dash-hot' : '' },
      h('td', {}, l.label), h('td', {}, l.value),
      h('td', { class: 'num' }, l.hitsToday ? l.hitsToday.toLocaleString() : '—'),
      h('td', { class: 'num' }, l.hitsWeek ? l.hitsWeek.toLocaleString() : '—'))))));
}

// Who may make an account. Only the owner can change it.
function registrationCard(mode) {
  const owner = state.me.appRole === 'owner';
  const explain = {
    open: 'Anyone can make an account (still limited to 3 a day per network and 30 an hour overall).',
    invite: 'Only people with a server invite can make an account. They join that server straight away.',
    closed: 'Nobody can make an account. People who already have one can still log in.',
  };
  const note = h('p', { class: 'dash-muted' }, explain[mode]);
  const control = owner
    ? segmented([['open', 'Open'], ['invite', 'Invite only'], ['closed', 'Closed']], mode, async (next) => {
      if (await attempt(() => api.put('/api/admin/registration', { mode: next }))) {
        note.textContent = explain[next];
        toast('Sign-ups updated.', 'ok');
      }
    })
    : h('strong', {}, { open: 'Open', invite: 'Invite only', closed: 'Closed' }[mode]);
  return card('Sign-ups', owner ? null : 'only the owner can change this', control, note);
}

// What running out of each free allowance looks like, in plain words.
function runningOutCard(storage, requestsToday) {
  const item = (title, text) => h('li', {}, h('strong', {}, title), ' ', text);
  return card('If limits run out', `daily allowances reset in ${untilReset()}`,
    h('ul', { class: 'dash-list' },
      item('Requests (100,000 a day):', `the site stops answering until midnight UTC. Nothing is lost and nothing is billed. ${requestsToday.toLocaleString()} used today.`),
      item('Storage (5 GB):', `uploads stop at 4 GB with a clear message, so messages always have room. ${formatSize(storage.usedBytes)} used.`),
      item('Per-person limits:', 'the one person gets "slow down" or "you\'ve used your space", everyone else is unaffected.'),
      item('Abuse:', 'suspend the account below. It\'s logged out everywhere at once.')));
}

function peopleTable(people) {
  const owner = state.me.appRole === 'owner';
  const today = new Date().toISOString().slice(0, 10);
  const lastActive = (day) => {
    if (!day) return '—';
    return day === today ? 'Today' : shortDay(day);
  };
  const me = state.me;
  const canSuspend = (p) => p.id !== me.id && p.appRole !== 'owner' && (p.appRole !== 'admin' || me.appRole === 'owner');
  async function setSuspended(person, suspended) {
    if (!await attempt(() => api.put(`/api/admin/people/${person.id}/suspension`, { suspended }))) return;
    toast(suspended ? `${person.displayName} is suspended.` : `${person.displayName} can log in again.`, 'ok');
    showDashboard(root);
  }
  async function setRole(person, role) {
    const done = await attempt(() => api.put(`/api/admin/people/${person.id}/role`, { role }));
    if (!done) return;
    toast(role ? `${person.displayName} is now an admin.` : `${person.displayName} is no longer an admin.`, 'ok');
    showDashboard(root);
  }
  return h('div', { class: 'dash-table-wrap' }, h('table', { class: 'dash-table' },
    h('thead', {}, h('tr', {},
      h('th', {}, 'Person'), h('th', {}, 'Joined'), h('th', {}, 'Last active'),
      h('th', { class: 'num' }, 'Messages'), h('th', { class: 'num' }, 'Uploads'), h('th', { class: 'num' }, 'Servers'),
      h('th', {}, ''))),
    h('tbody', {}, people.map((p) => h('tr', {},
      h('td', {}, h('div', { class: 'dash-person' },
        h('span', {}, p.displayName, roleBadge(p.appRole), p.suspendedAt && h('span', { class: 'dash-role suspended', title: p.suspendedReason || '' }, 'Suspended')),
        h('span', { class: 'dash-muted' }, `@${p.username}`))),
      h('td', { title: formatStamp(p.joinedAt) }, timeAgo(p.joinedAt)),
      h('td', {}, lastActive(p.lastActiveDay)),
      h('td', { class: 'num' }, p.messages.toLocaleString()),
      h('td', { class: 'num' }, p.uploadBytes ? formatSize(p.uploadBytes) : '—'),
      h('td', { class: 'num' }, p.servers.toLocaleString()),
      h('td', {}, h('div', { class: 'dash-actions' },
        owner && p.appRole !== 'owner' && !p.suspendedAt && (p.appRole === 'admin'
          ? button('Remove admin', () => setRole(p, null), 'ghost small')
          : button('Make admin', () => setRole(p, 'admin'), 'ghost small')),
        canSuspend(p) && (p.suspendedAt
          ? button('Unsuspend', () => setSuspended(p, false), 'ghost small')
          : confirmButton({
            label: 'Suspend', confirmLabel: 'Suspend?', className: 'button ghost small danger',
            onConfirm: () => setSuspended(p, true),
          })))))))));
}

function serverTable(servers) {
  if (!servers.length) return h('p', { class: 'dash-muted' }, 'No servers yet.');
  return h('div', { class: 'dash-table-wrap' }, h('table', { class: 'dash-table' },
    h('thead', {}, h('tr', {}, h('th', {}, 'Server'), h('th', { class: 'num' }, 'Members'), h('th', { class: 'num' }, 'Messages this week'), h('th', {}, 'Made'))),
    h('tbody', {}, servers.map((s) => h('tr', {},
      h('td', {}, s.name), h('td', { class: 'num' }, s.members.toLocaleString()),
      h('td', { class: 'num' }, s.messagesWeek.toLocaleString()), h('td', { title: formatStamp(s.createdAt) }, timeAgo(s.createdAt)))))));
}

function page(o, people, servers) {
  const { totals, active, retention, storage, days } = o;
  const requestsToday = days.requests.at(-1).n;
  const since = o.trackingSince ? `Counting active people since ${shortDay(o.trackingSince)}.` : 'Active people are counted from now on.';
  return h('div', { class: 'dash-page' },
    h('div', { class: 'dash-tiles' },
      tile('Online now', active.now.toLocaleString(), 'have Opencord open'),
      tile('Active today', active.today.toLocaleString(), 'used it since midnight UTC'),
      tile('This week', active.week.toLocaleString(), 'active in the last 7 days'),
      tile('This month', active.month.toLocaleString(), 'active in the last 30 days'),
      tile('People', totals.people.toLocaleString(), `${plural(totals.bots, 'bot')}${o.suspended ? ` · ${o.suspended} suspended` : ''}`),
      tile('Came back', retention.joinedBefore ? `${retention.cameBack} of ${retention.joinedBefore}` : '—', 'used it again after the day they joined')),
    h('p', { class: 'dash-note dash-since' }, since),
    h('div', { class: 'dash-grid-2' },
      card('Storage', `${formatSize(storage.usedBytes)} of ${formatSize(storage.freePlanBytes)} free`,
        meter(storage.usedBytes, storage.freePlanBytes),
        h('div', { class: 'dash-facts' },
          h('span', {}, h('strong', {}, plural(totals.files, 'file')), ` · ${formatSize(totals.fileBytes)}`),
          h('span', {}, h('strong', {}, plural(totals.messages, 'message'))),
          h('span', {}, h('strong', {}, plural(totals.servers, 'server'))))),
      card('Requests today', `${requestsToday.toLocaleString()} of ${FREE_REQUESTS_PER_DAY.toLocaleString()} free`,
        meter(requestsToday, FREE_REQUESTS_PER_DAY),
        h('p', { class: 'dash-muted' }, 'API and media requests since midnight UTC. Cloudflare\'s free plan stops (it never bills) after 100,000 a day.'))),
    h('div', { class: 'dash-grid-2' }, runningOutCard(storage, requestsToday), registrationCard(o.registration)),
    card('Limits', `${o.limits.rates.concat(o.limits.sizes).filter((l) => l.hitsToday).length} hit today`, limitsTable(o.limits)),
    h('div', { class: 'dash-grid-2' },
      chartCard('Active people', days.active, 'active'),
      chartCard('Messages', days.messages, 'messages'),
      chartCard('Sign-ups', days.signups, 'sign-ups'),
      chartCard('Requests', days.requests, 'requests')),
    card('People', plural(people.length, 'account'), peopleTable(people)),
    card('Busiest servers', 'by messages in the last 7 days', serverTable(servers)));
}
