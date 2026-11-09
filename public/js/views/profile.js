import * as api from '../api.js';
import { h } from '../dom.js';
import { state, isOwner } from '../store.js';
import * as actions from '../actions.js';
import { attempt, button } from '../ui.js';
import { confirmDialog, onEscape, place } from './modals.js';
import { profileCard } from './profileCard.js';
import { openSettings } from './settings.js';

function friendButton(user, close) {
  const status = state.relationships.get(user.id)?.status;
  const run = (action) => () => { close(); attempt(action); };
  if (status === 'friend') return button('Remove friend', run(() => actions.removeRelation(user.id)), 'ghost small');
  if (status === 'incoming') return button('Accept request', run(() => actions.acceptFriend(user.id)), 'ghost small');
  if (status === 'outgoing') return button('Cancel request', run(() => actions.removeRelation(user.id)), 'ghost small');
  if (status === 'blocked') return null;
  return button('Add friend', run(() => actions.sendFriendRequest(user.username)), 'ghost small');
}

async function kick(user, serverId) {
  const sure = await confirmDialog({
    title: `Kick ${user.displayName}?`,
    text: 'They can join again with an invite link.',
    confirmLabel: 'Kick',
    danger: true,
  });
  if (sure) attempt(() => api.del(`/api/servers/${serverId}/members/${user.id}`));
}

function buttonsFor(user, serverId, close) {
  if (user.id === state.me.id) return [button('Edit profile', () => { close(); openSettings(); }, 'primary small')];
  const blocked = state.relationships.get(user.id)?.status === 'blocked';
  const run = (action) => () => { close(); attempt(action); };
  return [
    !blocked && button('Message', run(() => actions.openDm(user.id)), 'primary small'),
    friendButton(user, close),
    blocked
      ? button('Unblock', run(() => actions.removeRelation(user.id)), 'ghost small')
      : button('Block', run(() => actions.blockUser(user.id)), 'ghost small'),
    serverId && isOwner(serverId) && button('Kick', () => { close(); kick(user, serverId); }, 'danger small'),
  ].filter(Boolean);
}

// Opens next to whatever was clicked. `serverId` adds the Kick button for the owner.
export function openProfile(user, anchor, { serverId } = {}) {
  const fresh = state.users.get(user.id) || user;
  const popout = h('div', { class: 'popout', onmousedown: (event) => { if (event.target === popout) close(); } });
  const release = onEscape(() => close());
  const onDown = (event) => { if (!popout.contains(event.target)) close(); };
  function close() {
    release();
    document.removeEventListener('mousedown', onDown, true);
    popout.remove();
  }

  popout.append(profileCard(fresh, buttonsFor(fresh, serverId, close)));
  document.getElementById('layers').append(popout);
  if (matchMedia('(min-width: 800px)').matches) place(popout, anchor, 'beside');
  setTimeout(() => document.addEventListener('mousedown', onDown, true));
}
