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

    socket.on('disconnect', () => addSocket(userId, -1));
  });
}

function addSocket(userId, change) {
  const count = (socketCounts.get(userId) || 0) + change;
  if (count > 0) socketCounts.set(userId, count);
  else socketCounts.delete(userId);
  const cameOnline = change > 0 && count === 1;
  if (cameOnline || count === 0) toAudience(userId, 'presence', { userId, online: cameOnline });
}

function isOnline(userId) {
  return socketCounts.has(userId);
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
  init, close, isOnline, toUser, toUsers, toServer, toChannel, toAudience,
  joinServer, leaveServer, closeServer, disconnectSessions,
};
