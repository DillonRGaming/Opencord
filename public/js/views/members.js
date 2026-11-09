import * as api from '../api.js';
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { state, on, emit, remember } from '../store.js';
import { avatar } from '../ui.js';
import { openProfile } from './profile.js';

let list = null;
let serverId = null;
let query = '';

function memberRow(member, online) {
  const { user } = member;
  return h('button', {
    type: 'button', class: `nav-item member${online ? '' : ' offline'}`,
    onclick: () => openProfile(user, { serverId }),
  }, avatar(user, { size: 36, presence: true }),
  h('span', { class: 'nav-label' }, user.displayName,
    h('span', { class: 'nav-sub' }, user.statusText || (online ? 'Online' : 'Offline'))),
  state.servers.get(serverId)?.ownerId === user.id && h('span', { class: 'member-tag' }, 'Owner'));
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
  const members = (state.members.get(serverId) || [])
    .filter(({ user }) => `${user.displayName}\n${user.username}`.toLowerCase().includes(query))
    .sort((a, b) => a.user.displayName.localeCompare(b.user.displayName));
  const online = members.filter((m) => state.online.has(m.user.id));
  const offline = members.filter((m) => !state.online.has(m.user.id));
  list.replaceChildren(...group('Online', online, true), ...group('Offline', offline, false));
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

on('members presence users', render);
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
