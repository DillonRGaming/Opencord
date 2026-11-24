import { withMenu } from '../contextMenu.js';
import { userMenu } from '../menus.js';
import * as api from '../api.js';
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { state, on, emit, remember, memberRoles, roleColor } from '../store.js';
import { avatar, statusOf, STATUS_LABELS, skeletonRows } from '../ui.js';
import { openProfile } from './profile.js';

let list = null;
let serverId = null;
let query = '';

function memberTag({ user, timeoutUntil }) {
  const server = state.servers.get(serverId);
  if (user.bot) return h('span', { class: 'member-tag bot' }, 'Bot');
  if (timeoutUntil && timeoutUntil > Date.now()) return h('span', { class: 'member-tag timeout', title: `Timed out until ${new Date(timeoutUntil).toLocaleString()}` }, icon('clock', 12));
  if (server?.ownerId === user.id) return h('span', { class: 'member-tag' }, 'Owner');
  if (server?.adminIds?.includes(user.id)) return h('span', { class: 'member-tag' }, 'Admin');
  return null;
}

function memberRow(member, online) {
  const { user } = member;
  return withMenu(h('button', {
    type: 'button', class: `nav-item member${online ? '' : ' offline'}`,
    onclick: () => openProfile(user, { serverId }),
  }, avatar(user, { size: 36, presence: true }),
  h('span', { class: 'nav-label', style: roleColor(serverId, user.id) ? { color: roleColor(serverId, user.id) } : null }, user.displayName,
    h('span', { class: 'nav-sub' }, user.statusText || STATUS_LABELS[statusOf(user)])),
  memberTag(member)), () => userMenu(user, { serverId }));
}

function group(title, members, online) {
  if (!members.length) return [];
  return [
    h('div', { class: 'sidebar-heading' }, `${title} — ${members.length}`),
    ...members.map((m) => memberRow(m, online)),
  ];
}

function render() {
  if (!list?.isConnected) return;
  if (!state.members.has(serverId)) { list.replaceChildren(skeletonRows(10)); return; } // still loading
  const members = (state.members.get(serverId) || [])
    .filter(({ user }) => `${user.displayName}\n${user.username}`.toLowerCase().includes(query))
    .sort((a, b) => a.user.displayName.localeCompare(b.user.displayName));
  // Bots are always on.
  const people = members.filter((m) => !m.user.bot);
  const bots = members.filter((m) => m.user.bot);
  const online = people.filter((m) => state.online.has(m.user.id));
  const offline = people.filter((m) => !state.online.has(m.user.id));
  // Online people with a "show separately" role are listed under their highest such role.
  const hoisted = (state.servers.get(serverId)?.roles || []).filter((r) => r.hoist);
  const topHoist = (m) => memberRoles(serverId, m.user.id).find((r) => r.hoist);
  const roleGroups = hoisted.flatMap((role) => group(role.name, online.filter((m) => topHoist(m) === role), true));
  const rest = online.filter((m) => !topHoist(m));
  list.replaceChildren(...roleGroups, ...group('Online', rest, true), ...group('Bots', bots, true), ...group('Offline', offline, false));
}

// Loads a server's member list once (mentions, timeouts and the member panel all need it).
export function ensureMembers(id) {
  if (!state.members.has(id)) load(id);
}

async function load(id) {
  const members = await api.get(`/api/servers/${id}/members`).catch(() => null);
  if (!members) return;
  state.members.set(id, members);
  for (const member of members) {
    remember(member.user);
    if (member.online) state.online.add(member.user.id);
  }
  emit('members');
}

on('members presence users servers', render);
on('reload', () => { if (list?.isConnected) load(serverId); });

export function showMembers(container, id) {
  serverId = id;
  query = '';
  list = h('div', { class: 'member-list' });
  container.replaceChildren(
    h('label', { class: 'member-search' }, icon('search', 16), h('input', {
      type: 'search', placeholder: 'Search members…', 'aria-label': 'Search members',
      oninput: (event) => { query = event.target.value.trim().toLowerCase(); render(); },
    })),
    list);
  render();
  if (!state.members.has(id)) load(id);
}
