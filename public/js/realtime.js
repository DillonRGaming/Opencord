/* global io */
import * as api from './api.js';
import { state, emit, load, remember, updateUser, upsertChannel, findChannel, markRead, dmPeople } from './store.js';
import { setMe } from './actions.js';
import { navigate, paths } from './router.js';

let socket = null;

export function sendTyping(channelId) {
  socket?.emit('typing', channelId);
}

// Voice signaling goes over the same socket. ack-style calls return a promise.
export function voiceEmit(event, payload) {
  return new Promise((resolve) => socket?.emit(event, payload, resolve));
}

export function voiceSend(event, payload) {
  socket?.emit(event, payload);
}

// Auto idle: no mouse or keys for 10 minutes, or the tab hidden for 10 minutes.
const IDLE_AFTER_MS = 10 * 60 * 1000;
let idle = false;
let idleTimer = null;
function setIdle(value) {
  if (idle === value) return;
  idle = value;
  socket?.emit('idle', value);
}
function active() {
  setIdle(false);
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => setIdle(true), IDLE_AFTER_MS);
}
for (const event of ['pointerdown', 'keydown', 'pointermove', 'focus']) window.addEventListener(event, active, { passive: true });
document.addEventListener('visibilitychange', () => { if (!document.hidden) active(); });

export function connect() {
  let connectedBefore = false;
  socket = io({ transports: ['websocket', 'polling'] });

  // After a dropped connection, fetch everything again so nothing that happened meanwhile is missed.
  socket.on('connect', async () => {
    if (idle) socket.emit('idle', true);
    if (connectedBefore) {
      try {
        load(await api.get('/api/bootstrap'));
        for (const topic of ['me', 'relationships', 'servers', 'dms', 'unread', 'presence', 'reload']) emit(topic);
      } catch {
        // offline again; the next reconnect retries
      }
    }
    connectedBefore = true;
    document.body.classList.remove('offline');
  });
  socket.on('disconnect', () => document.body.classList.add('offline'));
  socket.on('connect_error', (err) => {
    if (err.message.includes('not logged in')) location.reload();
  });

  socket.on('message:create', async (message) => {
    remember(message.author);
    let channel = findChannel(message.channelId);
    if (!channel) {
      // First message of a DM someone else started.
      channel = await api.get(`/api/channels/${message.channelId}`).catch(() => null);
      if (!channel || channel.type !== 'dm') return;
      state.dms.set(channel.id, channel);
      remember(...dmPeople(channel));
    }
    if (!channel.lastMessageId || message.id > channel.lastMessageId) channel.lastMessageId = message.id;
    if (message.author.id === state.me.id) markRead(channel.id, message.id);
    emit('message:create', message);
    if (channel.type === 'dm') emit('dms');
    emit('unread');
  });
  socket.on('message:update', (message) => emit('message:update', message));
  socket.on('message:delete', (payload) => emit('message:delete', payload));
  socket.on('typing', (payload) => {
    if (payload.userId !== state.me.id) emit('typing', payload);
  });

  socket.on('presence', ({ userId, online, status }) => {
    if (online) state.online.add(userId);
    else state.online.delete(userId);
    if (status) state.statuses.set(userId, status);
    emit('presence');
  });

  socket.on('user:update', (user) => {
    if (user.id === state.me.id) {
      setMe(user);
      return;
    }
    updateUser(user);
    emit('users', user);
  });

  socket.on('relationship:update', (relation) => {
    state.relationships.set(relation.user.id, relation);
    remember(relation.user);
    emit('relationships');
  });
  socket.on('relationship:remove', ({ userId }) => {
    state.relationships.delete(userId);
    emit('relationships');
  });

  socket.on('server:create', setServer);
  socket.on('server:update', setServer);
  socket.on('server:delete', ({ id }) => {
    state.servers.delete(id);
    state.members.delete(id);
    emit('servers');
    emit('unread');
  });

  socket.on('member:add', ({ serverId, member }) => {
    remember(member.user);
    const list = state.members.get(serverId);
    if (list && !list.some((m) => m.user.id === member.user.id)) list.push(member);
    emit('members');
  });
  socket.on('member:remove', ({ serverId, userId }) => {
    const list = state.members.get(serverId);
    if (list) state.members.set(serverId, list.filter((m) => m.user.id !== userId));
    emit('members');
  });

  socket.on('channel:create', upsertChannel);
  socket.on('channel:update', upsertChannel);
  socket.on('channel:delete', ({ id, serverId }) => {
    const server = state.servers.get(serverId);
    if (!server) return;
    server.channels = server.channels.filter((c) => c.id !== id);
    emit('servers');
    emit('unread');
  });

  socket.on('member:update', ({ serverId, member }) => {
    remember(member.user);
    const list = state.members.get(serverId);
    if (list) state.members.set(serverId, list.map((m) => (m.user.id === member.user.id ? { ...m, ...member } : m)));
    emit('members');
  });

  socket.on('dm:update', (dm) => {
    remember(...dmPeople(dm));
    state.dms.set(dm.id, dm);
    emit('dms');
  });
  socket.on('dm:delete', ({ id }) => {
    state.dms.delete(id);
    emit('dms');
    if (state.route.channelId === id) navigate(paths.home());
  });

  socket.on('notification', (note) => {
    state.unreadNotifications += 1;
    emit('notification', note);
    emit('notifications');
  });

  socket.on('voice:states', (states) => {
    state.voice = new Map(states.map((s) => [s.channelId, s.users]));
    emit('voice');
  });
  socket.on('voice:state', ({ channelId, users }) => {
    if (users.length) state.voice.set(channelId, users);
    else state.voice.delete(channelId);
    emit('voice');
  });
  socket.on('voice:signal', (payload) => emit('voice:signal', payload));
  socket.on('voice:peer-left', (payload) => emit('voice:peer-left', payload));

  socket.on('read', ({ channelId, messageId }) => {
    markRead(channelId, messageId);
    emit('unread');
  });
}

function setServer(server) {
  state.servers.set(server.id, server);
  emit('servers');
  emit('unread');
}
