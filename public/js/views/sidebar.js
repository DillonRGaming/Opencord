import { withMenu, showMenu } from '../contextMenu.js';
import { setMe } from '../actions.js';
import { categoryMenu, channelMenu, dmMenu, serverMenu } from '../menus.js';
import * as api from '../api.js';
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { state, on, isUnread, canModerate, sortedDms, relationsWith, dmName, dmPeople } from '../store.js';
import { navigate, paths } from '../router.js';
import { attempt, avatar, confirmButton, iconButton } from '../ui.js';
import { voice, isSpeaking, leaveVoice } from '../voice.js';
import { openChannelPage, openInviteLink } from './serverPages.js';
import { openServerSettings } from './serverSettings.js';
import { openProfile } from './profile.js';
import { openSettings } from './settings.js';
import { openNotifications } from './notifications.js';
import { openNewGroup } from './groups.js';

// The server whose action list (under its name) is folded open, if any.
let actionsFor = null;
let redraw = () => {};

// Folded categories survive reloads.
const folded = new Set((() => {
  try { return JSON.parse(localStorage.getItem('oc_folded') || '[]'); } catch { return []; }
})());
function toggleFold(id) {
  if (folded.has(id)) folded.delete(id); else folded.add(id);
  try { localStorage.setItem('oc_folded', JSON.stringify([...folded])); } catch { /* private mode */ }
  redraw();
}

function navItem({ active, unread, onclick, className = '', menu, drag }, ...children) {
  const el = h('button', { type: 'button', class: `nav-item ${className}${active ? ' active' : ''}${unread ? ' unread' : ''}`, onclick }, children);
  if (drag) drag(el);
  return menu ? withMenu(el, menu) : el;
}

// A group DM's picture: its icon, or up to two member avatars overlapping.
export function groupFace(dm, size = 32) {
  if (dm.icon) return h('span', { class: 'avatar', style: { '--size': `${size}px` } }, h('img', { class: 'avatar-face', src: dm.icon, alt: '' }));
  const people = dmPeople(dm).slice(0, 2);
  return h('span', { class: 'group-face', style: { '--size': `${size}px` } }, people.map((u) => avatar(u, { size: Math.round(size * 0.7) })));
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
      navItem({ onclick: () => openNotifications() },
        icon('bell', 18), h('span', { class: 'nav-label' }, 'Notifications'),
        state.unreadNotifications > 0 && h('span', { class: 'badge' }, state.unreadNotifications > 99 ? '99+' : state.unreadNotifications)),
      h('div', { class: 'sidebar-heading' }, h('span', { class: 'heading-label' }, 'Direct messages'),
        iconButton('plus', 'New group', () => openNewGroup())),
      dms.map((dm) => {
        const group = dm.kind === 'group';
        const sub = group ? `${dmPeople(dm).length + 1} members` : dm.recipient.statusText;
        return navItem({
          active: route.channelId === dm.id, unread: isUnread(dm), onclick: () => navigate(paths.dm(dm.id)), menu: () => dmMenu(dm),
        }, group ? groupFace(dm) : avatar(dm.recipient, { size: 32, presence: true }),
        h('span', { class: 'nav-label' }, dmName(dm), sub && h('span', { class: 'nav-sub' }, sub)));
      })),
  ];
}

// What the server name opens: a short list folded out right under it, instead of a dropdown.
function serverActions(server) {
  const mod = canModerate(server.id);
  const owner = server.ownerId === state.me.id;
  const action = (props, ...children) => navItem({ ...props, onclick: () => { actionsFor = null; redraw(); props.onclick(); } }, ...children);
  return h('div', { class: 'server-actions' },
    action({ onclick: () => attempt(() => openInviteLink(server)) }, icon('userPlus', 18), h('span', { class: 'nav-label' }, 'Invite people')),
    mod && action({ onclick: () => openChannelPage(server) }, icon('plus', 18), h('span', { class: 'nav-label' }, 'New channel')),
    mod && action({ onclick: () => openChannelPage(server, null, { kind: 'category' }) }, icon('folder', 18), h('span', { class: 'nav-label' }, 'New category')),
    mod && action({ onclick: () => openServerSettings(server) }, icon('settings', 18), h('span', { class: 'nav-label' }, 'Server settings')),
    !owner && confirmButton({
      label: 'Leave server', confirmLabel: 'Click again to leave', className: 'nav-item danger',
      face: [icon('logout', 18), h('span', { class: 'nav-label' }, 'Leave server')],
      onConfirm: () => { actionsFor = null; return api.del(`/api/servers/${server.id}/members/@me`); },
    }));
}

// --- drag and drop to reorder channels (admins and owner) ---

let dragging = null;

function sortChannels(server) {
  return [...server.channels].sort((a, b) => a.position - b.position || (a.id < b.id ? -1 : 1));
}

// Builds the new order: `moved` goes before `target` (or into `category`, at its end) and saves it.
function moveChannel(server, movedId, { beforeId = null, categoryId = undefined }) {
  const all = sortChannels(server);
  const moved = all.find((c) => c.id === movedId);
  if (!moved || movedId === beforeId) return;
  const rest = all.filter((c) => c.id !== movedId);
  let parentId = moved.parentId;
  let index;
  if (beforeId) {
    const target = rest.find((c) => c.id === beforeId);
    index = rest.indexOf(target);
    parentId = moved.kind === 'category' ? null : (target.kind === 'category' ? null : target.parentId);
  } else {
    parentId = categoryId ?? null;
    const last = rest.findLastIndex((c) => (categoryId ? c.parentId === categoryId || c.id === categoryId : !c.parentId && c.kind !== 'category'));
    index = last + 1;
  }
  rest.splice(index, 0, { ...moved, parentId });
  attempt(() => api.put(`/api/servers/${server.id}/channels/order`, { items: rest.map((c) => ({ id: c.id, parentId: c.kind === 'category' ? null : c.parentId || null })) }));
}

function draggable(server, channel) {
  if (!canModerate(server.id)) return null;
  return (el) => {
    el.draggable = true;
    el.addEventListener('dragstart', (event) => { dragging = channel.id; event.dataTransfer.effectAllowed = 'move'; el.classList.add('dragging'); });
    el.addEventListener('dragend', () => { dragging = null; el.classList.remove('dragging'); });
    el.addEventListener('dragover', (event) => { if (dragging && dragging !== channel.id) { event.preventDefault(); el.classList.add('drop-target'); } });
    el.addEventListener('dragleave', () => el.classList.remove('drop-target'));
    el.addEventListener('drop', (event) => {
      event.preventDefault();
      el.classList.remove('drop-target');
      const moved = server.channels.find((c) => c.id === dragging);
      if (!moved) return;
      if (channel.kind === 'category' && moved.kind !== 'category') moveChannel(server, dragging, { categoryId: channel.id });
      else moveChannel(server, dragging, { beforeId: channel.id });
    });
  };
}

function voiceUsers(channelId) {
  const people = state.voice.get(channelId) || [];
  if (!people.length) return null;
  return h('div', { class: 'voice-users' }, people.map((p) => {
    const user = state.users.get(p.userId) || { id: p.userId, displayName: 'Someone', username: '' };
    return h('button', {
      type: 'button', class: `voice-user${p.speaking && !p.muted ? ' speaking' : ''}`, onclick: () => openProfile(user),
    }, avatar(user, { size: 24 }), h('span', { class: 'voice-user-name' }, user.displayName),
    h('span', { class: 'voice-user-icons' },
      (p.video || p.screen) && h('span', { class: 'live-tag' }, p.screen ? 'LIVE' : icon('video', 13)),
      p.deafened ? icon('headphonesOff', 14) : p.muted ? icon('micOff', 14) : null));
  }));
}

function channelRow(server, channel) {
  const { route } = state;
  const mod = canModerate(server.id);
  const isVoice = channel.kind === 'voice';
  const connected = voice.channelId === channel.id;
  const row = navItem({
    active: route.channelId === channel.id,
    className: `${isVoice ? 'voice-channel' : ''}${connected ? ' connected' : ''}`,
    unread: !isVoice && isUnread(channel),
    onclick: () => navigate(paths.channel(server.id, channel.id)),
    menu: () => channelMenu(server, channel),
    drag: draggable(server, channel),
  }, icon(isVoice ? 'volume' : channel.readOnly ? 'lock' : 'hash', 18), h('span', { class: 'nav-label' }, channel.name),
  mod && h('span', {
    class: 'icon-button', role: 'button', tabIndex: 0, title: 'Edit channel', 'aria-label': `Edit ${channel.name}`,
    onclick: (event) => { event.stopPropagation(); openChannelPage(server, channel); },
  }, icon('pencil', 15)));
  return isVoice ? [row, voiceUsers(channel.id)] : row;
}

function serverList(server) {
  const open = actionsFor === server.id;
  const mod = canModerate(server.id);
  const all = sortChannels(server);
  const categories = all.filter((c) => c.kind === 'category');
  const loose = all.filter((c) => c.kind !== 'category' && !categories.some((cat) => cat.id === c.parentId));

  const categoryBlock = (category) => {
    const children = all.filter((c) => c.parentId === category.id && c.kind !== 'category');
    const isFolded = folded.has(category.id);
    const header = h('div', { class: `sidebar-heading category${isFolded ? ' folded' : ''}` },
      h('button', { type: 'button', class: 'category-toggle', onclick: () => toggleFold(category.id) },
        icon('chevronDown', 14), h('span', { class: 'heading-label' }, category.name)),
      mod && iconButton('plus', `New channel in ${category.name}`, () => openChannelPage(server, null, { parentId: category.id })));
    withMenu(header, () => categoryMenu(server, category));
    draggable(server, category)?.(header);
    // A folded category still shows the open channel and any voice room you're in.
    const shown = isFolded ? children.filter((c) => c.id === state.route.channelId || c.id === voice.channelId) : children;
    return [header, shown.map((c) => channelRow(server, c))];
  };

  const head = withMenu(h('button', {
    type: 'button', class: 'sidebar-header', 'aria-expanded': String(open),
    onclick: () => { actionsFor = open ? null : server.id; redraw(); },
  }, h('span', { class: 'sidebar-title' }, server.name), icon('chevronDown', 18)), () => serverMenu(server));
  // The banner (a picture, or just the banner colour) sits across the top with the name over it.
  const banner = (server.banner || server.bannerColor) && h('div', {
    class: 'server-banner',
    style: { backgroundColor: server.bannerColor || 'var(--bg-raised)', backgroundImage: server.banner ? `url("${server.banner}")` : null },
  }, head);
  return [
    banner || head,
    open && serverActions(server),
    h('div', { class: 'sidebar-scroll' },
      loose.length > 0 && h('div', { class: 'sidebar-heading' }, h('span', { class: 'heading-label' }, 'Channels'),
        mod && iconButton('plus', 'New channel', () => openChannelPage(server))),
      loose.map((c) => channelRow(server, c)),
      categories.map(categoryBlock)),
  ];
}

// Clicking your name: pick a status, or go to your profile.
function statusMenu(event) {
  const box = event.currentTarget.getBoundingClientRect();
  const choose = (presence) => attempt(async () => setMe(await api.patch('/api/users/@me', { presence })));
  const current = state.me.presence || 'online';
  showMenu({ clientX: box.left, clientY: box.top - 250, preventDefault() {}, stopPropagation() {} }, [
    ...[['online', 'Online'], ['idle', 'Idle'], ['dnd', 'Do not disturb'], ['invisible', 'Invisible']].map(([value, label]) => ({
      label: current === value ? `${label}  ✓` : label, dot: value === 'invisible' ? 'offline' : value, onClick: () => choose(value),
    })),
    '-',
    { label: state.me.statusText ? 'Change custom status' : 'Set a custom status', icon: 'pencil', onClick: () => openSettings('profile') },
    { label: 'Your profile', icon: 'user', onClick: () => openProfile(state.me) },
  ]);
}

// While you're in a call your picture gets a thin green ring, which lights up fully while you talk.
// No call panel: the channel itself is green in the list, and there's a small hang-up button.
function userPanel() {
  const { me } = state;
  const call = voice.channelId && !voice.connecting
    && state.servers.get(voice.serverId)?.channels.find((c) => c.id === voice.channelId);
  const face = avatar(me, { size: 34, presence: true });
  if (call) {
    face.classList.add('in-call');
    face.classList.toggle('speaking', isSpeaking());
  }
  return h('div', { class: 'user-panel' },
    h('button', { type: 'button', class: 'user-panel-me', title: call ? `In voice: ${call.name}` : 'Set your status', onclick: statusMenu },
      face,
      h('span', { class: 'user-panel-names' }, h('strong', {}, me.displayName),
        h('span', {}, call ? h('span', { class: 'in-call-text' }, `In ${call.name}`) : me.statusText || `@${me.username}`))),
    call && iconButton('phoneOff', 'Leave voice', () => leaveVoice(), 'leave-call'),
    iconButton('settings', 'Settings', () => openSettings()));
}

on('voice:speaking', () => {
  document.querySelector('.user-panel .avatar.in-call')?.classList.toggle('speaking', isSpeaking());
});

export function mountSidebar(el) {
  redraw = () => {
    const server = state.route.name === 'server' && state.servers.get(state.route.serverId);
    if (actionsFor && actionsFor !== server?.id) actionsFor = null;
    el.replaceChildren(...[(server ? serverList(server) : homeList()), userPanel()].flat().filter(Boolean));
  };
  on('servers dms unread route relationships me users voice notifications', redraw);
  redraw();
}
