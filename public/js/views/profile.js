import * as api from '../api.js';
import { state, on, roleOf } from '../store.js';
import * as actions from '../actions.js';
import { attempt, button, confirmButton } from '../ui.js';
import { profileCard } from './profileCard.js';
import { openPanel, refreshPanel } from './side.js';
import { openSettings } from './settings.js';

// The profile showing in the side panel right now, if any.
let showing = null;

function friendButton(user) {
  const status = state.relationships.get(user.id)?.status;
  const run = (action) => () => attempt(action);
  if (status === 'friend') {
    return confirmButton({ label: 'Remove friend', confirmLabel: 'Click again to remove', onConfirm: () => actions.removeRelation(user.id) });
  }
  if (status === 'incoming') return button('Accept request', run(() => actions.acceptFriend(user.id)), 'ghost small');
  if (status === 'outgoing') return button('Cancel request', run(() => actions.removeRelation(user.id)), 'ghost small');
  if (status === 'blocked') return null;
  return button('Add friend', run(() => actions.sendFriendRequest(user.username)), 'ghost small');
}

function buttonsFor(user, serverId, close) {
  if (user.id === state.me.id) return [button('Edit profile', () => { close(); openSettings('profile'); }, 'primary small')];
  const blocked = state.relationships.get(user.id)?.status === 'blocked';
  return [
    !blocked && button('Message', () => attempt(() => actions.openDm(user.id)), 'primary small'),
    friendButton(user),
    blocked
      ? button('Unblock', () => attempt(() => actions.removeRelation(user.id)), 'ghost small')
      : confirmButton({ label: 'Block', confirmLabel: 'Click again to block', onConfirm: () => actions.blockUser(user.id) }),
    serverId && (roleOf(serverId, state.me.id) === 'owner' || (roleOf(serverId, state.me.id) === 'admin' && roleOf(serverId, user.id) === 'member'))
      && button('Moderate', async (event) => { const { showMenu } = await import('../contextMenu.js'); const { userMenu } = await import('../menus.js'); showMenu(event, userMenu(user, { serverId }).filter((i) => i && (i === '-' || /Time out|Remove timeout|Kick|Ban|admin/i.test(i.label)))); }, 'ghost small'),
  ].filter(Boolean);
}

// Shows someone's profile in the side panel. `serverId` adds the Kick button for the server's owner.
export function openProfile(user, { serverId } = {}) {
  showing = { userId: user.id, serverId };
  const panel = openPanel({
    title: 'Profile',
    onClose: () => { showing = null; },
    build: () => {
      const fresh = state.users.get(user.id) || user;
      return profileCard(fresh, buttonsFor(fresh, serverId, () => panel.close()));
    },
  });
}

// Keep the buttons and presence right while the profile is open.
on('relationships users presence', () => { if (showing) refreshPanel(); });
