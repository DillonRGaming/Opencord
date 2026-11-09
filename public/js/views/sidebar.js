import * as api from '../api.js';
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { state, on, isUnread, isOwner, sortedDms, relationsWith } from '../store.js';
import { navigate, paths } from '../router.js';
import { attempt, avatar, confirmButton, iconButton, serverIcon } from '../ui.js';
import { openChannelPage, openInviteLink } from './serverPages.js';
import { openServerSettings } from './serverSettings.js';
import { openProfile } from './profile.js';
import { openSettings } from './settings.js';

// The server whose action list (under its name) is folded open, if any.
let actionsFor = null;
let redraw = () => {};

function navItem({ active, unread, onclick, className = '' }, ...children) {
  return h('button', { type: 'button', class: `nav-item ${className}${active ? ' active' : ''}${unread ? ' unread' : ''}`, onclick }, children);
}

function homeList() {
  const { route } = state;
  const pending = relationsWith('incoming').length;
  const dms = sortedDms();
  return [
    h('div', { class: 'sidebar-header brand' }, icon('logo', 22), h('span', { class: 'sidebar-title' }, 'Opencord')),
    h('div', { class: 'sidebar-scroll' },
      navItem({ active: route.name === 'home', onclick: () => navigate(paths.home()) },
        icon('users', 18), h('span', { class: 'nav-label' }, 'Friends'), pending > 0 && h('span', { class: 'badge' }, pending)),
      dms.length > 0 && h('div', { class: 'sidebar-heading' }, h('span', { class: 'heading-label' }, 'Direct messages')),
      dms.map((dm) => navItem({
        active: route.channelId === dm.id, unread: isUnread(dm), onclick: () => navigate(paths.dm(dm.id)),
      }, avatar(dm.recipient, { size: 32, presence: true }),
      h('span', { class: 'nav-label' }, dm.recipient.displayName,
        dm.recipient.statusText && h('span', { class: 'nav-sub' }, dm.recipient.statusText))))),
  ];
}

// What the server name opens: a short list folded out right under it, instead of a dropdown.
function serverActions(server) {
  const owner = isOwner(server.id);
  return h('div', { class: 'server-actions' },
    navItem({ onclick: () => attempt(() => openInviteLink(server)) }, icon('userPlus', 18), h('span', { class: 'nav-label' }, 'Invite people')),
    owner && navItem({ onclick: () => openChannelPage(server) }, icon('plus', 18), h('span', { class: 'nav-label' }, 'New channel')),
    owner && navItem({ onclick: () => openServerSettings(server) }, icon('settings', 18), h('span', { class: 'nav-label' }, 'Server settings')),
    !owner && confirmButton({
      label: 'Leave server', confirmLabel: 'Click again to leave', className: 'nav-item danger',
      face: [icon('logout', 18), h('span', { class: 'nav-label' }, 'Leave server')],
      onConfirm: () => api.del(`/api/servers/${server.id}/members/@me`),
    }));
}

function serverList(server) {
  const { route } = state;
  const owner = isOwner(server.id);
  const open = actionsFor === server.id;
  const channels = [...server.channels].sort((a, b) => a.position - b.position || (a.id < b.id ? -1 : 1));
  return [
    h('button', {
      type: 'button', class: 'sidebar-header', 'aria-expanded': String(open),
      onclick: () => { actionsFor = open ? null : server.id; redraw(); },
    }, h('span', { class: 'sidebar-title' }, server.name), icon('chevronDown', 18)),
    open && serverActions(server),
    h('div', { class: 'sidebar-scroll' },
      h('div', { class: 'sidebar-heading' }, h('span', { class: 'heading-label' }, 'Text channels'),
        owner && iconButton('plus', 'New channel', () => openChannelPage(server))),
      channels.map((channel) => navItem({
        active: route.channelId === channel.id, unread: isUnread(channel),
        onclick: () => navigate(paths.channel(server.id, channel.id)),
      }, icon('hash', 18), h('span', { class: 'nav-label' }, channel.name),
      owner && h('span', {
        class: 'icon-button', role: 'button', tabIndex: 0, title: 'Edit channel', 'aria-label': `Edit #${channel.name}`,
        onclick: (event) => { event.stopPropagation(); openChannelPage(server, channel); },
      }, icon('pencil', 15))))),
  ];
}

function userPanel() {
  const { me } = state;
  return h('div', { class: 'user-panel' },
    h('button', { type: 'button', class: 'user-panel-me', title: 'Your profile', onclick: () => openProfile(me) },
      avatar(me, { size: 34, presence: true }),
      h('span', { class: 'user-panel-names' }, h('strong', {}, me.displayName), h('span', {}, me.statusText || `@${me.username}`))),
    iconButton('settings', 'Settings', () => openSettings()));
}

export function mountSidebar(el) {
  redraw = () => {
    const server = state.route.name === 'server' && state.servers.get(state.route.serverId);
    if (actionsFor && actionsFor !== server?.id) actionsFor = null;
    el.replaceChildren(...(server ? serverList(server) : homeList()).filter(Boolean), userPanel());
  };
  on('servers dms unread route relationships me users', redraw);
  redraw();
}
