import * as api from '../api.js';
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { state, on, isUnread, isOwner, sortedDms, relationsWith } from '../store.js';
import { navigate, paths } from '../router.js';
import { attempt, avatar, iconButton, serverIcon } from '../ui.js';
import { confirmDialog, openMenu } from './modals.js';
import { openChannelModal, openInviteLink } from './serverModals.js';
import { openServerSettings } from './serverSettings.js';
import { openProfile } from './profile.js';

function navItem({ active, unread, onclick }, ...children) {
  return h('button', { type: 'button', class: `nav-item${active ? ' active' : ''}${unread ? ' unread' : ''}`, onclick }, children);
}

function homeList() {
  const { route } = state;
  const pending = relationsWith('incoming').length;
  const dms = sortedDms();
  return [
    h('div', { class: 'sidebar-header' }, h('span', { class: 'sidebar-title' }, 'Opencord')),
    h('div', { class: 'sidebar-scroll' },
      navItem({ active: route.name === 'home', onclick: () => navigate(paths.home()) },
        icon('users'), h('span', { class: 'nav-label' }, 'Friends'), pending > 0 && h('span', { class: 'badge' }, pending)),
      h('div', { class: 'sidebar-heading' }, h('span', { class: 'heading-label' }, 'Direct messages')),
      dms.length === 0 && h('p', { class: 'sidebar-empty' }, 'No conversations yet. Add a friend and say hi.'),
      dms.map((dm) => navItem({
        active: route.channelId === dm.id, unread: isUnread(dm), onclick: () => navigate(paths.dm(dm.id)),
      }, avatar(dm.recipient, { size: 32, presence: true }),
      h('span', { class: 'nav-label' }, dm.recipient.displayName,
        dm.recipient.statusText && h('span', { class: 'nav-sub' }, dm.recipient.statusText))))),
  ];
}

function serverMenu(server, anchor) {
  const owner = isOwner(server.id);
  openMenu(anchor, [
    ['Invite people', () => attempt(() => openInviteLink(server))],
    owner && ['Create channel', () => openChannelModal(server)],
    owner && ['Server settings', () => openServerSettings(server)],
    !owner && ['Leave server', () => leaveServer(server), 'danger'],
  ]);
}

async function leaveServer(server) {
  const sure = await confirmDialog({
    title: `Leave ${server.name}?`,
    text: "You won't be able to come back without a new invite.",
    confirmLabel: 'Leave server',
    danger: true,
  });
  if (sure) attempt(() => api.del(`/api/servers/${server.id}/members/@me`));
}

function serverList(server) {
  const { route } = state;
  const owner = isOwner(server.id);
  const channels = [...server.channels].sort((a, b) => a.position - b.position || (a.id < b.id ? -1 : 1));
  return [
    h('button', { type: 'button', class: 'sidebar-header', title: 'Server menu', onclick: (event) => serverMenu(server, event.currentTarget) },
      serverIcon(server, 36), h('span', { class: 'sidebar-title' }, server.name), icon('chevronDown', 18)),
    h('div', { class: 'sidebar-scroll' },
      h('div', { class: 'sidebar-heading' }, h('span', { class: 'heading-label' }, 'Channels'),
        owner && iconButton('plus', 'Create channel', () => openChannelModal(server))),
      channels.map((channel) => navItem({
        active: route.channelId === channel.id, unread: isUnread(channel),
        onclick: () => navigate(paths.channel(server.id, channel.id)),
      }, icon('hash', 14), h('span', { class: 'nav-label' }, channel.name),
      owner && h('span', {
        class: 'icon-button', role: 'button', tabIndex: 0, title: 'Edit channel',
        onclick: (event) => { event.stopPropagation(); openChannelModal(server, channel); },
      }, icon('pencil', 15))))),
  ];
}

function userPanel() {
  const { me } = state;
  return h('div', { class: 'user-panel' },
    h('button', { type: 'button', class: 'user-panel-me', title: 'Your profile', onclick: (event) => openProfile(me, event.currentTarget) },
      avatar(me, { size: 36, presence: true }),
      h('span', { class: 'user-panel-names' }, h('strong', {}, me.displayName), h('span', {}, me.statusText || `@${me.username}`))));
}

export function mountSidebar(el) {
  function render() {
    const server = state.route.name === 'server' && state.servers.get(state.route.serverId);
    el.replaceChildren(...(server ? serverList(server) : homeList()), userPanel());
  }
  on('servers dms unread route relationships me users', render);
  render();
}
