import * as api from '../api.js';
import { state, on, roleOf, can } from '../store.js';
import { h } from '../dom.js';
import { formatStamp } from '../format.js';
import * as actions from '../actions.js';
import { attempt, button, confirmButton, iconButton, toast } from '../ui.js';
import { profileCard } from './profileCard.js';
import { openPanel, refreshPanel } from './side.js';
import { openSettings } from './settings.js';
import { roleChips } from './roles.js';

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

// Moderator notes: private notes about a member, for people who can moderate members. Built once per open
// profile so typing survives the panel refreshing.
function modNotes(serverId, user) {
  const base = `/api/servers/${serverId}/members/${user.id}/notes`;
  const list = h('div', { class: 'mod-notes-list' }, h('p', { class: 'mod-notes-empty' }, 'Loading…'));
  const input = h('textarea', { class: 'mod-notes-input', rows: 2, maxlength: 1000, placeholder: 'Add a note only moderators can see' });
  let notes = [];
  const draw = () => list.replaceChildren(...(notes.length ? notes.map((note) => h('div', { class: 'mod-note' },
    h('p', {}, note.content),
    h('div', { class: 'mod-note-meta' },
      h('span', { title: formatStamp(note.createdAt) }, `${note.author?.displayName || 'Someone'} · ${formatStamp(note.createdAt)}`),
      iconButton('trash', 'Delete note', () => attempt(async () => {
        await api.del(`${base}/${note.id}`);
        notes = notes.filter((n) => n.id !== note.id);
        draw();
      }))))) : [h('p', { class: 'mod-notes-empty' }, 'No notes yet.')]));
  const add = () => attempt(async () => {
    const content = input.value.trim();
    if (!content) return;
    notes.unshift(await api.post(base, { content }));
    input.value = '';
    draw();
  });
  input.addEventListener('keydown', (event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); add(); } });
  api.get(base).then((rows) => { notes = rows; draw(); }).catch((err) => toast(err.message));
  return h('div', { class: 'mod-notes profile-notes' },
    h('div', { class: 'profile-roles-title' }, 'Moderator notes'), list,
    h('div', { class: 'mod-notes-add' }, input, button('Add', add, 'ghost small')));
}

// Shows someone's profile in the side panel. `serverId` adds the Kick button for the server's owner.
export function openProfile(user, { serverId } = {}) {
  showing = { userId: user.id, serverId };
  const notes = serverId && user.id !== state.me.id && !user.bot && can(serverId, 'moderateMembers') ? modNotes(serverId, user) : null;
  const panel = openPanel({
    title: 'Profile',
    onClose: () => { showing = null; },
    build: () => {
      const fresh = state.users.get(user.id) || user;
      return profileCard(fresh, buttonsFor(fresh, serverId, () => panel.close()), serverId && roleChips(serverId, fresh), notes);
    },
  });
}

// Keep the buttons and presence right while the profile is open.
on('relationships users presence members servers', () => { if (showing) refreshPanel(); });
