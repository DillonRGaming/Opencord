const { LiveServer } = require('./live');
const auth = require('./lib/auth');
const users = require('./models/users');
const servers = require('./models/servers');
const channels = require('./models/channels');
const stats = require('./lib/stats');
const push = require('./lib/push');

let io;
const socketCounts = new Map(); // userId → open sockets; online while ≥ 1

const userRoom = (id) => `user:${id}`;
const serverRoom = (id) => `server:${id}`;
const sessionRoom = (hash) => `session:${hash}`;

// Sets up the live connection server. A transport (lib/liveNode.js, or the Durable Object on Cloudflare) feeds
// it connections; this file decides what they may do.
function init() {
  // A fresh start (also when a Durable Object is rebuilt in the same process): forget the old connection
  // objects without closing them, as the same connections are taken back right after (see worker/hub.js).
  for (const map of [socketCounts, voice, idleSockets, lastStatus, callMessages]) map.clear();
  io = new LiveServer();

  io.use((socket, next) => {
    const session = auth.authenticate(socket.request.headers.cookie);
    if (!session) return next(new Error('You are not logged in.'));
    socket.data.userId = session.user.id;
    socket.data.sessionHash = session.sessionHash;
    next();
  });

  io.on('connection', (socket, { restored }) => {
    const { userId, sessionHash } = socket.data;
    socket.join([userRoom(userId), sessionRoom(sessionHash), ...servers.idsForUser(userId).map(serverRoom)]);
    if (restored) {
      // Woken from sleep: rebuild what memory lost from what the connection kept, without telling anyone.
      socketCounts.set(userId, (socketCounts.get(userId) || 0) + 1);
      if (socket.data.idle) setIdle(socket, true, { quiet: true });
      if (socket.data.voice) rejoinVoice(socket);
    } else {
      stats.recordActivity(userId);
      addSocket(userId, 1);
    }

    // Each connection gets 100 events per 10 seconds; past that they're ignored, and far past it the
    // connection is dropped, so a script can't flood everyone's typing dots or the voice relay.
    let budget = { used: 0, resetAt: Date.now() + 10_000 };
    socket.use((packet, next) => {
      const now = Date.now();
      if (now > budget.resetAt) budget = { used: 0, resetAt: now + 10_000 };
      budget.used += 1;
      if (budget.used > 400) return socket.disconnect(true);
      if (budget.used > 100) return undefined;
      return next();
    });
    let lastTyping = 0;

    socket.on('typing', (channelId) => {
      if (Date.now() - lastTyping < 2000) return;
      lastTyping = Date.now();
      const channel = typeof channelId === 'string' && channels.get(channelId);
      if (channel && channels.canAccess(userId, channel)) toChannel(channel, 'typing', { channelId, userId });
    });

    // Live draft text, for people who turned on "show what I'm typing". Sent at most ~4 times a second.
    let lastDraft = 0;
    socket.on('typing:text', (payload) => {
      if (Date.now() - lastDraft < 250) return;
      lastDraft = Date.now();
      const { channelId, text } = payload || {};
      if (typeof text !== 'string') return;
      const channel = typeof channelId === 'string' && channels.get(channelId);
      if (channel && channels.canAccess(userId, channel)) toChannel(channel, 'typing', { channelId, userId, text: text.slice(0, 300) });
    });

    socket.on('idle', (idle) => setIdle(socket, Boolean(idle)));

    socket.on('disconnect', () => {
      idleSockets.get(userId)?.delete(socket.id);
      if (!idleSockets.get(userId)?.size) idleSockets.delete(userId);
      leaveVoice(socket);
      addSocket(userId, -1);
    });

    // --- whiteboards: finished strokes are saved and shared; strokes still being drawn are only relayed ---
    const board = (channelId) => {
      const channel = typeof channelId === 'string' && channels.get(channelId);
      return channel && channel.kind === 'whiteboard' && channels.canAccess(userId, channel) ? channel : null;
    };
    socket.on('wb:live', (data = {}) => {
      const channel = board(data.channelId);
      const stroke = channel && cleanStroke(data);
      if (stroke) socket.to(serverRoom(channel.server_id)).volatile.emit('wb:live', { channelId: channel.id, key: String(data.key).slice(0, 40), userId, ...stroke });
    });
    socket.on('wb:stroke', (data = {}, reply) => {
      const channel = board(data.channelId);
      const stroke = channel && cleanStroke(data);
      if (!stroke) return reply?.({ error: 'That stroke could not be saved.' });
      const saved = channels.addStroke(channel.id, userId, stroke);
      toServer(channel.server_id, 'wb:stroke', { channelId: channel.id, key: String(data.key).slice(0, 40), stroke: saved });
      reply?.({ id: saved.id });
    });
    // Undo: take back one of your own strokes (admins can take back anyone's).
    socket.on('wb:erase', ({ channelId, id } = {}) => {
      const channel = board(channelId);
      const row = channel && typeof id === 'string' && channels.getStroke(id);
      if (!row || row.channel_id !== channel.id) return;
      if (row.user_id !== userId && !servers.can(channel.server_id, userId, 'manageMessages')) return;
      channels.removeStroke(id);
      toServer(channel.server_id, 'wb:erase', { channelId: channel.id, id });
    });

    // --- voice: the server only relays WebRTC offers/answers/candidates between people in the same room ---
    if (!restored) socket.emit('voice:states', voiceStatesFor(userId));

    socket.on('voice:join', (channelId, reply) => {
      const channel = typeof channelId === 'string' && channels.get(channelId);
      // Voice channels in servers, and calls in DMs and group DMs.
      const callable = channel && (channel.kind === 'voice' || channel.type === 'dm');
      if (!callable || !channels.canAccess(userId, channel)) return reply?.({ error: 'Voice channel not found.' });
      leaveVoice(socket);
      if (!voice.has(channel.id)) voice.set(channel.id, new Map());
      const room = voice.get(channel.id);
      const peers = [...room.values()].map((p) => p.userId);
      socket.data.voice = channel.id;
      socket.data.voiceState = { userId, muted: false, deafened: false };
      socket.save();
      room.set(socket.id, socket.data.voiceState);
      socket.join(voiceRoom(channel.id));
      announceVoice(channel);
      // The first person into a DM call rings everyone else in the DM, and the chat gets a "started a call" line.
      if (channel.type === 'dm' && !peers.length) {
        const caller = users.get(userId);
        for (const other of channels.dmMemberIds(channel.id)) {
          if (other === userId) continue;
          toUser(other, 'call:ring', { channelId: channel.id, userId });
          // Phones with the app closed ring too (it gives up after 30 seconds, like the call card).
          push.send(other, { type: 'call', channelId: channel.id, title: caller?.display_name || 'Someone', body: 'Incoming call…' }, { ttlSeconds: 30 });
        }
        startCallMessage(channel, userId);
      }
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
      socket.save();
      announceVoice(channels.get(socket.data.voice));
    });

    socket.on('voice:signal', ({ to, data } = {}) => {
      const room = socket.data.voice && voice.get(socket.data.voice);
      if (!room?.has(to) || typeof data !== 'object') return;
      io.to(to).emit('voice:signal', { from: socket.id, userId, data });
    });
  });
}

// A stroke from a client: points as [x, y] pairs (whole board units), a colour, a width, and whether it erases.
function cleanStroke(data) {
  if (!Array.isArray(data.points) || !data.points.length) return null;
  const points = [];
  for (const p of data.points.slice(0, 4000)) {
    if (!Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) return null;
    points.push([Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10]);
  }
  const color = /^#[0-9a-f]{6}$/i.test(data.color) ? data.color : '#ffffff';
  const size = Math.min(Math.max(Number(data.size) || 4, 1), 120);
  return { points, color, size, erase: Boolean(data.erase) };
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
  if (!channel) return;
  if (channel.type === 'dm') toUsers(channels.dmMemberIds(channel.id), 'voice:state', voiceState(channel.id));
  else toServer(channel.server_id, 'voice:state', voiceState(channel.id));
}

function voiceStatesFor(userId) {
  const mine = new Set(servers.idsForUser(userId));
  return [...voice.keys()].map((id) => channels.get(id))
    .filter((c) => c && (c.type === 'dm' ? channels.canAccess(userId, c) : mine.has(c.server_id)))
    .map((c) => voiceState(c.id));
}

// DM calls are noted in the chat: "X started a call", then how long it lasted once everyone has left.
const callMessages = new Map(); // DM channelId → message id
function startCallMessage(channel, userId) {
  try {
    const { postMessage } = require('./lib/post');
    const message = postMessage(channel, userId, '', { components: [{ type: 'call', startedAt: Date.now() }] });
    callMessages.set(channel.id, message.id);
  } catch (err) {
    console.error('Call message failed:', err.message);
  }
}
function endCallMessage(channelId) {
  const messages = require('./models/messages');
  // After a sleep the map is empty, so fall back to the newest call note in the chat that hasn't ended.
  const id = callMessages.get(channelId) || messages.openCallMessageId(channelId);
  callMessages.delete(channelId);
  const row = id && messages.get(id);
  if (!row?.components) return;
  const parts = JSON.parse(row.components);
  parts[0] = { ...parts[0], endedAt: Date.now() };
  toChannel(channels.get(channelId), 'message:update', messages.serialize(messages.setComponents(id, parts)));
}

// A woken socket that was in a call: put it back in the room, quietly.
function rejoinVoice(socket) {
  const channelId = socket.data.voice;
  if (!voice.has(channelId)) voice.set(channelId, new Map());
  voice.get(channelId).set(socket.id, socket.data.voiceState || { userId: socket.data.userId, muted: false, deafened: false });
  socket.join(voiceRoom(channelId));
}

function leaveVoice(socket) {
  const channelId = socket.data.voice;
  if (!channelId) return;
  socket.data.voice = null;
  socket.data.voiceState = null;
  if (socket.open) socket.save();
  socket.leave(voiceRoom(channelId));
  const room = voice.get(channelId);
  room?.delete(socket.id);
  if (room && !room.size) voice.delete(channelId);
  const nobodyLeft = ![...(room?.keys() || [])].some((id) => !id.startsWith('bot:'));
  if (callMessages.has(channelId) && nobodyLeft) endCallMessage(channelId);
  // The call is over: phones still ringing for it stop.
  const channel = channels.get(channelId);
  if (nobodyLeft && channel?.type === 'dm') for (const other of channels.dmMemberIds(channelId)) push.send(other, { type: 'call_end', channelId }, { ttlSeconds: 30 });
  io.to(voiceRoom(channelId)).emit('voice:peer-left', { socketId: socket.id });
  announceVoice(channel);
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

function setIdle(socket, idle, { quiet = false } = {}) {
  const { userId } = socket.data;
  if (!quiet && socket.data.idle !== idle) {
    socket.data.idle = idle;
    socket.save();
  }
  if (!idleSockets.has(userId)) idleSockets.set(userId, new Set());
  const set = idleSockets.get(userId);
  if (idle) set.add(socket.id); else set.delete(socket.id);
  if (!set.size) idleSockets.delete(userId);
  if (!quiet) announcePresence(userId);
}

// Online stretches for the owner's charts: one starts when someone's first tab connects, ends with the last.
function markOnline(userId, online) {
  const db = require('./db');
  const now = Date.now();
  if (online) {
    db.prepare('UPDATE online_spans SET ended_at = ? WHERE user_id = ? AND ended_at IS NULL').run(now, userId);
    db.prepare('INSERT INTO online_spans (user_id, started_at) VALUES (?, ?)').run(userId, now);
  } else {
    db.prepare('UPDATE online_spans SET ended_at = ? WHERE user_id = ? AND ended_at IS NULL').run(now, userId);
  }
}

function addSocket(userId, change) {
  const before = socketCounts.get(userId) || 0;
  const count = before + change;
  if (before === 0 && count > 0) markOnline(userId, true);
  if (count > 0) socketCounts.set(userId, count);
  else {
    if (before > 0) markOnline(userId, false);
    socketCounts.delete(userId);
    // Invisible people never looked online, so going offline mustn't give them away either.
    if (change < 0 && chosenPresence(userId) !== 'invisible') {
      users.touchLastSeen(userId);
      const user = users.get(userId);
      if (user) toAudience(userId, 'user:update', users.toUser(user));
    }
  }
  announcePresence(userId);
}

// How many people have the app open right now.
function onlineCount() {
  return socketCounts.size;
}

function isOnline(userId) {
  return statusOf(userId) !== 'offline';
}

function toUser(userId, event, payload) {
  if (!io) return;
  io.to(userRoom(userId)).emit(event, payload);
}

function toUsers(userIds, event, payload) {
  if (!io || !userIds.length) return;
  io.to(userIds.map(userRoom)).emit(event, payload);
}

function toServer(serverId, event, payload) {
  if (!io) return;
  io.to(serverRoom(serverId)).emit(event, payload);
}

// Channel audience: every server member, or both people in a DM.
function toChannel(channel, event, payload) {
  if (channel.type === 'dm') return toUsers(channels.dmMemberIds(channel.id), event, payload);
  // A channel limited to some roles (or a post in one) only reaches the people who can see it.
  const rules = channel.kind === 'post' ? channels.get(channel.parent_id) || channel : channel;
  if (rules.view_roles) return toUsers(servers.memberIds(channel.server_id).filter((id) => channels.canAccess(id, channel)), event, payload);
  return toServer(channel.server_id, event, payload);
}

// Friends and server co-members of a user.
function toAudience(userId, event, payload) {
  toUsers(users.audienceIds(userId), event, payload);
}

function joinServer(userId, serverId) {
  if (!io) return;
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
  io.close();
  return Promise.resolve();
}

// The connection server, for transports to hand connections to.
const live = () => io;

module.exports = {
  statusOf, announcePresence,
  botJoinVoice, botLeaveVoice,
  init, live, close, isOnline, onlineCount, toUser, toUsers, toServer, toChannel, toAudience,
  joinServer, leaveServer, closeServer, disconnectSessions,
};
