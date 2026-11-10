const { Server } = require('socket.io');
const auth = require('./lib/auth');
const users = require('./models/users');
const servers = require('./models/servers');
const channels = require('./models/channels');

let io;
const socketCounts = new Map(); // userId → open sockets; online while ≥ 1

const userRoom = (id) => `user:${id}`;
const serverRoom = (id) => `server:${id}`;
const sessionRoom = (hash) => `session:${hash}`;

function init(httpServer) {
  io = new Server(httpServer);

  io.use((socket, next) => {
    const session = auth.authenticate(socket.request.headers.cookie);
    if (!session) return next(new Error('You are not logged in.'));
    socket.data.userId = session.user.id;
    socket.data.sessionHash = session.sessionHash;
    next();
  });

  io.on('connection', (socket) => {
    const { userId, sessionHash } = socket.data;
    socket.join([userRoom(userId), sessionRoom(sessionHash), ...servers.idsForUser(userId).map(serverRoom)]);
    addSocket(userId, 1);

    socket.on('typing', (channelId) => {
      const channel = typeof channelId === 'string' && channels.get(channelId);
      if (channel && channels.canAccess(userId, channel)) toChannel(channel, 'typing', { channelId, userId });
    });

    socket.on('idle', (idle) => setIdle(socket, Boolean(idle)));

    socket.on('disconnect', () => {
      idleSockets.get(userId)?.delete(socket.id);
      leaveVoice(socket);
      addSocket(userId, -1);
    });

    // --- voice: the server only relays WebRTC offers/answers/candidates between people in the same room ---
    socket.emit('voice:states', voiceStatesFor(userId));

    socket.on('voice:join', (channelId, reply) => {
      const channel = typeof channelId === 'string' && channels.get(channelId);
      if (!channel || channel.kind !== 'voice' || !channels.canAccess(userId, channel)) return reply?.({ error: 'Voice channel not found.' });
      leaveVoice(socket);
      if (!voice.has(channel.id)) voice.set(channel.id, new Map());
      const room = voice.get(channel.id);
      const peers = [...room.values()].map((p) => p.userId);
      room.set(socket.id, { userId, muted: false, deafened: false });
      socket.data.voice = channel.id;
      socket.join(voiceRoom(channel.id));
      announceVoice(channel);
      reply?.({ self: socket.id, peers: [...room.entries()].filter(([id]) => id !== socket.id && !id.startsWith('bot:')).map(([id, p]) => ({ socketId: id, ...p })), skip: peers.length });
    });

    socket.on('voice:leave', () => leaveVoice(socket));

    socket.on('voice:update', (update) => {
      const room = socket.data.voice && voice.get(socket.data.voice);
      const me = room?.get(socket.id);
      if (!me) return;
      me.muted = Boolean(update?.muted);
      me.deafened = Boolean(update?.deafened);
      me.speaking = Boolean(update?.speaking);
      me.video = Boolean(update?.video);
      me.screen = Boolean(update?.screen);
      announceVoice(channels.get(socket.data.voice));
    });

    socket.on('voice:signal', ({ to, data } = {}) => {
      const room = socket.data.voice && voice.get(socket.data.voice);
      if (!room?.has(to) || typeof data !== 'object') return;
      io.to(to).emit('voice:signal', { from: socket.id, userId, data });
    });
  });
}

// channelId → Map(socketId → { userId, muted, deafened, speaking })
const voice = new Map();
const voiceRoom = (id) => `voice:${id}`;

function voiceState(channelId) {
  return {
    channelId,
    users: [...(voice.get(channelId)?.entries() || [])].map(([socketId, { userId, muted, deafened, speaking, video, screen }]) => ({
      socketId, userId, muted, deafened, speaking, video: Boolean(video), screen: Boolean(screen),
    })),
  };
}

function announceVoice(channel) {
  if (channel) toServer(channel.server_id, 'voice:state', voiceState(channel.id));
}

function voiceStatesFor(userId) {
  const mine = new Set(servers.idsForUser(userId));
  return [...voice.keys()].map((id) => channels.get(id)).filter((c) => c && mine.has(c.server_id)).map((c) => voiceState(c.id));
}

function leaveVoice(socket) {
  const channelId = socket.data.voice;
  if (!channelId) return;
  socket.data.voice = null;
  socket.leave(voiceRoom(channelId));
  const room = voice.get(channelId);
  room?.delete(socket.id);
  if (room && !room.size) voice.delete(channelId);
  io.to(voiceRoom(channelId)).emit('voice:peer-left', { socketId: socket.id });
  announceVoice(channels.get(channelId));
}

// Bots can sit in a voice channel (shown in the list, no audio). Their "socket" id is bot:<userId>.
function botJoinVoice(channel, userId) {
  botLeaveVoice(userId);
  if (!voice.has(channel.id)) voice.set(channel.id, new Map());
  voice.get(channel.id).set(`bot:${userId}`, { userId, muted: true, deafened: false, speaking: false });
  announceVoice(channel);
}

function botLeaveVoice(userId) {
  for (const [channelId, room] of voice) {
    if (!room.delete(`bot:${userId}`)) continue;
    if (!room.size) voice.delete(channelId);
    announceVoice(channels.get(channelId));
  }
}

// --- presence ---
// What others see: 'offline', 'online', 'idle' or 'dnd'. Invisible people look offline to everyone else.
// Idle is automatic: when every open tab of someone's has been away for a while.
const idleSockets = new Map(); // userId → Set of socket ids that report being idle
const lastStatus = new Map(); // userId → the status last announced

function chosenPresence(userId) {
  return users.get(userId)?.presence || 'online';
}

function statusOf(userId) {
  if (!socketCounts.has(userId)) return 'offline';
  const chosen = chosenPresence(userId);
  if (chosen === 'invisible') return 'offline';
  if (chosen === 'dnd') return 'dnd';
  if (chosen === 'idle') return 'idle';
  return (idleSockets.get(userId)?.size || 0) >= socketCounts.get(userId) ? 'idle' : 'online';
}

// Tells friends and server co-members when someone's status changes.
function announcePresence(userId) {
  const status = statusOf(userId);
  if (lastStatus.get(userId) === status) return;
  lastStatus.set(userId, status);
  toAudience(userId, 'presence', { userId, online: status !== 'offline', status });
  toUser(userId, 'presence', { userId, online: true, status: status === 'offline' ? 'invisible' : status });
}

function setIdle(socket, idle) {
  const { userId } = socket.data;
  if (!idleSockets.has(userId)) idleSockets.set(userId, new Set());
  const set = idleSockets.get(userId);
  if (idle) set.add(socket.id); else set.delete(socket.id);
  if (!set.size) idleSockets.delete(userId);
  announcePresence(userId);
}

function addSocket(userId, change) {
  const count = (socketCounts.get(userId) || 0) + change;
  if (count > 0) socketCounts.set(userId, count);
  else socketCounts.delete(userId);
  announcePresence(userId);
}

function isOnline(userId) {
  return statusOf(userId) !== 'offline';
}

function toUser(userId, event, payload) {
  io.to(userRoom(userId)).emit(event, payload);
}

function toUsers(userIds, event, payload) {
  if (userIds.length) io.to(userIds.map(userRoom)).emit(event, payload);
}

function toServer(serverId, event, payload) {
  io.to(serverRoom(serverId)).emit(event, payload);
}

// Channel audience: every server member, or both people in a DM.
function toChannel(channel, event, payload) {
  if (channel.type === 'dm') toUsers(channels.dmMemberIds(channel.id), event, payload);
  else toServer(channel.server_id, event, payload);
}

// Friends and server co-members of a user.
function toAudience(userId, event, payload) {
  toUsers(users.audienceIds(userId), event, payload);
}

function joinServer(userId, serverId) {
  io.in(userRoom(userId)).socketsJoin(serverRoom(serverId));
}

function leaveServer(userId, serverId) {
  io.in(userRoom(userId)).socketsLeave(serverRoom(serverId));
}

function closeServer(serverId) {
  io.in(serverRoom(serverId)).socketsLeave(serverRoom(serverId));
}

function disconnectSessions(sessionHashes) {
  if (sessionHashes.length) io.in(sessionHashes.map(sessionRoom)).disconnectSockets(true);
}

function close() {
  return io.close();
}

module.exports = {
  statusOf, announcePresence,
  botJoinVoice, botLeaveVoice,
  init, close, isOnline, toUser, toUsers, toServer, toChannel, toAudience,
  joinServer, leaveServer, closeServer, disconnectSessions,
};
