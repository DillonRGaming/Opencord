// All app state lives here. Views read `state` and re-render when a topic they care about is emitted.
//
// Topics: me, relationships, servers, dms, unread, presence, members, users, route, reload,
// and the chat events message:create, message:update, message:delete, typing.

export const state = {
  me: null,
  relationships: new Map(), // userId → Relation
  servers: new Map(), // serverId → Server
  dms: new Map(), // channelId → DMChannel
  members: new Map(), // serverId → Member[] (loaded when a server is opened)
  users: new Map(), // every user seen so far, for looking up names
  readStates: {}, // channelId → last read message id
  online: new Set(), // user ids
  route: { name: 'home' },
};

const listeners = new Map();

export function on(topics, fn) {
  for (const topic of topics.split(' ')) {
    if (!listeners.has(topic)) listeners.set(topic, []);
    listeners.get(topic).push(fn);
  }
}

export function emit(topic, payload) {
  for (const fn of listeners.get(topic) || []) fn(payload);
}

export function load(data) {
  state.me = data.me;
  state.relationships = new Map(data.relationships.map((relation) => [relation.user.id, relation]));
  state.servers = new Map(data.servers.map((server) => [server.id, server]));
  state.dms = new Map(data.dms.map((dm) => [dm.id, dm]));
  state.members.clear();
  state.readStates = data.readStates;
  state.online = new Set(data.online).add(data.me.id);
  remember(data.me, ...data.relationships.map((r) => r.user), ...data.dms.map((dm) => dm.recipient));
}

export function remember(...users) {
  for (const user of users) state.users.set(user.id, user);
}

// A user changed their profile: swap the new copy in everywhere it is held.
export function updateUser(user) {
  remember(user);
  const relation = state.relationships.get(user.id);
  if (relation) relation.user = user;
  for (const dm of state.dms.values()) if (dm.recipient.id === user.id) dm.recipient = user;
  for (const list of state.members.values()) {
    for (const member of list) if (member.user.id === user.id) member.user = user;
  }
}

export function findChannel(channelId) {
  if (state.dms.has(channelId)) return state.dms.get(channelId);
  for (const server of state.servers.values()) {
    const channel = server.channels.find((c) => c.id === channelId);
    if (channel) return channel;
  }
  return null;
}

export function isUnread(channel) {
  return Boolean(channel.lastMessageId) && channel.lastMessageId > (state.readStates[channel.id] || '');
}

export function markRead(channelId, messageId) {
  if (messageId > (state.readStates[channelId] || '')) state.readStates[channelId] = messageId;
}

// DMs newest first; ones just opened (no messages yet) sit at the top.
export function sortedDms() {
  return [...state.dms.values()].sort((a, b) => {
    if (!a.lastMessageId || !b.lastMessageId) return a.lastMessageId ? 1 : -1;
    return a.lastMessageId < b.lastMessageId ? 1 : -1;
  });
}

export function relationsWith(status) {
  return [...state.relationships.values()].filter((relation) => relation.status === status);
}

export function isOwner(serverId) {
  return state.servers.get(serverId)?.ownerId === state.me.id;
}

export function upsertChannel(channel) {
  const server = state.servers.get(channel.serverId);
  if (!server) return;
  const index = server.channels.findIndex((c) => c.id === channel.id);
  if (index === -1) server.channels.push(channel);
  else server.channels[index] = channel;
  emit('servers');
}

export function hasUnread(server) {
  return server.channels.some(isUnread);
}
