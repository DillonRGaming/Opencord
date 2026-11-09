import * as api from '../api.js';
import { h } from '../dom.js';
import { state, on, emit, remember } from '../store.js';
import { avatar } from '../ui.js';
import { openProfile } from './profile.js';

let root = null;
let serverId = null;

function memberRow(member, online) {
  const { user } = member;
  return h('button', {
    type: 'button', class: `nav-item member${online ? '' : ' offline'}`,
    onclick: (event) => openProfile(user, event.currentTarget, { serverId }),
  }, avatar(user, { size: 32, presence: true }),
  h('span', { class: 'nav-label' }, user.displayName, user.statusText && h('span', { class: 'nav-sub' }, user.statusText)));
}

function group(title, members, online) {
  if (!members.length) return [];
  return [h('div', { class: 'sidebar-heading' }, `${title} — ${members.length}`), ...members.map((m) => memberRow(m, online))];
}

function render() {
  if (!root?.isConnected) return;
  const members = [...(state.members.get(serverId) || [])]
    .sort((a, b) => a.user.displayName.localeCompare(b.user.displayName));
  const online = members.filter((m) => state.online.has(m.user.id));
  const offline = members.filter((m) => !state.online.has(m.user.id));
  root.replaceChildren(...group('Online', online, true), ...group('Offline', offline, false));
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
on('reload', () => { if (root?.isConnected) load(serverId); });

export function showMembers(container, id) {
  root = container;
  serverId = id;
  render();
  if (!state.members.has(id)) load(id);
}
