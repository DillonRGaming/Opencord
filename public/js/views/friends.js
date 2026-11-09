import { h } from '../dom.js';
import { icon } from '../icons.js';
import { state, on, relationsWith } from '../store.js';
import * as actions from '../actions.js';
import { attempt, avatar, button, confirmButton, field, form, iconButton } from '../ui.js';
import { openProfile } from './profile.js';

const TABS = [['online', 'Online'], ['all', 'All'], ['pending', 'Pending'], ['blocked', 'Blocked'], ['add', 'Add Friend']];

let tab = 'online';
let root = null;

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
      iconButton('check', 'Accept', () => attempt(() => actions.acceptFriend(user.id)), 'ok'),
      iconButton('x', 'Decline', () => attempt(() => actions.removeRelation(user.id)), 'danger'),
    ];
  }
  if (status === 'outgoing') return [iconButton('x', 'Cancel request', () => attempt(() => actions.removeRelation(user.id)), 'danger')];
  return [button('Unblock', () => attempt(() => actions.removeRelation(user.id)), 'ghost small')];
}

const SUBTITLE = { incoming: 'Wants to be your friend', outgoing: 'Request sent', blocked: 'Blocked' };

function row(relation) {
  const { user, status } = relation;
  return h('div', { class: 'friend' },
    h('button', { type: 'button', class: 'friend-who', onclick: () => openProfile(user) },
      avatar(user, { size: 38, presence: status === 'friend' }),
      h('span', { class: 'friend-names' }, h('strong', {}, user.displayName),
        h('span', {}, SUBTITLE[status] || user.statusText || `@${user.username}`))),
    rowButtons(relation));
}

function list(heading, relations, emptyText) {
  if (!relations.length) return h('div', { class: 'empty-state' }, icon('users', 40), h('p', {}, emptyText));
  const byName = (a, b) => a.user.displayName.localeCompare(b.user.displayName);
  return h('div', { class: 'page' }, h('p', { class: 'page-heading' }, `${heading} — ${relations.length}`), relations.sort(byName).map(row));
}

function addFriend() {
  const username = h('input', { class: 'input', required: true, maxLength: 32, autocapitalize: 'none', spellcheck: false, placeholder: 'their_username' });
  const ok = h('p', { class: 'form-ok', role: 'status' });
  return h('div', { class: 'page' }, h('div', { class: 'add-friend' },
    h('h2', {}, 'Add a friend'),
    h('p', {}, `Type their username exactly. Yours is @${state.me.username}.`),
    form({
      submitLabel: 'Send friend request',
      onSubmit: async () => {
        ok.textContent = '';
        const relation = await actions.sendFriendRequest(username.value.trim().replace(/^@/, ''));
        ok.textContent = relation.status === 'friend'
          ? `You and ${relation.user.displayName} are now friends.`
          : `Request sent to ${relation.user.displayName}.`;
        username.value = '';
      },
    }, field('Username', username)), ok));
}

function body() {
  if (tab === 'add') return addFriend();
  const friends = relationsWith('friend');
  if (tab === 'online') return list('Online', friends.filter((r) => state.online.has(r.user.id)), 'None of your friends are online right now.');
  if (tab === 'all') return list('All friends', friends, 'No friends yet. Use "Add Friend" to send a request.');
  if (tab === 'blocked') return list('Blocked', relationsWith('blocked'), "You haven't blocked anyone.");
  return list('Pending', [...relationsWith('incoming'), ...relationsWith('outgoing')], 'No pending friend requests.');
}

function render() {
  // The chat view shares this container, so only draw while the friends page is the one showing.
  if (!root?.isConnected || state.route.name !== 'home') return;
  // Don't wipe the username someone is typing because a friend came online.
  if (tab === 'add' && root.querySelector('.add-friend')?.contains(document.activeElement)) return;
  const pending = relationsWith('incoming').length;
  root.replaceChildren(
    h('header', { class: 'main-header' },
      iconButton('back', 'Back', () => { document.body.dataset.panel = 'nav'; }, 'back-button'),
      h('div', { class: 'main-title' }, icon('users'), h('span', {}, 'Friends')),
      h('div', { class: 'tabs', role: 'tablist' }, TABS.map(([id, label]) => h('button', {
        type: 'button', role: 'tab', class: `tab${id === 'add' ? ' cta' : ''}`, 'aria-selected': String(tab === id),
        onclick: () => { tab = id; document.activeElement?.blur(); render(); },
      }, label, id === 'pending' && pending > 0 && h('span', { class: 'badge' }, pending))))),
    h('div', { class: 'main-body' }, body()));
}

on('relationships presence users', render);

export function showFriends(container) {
  root = container;
  render();
}
