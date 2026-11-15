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

// Whiteboard strokes. `reply` gets the server's answer for a finished stroke.
export function boardSend(event, payload, reply) {
  if (reply) socket?.emit(event, payload, reply);
  else socket?.emit(event, payload);
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
      if (channel?.kind === 'post') {
        state.posts.set(channel.id, channel);
        emit('posts');
        return emit('message:create', message);
      }
      if (!channel || channel.type !== 'dm') return;
      state.dms.set(channel.id, channel);
      remember(...dmPeople(channel));
    }
    if (!channel.lastMessageId || message.id > channel.lastMessageId) channel.lastMessageId = message.id;
    if (channel.kind === 'post') {
      channel.replies = (channel.replies || 0) + 1;
      emit('posts');
    }
    if (message.author.id === state.me.id) markRead(channel.id, message.id);
    else if (channel.type === 'dm') state.dmPings.set(channel.id, Math.min(100, (state.dmPings.get(channel.id) || 0) + 1));
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

  socket.on('post:create', (post) => { state.posts.set(post.id, post); emit('posts'); });
  socket.on('post:update', (post) => { state.posts.set(post.id, { ...state.posts.get(post.id), ...post }); emit('posts'); });
  socket.on('post:delete', ({ id }) => {
    state.posts.delete(id);
    emit('posts');
    if (state.route.postId === id) navigate(paths.channel(state.route.serverId, state.route.channelId));
  });
  for (const event of ['wb:live', 'wb:stroke', 'wb:erase', 'wb:clear', 'event:update', 'event:delete', 'music:update', 'videos:update', 'wiki:update', 'wiki:delete']) socket.on(event, (payload) => emit(event, payload));

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
    if (member.user.id === state.me.id) {
      state.myRoles[serverId] = member.roleIds || [];
      emit('servers'); // my roles changed: channels and controls I can see may have too
    }
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
  socket.on('call:ring', (payload) => emit('call:ring', payload));
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
