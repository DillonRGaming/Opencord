import { withMenu } from '../contextMenu.js';
import { userMenu } from '../menus.js';
import { h } from '../dom.js';
import { showNav } from '../router.js';
import { icon } from '../icons.js';
import { state, on, relationsWith } from '../store.js';
import * as actions from '../actions.js';
import { attempt, avatar, button, confirmButton, iconButton } from '../ui.js';
import { openProfile } from './profile.js';

const TABS = [['online', 'Online'], ['all', 'All'], ['pending', 'Pending'], ['blocked', 'Blocked']];
const SUBTITLE = { incoming: 'Wants to be your friend', outgoing: 'Request sent', blocked: 'Blocked' };

let tab = 'online';
let root = null;
let addBox = null; // kept between renders so typing isn't lost when a friend comes online

function rowButtons({ user, status }) {
  if (status === 'friend') {
    return [
      iconButton('message', 'Message', () => attempt(() => actions.openDm(user.id))),
      confirmButton({
        label: 'Remove friend', confirmLabel: 'Remove', face: icon('x'), className: 'icon-button danger',
        onConfirm: () => actions.removeRelation(user.id),
      }),
    ];
  }
  if (status === 'incoming') {
    return [
      button('Accept', () => attempt(() => actions.acceptFriend(user.id)), 'accent small'),
      iconButton('x', 'Decline', () => attempt(() => actions.removeRelation(user.id)), 'danger'),
    ];
  }
  if (status === 'outgoing') return [iconButton('x', 'Cancel request', () => attempt(() => actions.removeRelation(user.id)), 'danger')];
  return [button('Unblock', () => attempt(() => actions.removeRelation(user.id)), 'ghost small')];
}

function row(relation) {
  const { user, status } = relation;
  return withMenu(h('div', { class: 'friend' },
    h('button', { type: 'button', class: 'friend-who', onclick: () => openProfile(user) },
      avatar(user, { size: 40, presence: status === 'friend' }),
      h('span', { class: 'friend-names' }, h('strong', {}, user.displayName),
        h('span', {}, SUBTITLE[status] || user.statusText || `@${user.username}`))),
    h('div', { class: 'friend-actions' }, rowButtons(relation))), () => userMenu(user));
}

const EMPTY = {
  online: ['No friends online', 'Friends show up here when they open Opencord.'],
  all: ['No friends yet', 'Add someone by their username above.'],
  pending: ['Nothing pending', 'Friend requests you send or get show up here.'],
  blocked: ['Nobody blocked', 'People you block show up here.'],
};

function list(heading, relations) {
  if (!relations.length) return null;
  const byName = (a, b) => a.user.displayName.localeCompare(b.user.displayName);
  return h('section', { class: 'settings-card friend-group' },
    h('h2', { class: 'settings-card-title' }, `${heading} — ${relations.length}`), relations.sort(byName).map(row));
}

function empty() {
  const [title, text] = EMPTY[tab];
  return h('div', { class: 'empty-state' }, h('span', { class: 'empty-icon' }, icon('users', 26)),
    h('strong', {}, title), h('span', {}, text));
}

// "Add a friend" sits at the top of the page, always there.
function buildAddBox() {
  const status = h('p', { class: 'add-status', role: 'status' });
  const username = h('input', {
    class: 'input', required: true, maxLength: 32, autocapitalize: 'none', spellcheck: false,
    placeholder: 'Add a friend by their username', 'aria-label': 'Username',
  });
  const send = h('button', { type: 'submit', class: 'button accent' }, icon('userPlus', 18), 'Send request');
  return h('form', {
    class: 'add-friend',
    onsubmit: async (event) => {
      event.preventDefault();
      status.className = 'add-status';
      send.disabled = true;
      try {
        const relation = await actions.sendFriendRequest(username.value.trim().replace(/^@/, ''));
        status.textContent = relation.status === 'friend'
          ? `You and ${relation.user.displayName} are now friends.`
          : `Request sent to ${relation.user.displayName}.`;
        status.classList.add('ok');
        username.value = '';
      } catch (err) {
        status.textContent = err.message;
        status.classList.add('error');
      } finally {
        send.disabled = false;
      }
    },
  }, h('div', { class: 'add-friend-row' }, h('span', { class: 'add-at' }, '@'), username, send), status);
}

function body() {
  const friends = relationsWith('friend');
  if (tab === 'online') return list('Online', friends.filter((r) => state.online.has(r.user.id)));
  if (tab === 'all') return list('All friends', friends);
  if (tab === 'blocked') return list('Blocked', relationsWith('blocked'));
  return [list('Incoming', relationsWith('incoming')), list('Sent', relationsWith('outgoing'))];
}

function bodyOrEmpty() {
  const parts = [body()].flat().filter(Boolean);
  return parts.length ? parts : empty();
}

function render() {
  // The chat view shares this container, so only draw while the friends page is the one showing.
  if (!root?.isConnected || state.route.name !== 'home') return;
  addBox ??= buildAddBox();
  const pending = relationsWith('incoming').length;
  root.replaceChildren(
    h('header', { class: 'main-header' },
      iconButton('back', 'Back', () => showNav(), 'back-button'),
      h('div', { class: 'main-title' }, icon('users', 18), h('span', {}, 'Friends')),
      h('div', { class: 'tabs', role: 'tablist' }, TABS.map(([id, label]) => h('button', {
        type: 'button', role: 'tab', class: 'tab', 'aria-selected': String(tab === id),
        onclick: () => { tab = id; render(); },
      }, label, id === 'pending' && pending > 0 && h('span', { class: 'badge' }, pending))))),
    h('div', { class: 'page-scroll' }, h('div', { class: 'friends-page' }, addBox, bodyOrEmpty())));
}

on('relationships presence users', render);

export function showFriends(container) {
  root = container;
  render();
}
