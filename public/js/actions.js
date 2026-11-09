// Things the user can do from more than one place (friends page, profile popout, sidebar…).
import * as api from './api.js';
import { debounce } from './dom.js';
import { state, emit, remember, updateUser } from './store.js';
import { navigate, paths } from './router.js';
import { apply as applyTheme } from './theme.js';

// True from the moment an appearance setting changes until the server has stored it.
let settingsDirty = false;

// Takes a fresh copy of the logged-in user (from a request or the socket) and updates everything that shows it.
export function setMe(me) {
  state.me = settingsDirty ? { ...me, settings: state.me.settings } : me;
  applyTheme(state.me.settings);
  const { settings, createdAt, ...user } = state.me;
  updateUser(user);
  emit('me');
  emit('users', user);
}

const saveSettings = debounce(async () => {
  const sent = state.me.settings;
  try {
    await api.patch('/api/users/@me', { settings: sent });
  } finally {
    if (state.me.settings === sent) settingsDirty = false;
  }
}, 400);

// Appearance changes show straight away and are saved to the account a moment later.
export function changeSettings(changes) {
  state.me.settings = { ...state.me.settings, ...changes };
  settingsDirty = true;
  applyTheme(state.me.settings);
  saveSettings();
}

function setRelation(relation) {
  state.relationships.set(relation.user.id, relation);
  remember(relation.user);
  emit('relationships');
}

export async function openDm(userId) {
  const dm = await api.post('/api/dms', { userId });
  if (!state.dms.has(dm.id)) {
    state.dms.set(dm.id, dm);
    remember(dm.recipient);
    emit('dms');
  }
  navigate(paths.dm(dm.id));
}

export async function sendFriendRequest(username) {
  const relation = await api.post('/api/relationships', { username });
  setRelation(relation);
  return relation;
}

export async function acceptFriend(userId) {
  setRelation(await api.put(`/api/relationships/${userId}`));
}

// Remove friend, decline or cancel a request, or unblock.
export async function removeRelation(userId) {
  await api.del(`/api/relationships/${userId}`);
  state.relationships.delete(userId);
  emit('relationships');
}

export async function blockUser(userId) {
  setRelation(await api.post(`/api/relationships/${userId}/block`));
}

export async function joinInvite(code) {
  const server = await api.post(`/api/invites/${code}`);
  state.servers.set(server.id, server);
  emit('servers');
  navigate(paths.channel(server.id, server.channels[0]?.id), { panel: 'nav' });
}

export async function logout() {
  await api.post('/api/auth/logout').catch(() => {});
  location.href = '/';
}

// Accepts a full invite link or just the code.
export function parseInviteCode(text) {
  const trimmed = text.trim();
  return (/invite\/([a-z0-9]+)/i.exec(trimmed)?.[1] || trimmed).toLowerCase();
}
