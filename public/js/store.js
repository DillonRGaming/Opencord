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
  statuses: new Map(), // userId → 'online' / 'idle' / 'dnd'
  unreadNotifications: 0,
  voice: new Map(), // voice channelId → [{ userId, muted, deafened, speaking }]
  route: { name: 'home' },
};

const listeners = new Map();

export function on(topics, fn) {
  for (const topic of topics.split(' ')) {
    if (!listeners.has(topic)) listeners.set(topic, []);
    listeners.get(topic).push(fn);
  }
  // Returns a function that stops listening.
  return () => {
    for (const topic of topics.split(' ')) {
      const list = listeners.get(topic);
      list.splice(list.indexOf(fn), 1);
    }
  };
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
  state.statuses = new Map(Object.entries(data.statuses || {}));
  state.unreadNotifications = data.unreadNotifications || 0;
  remember(data.me, ...data.relationships.map((r) => r.user), ...data.dms.flatMap(dmPeople));
}

export function remember(...users) {
  for (const user of users) state.users.set(user.id, user);
}

// A user changed their profile: swap the new copy in everywhere it is held.
export function updateUser(user) {
  remember(user);
  const relation = state.relationships.get(user.id);
  if (relation) relation.user = user;
  for (const dm of state.dms.values()) {
    if (dm.recipient?.id === user.id) dm.recipient = user;
    if (dm.recipients) dm.recipients = dm.recipients.map((r) => (r.id === user.id ? user : r));
  }
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

// Owner or admin.
export function canModerate(serverId) {
  const server = state.servers.get(serverId);
  return Boolean(server) && (server.ownerId === state.me.id || server.adminIds?.includes(state.me.id));
}

export function roleOf(serverId, userId) {
  const server = state.servers.get(serverId);
  if (!server) return null;
  if (server.ownerId === userId) return 'owner';
  return server.adminIds?.includes(userId) ? 'admin' : 'member';
}

// Everyone in a DM apart from me: one person, or a group.
export function dmPeople(dm) {
  return dm.recipients || (dm.recipient ? [dm.recipient] : []);
}

export function dmName(dm) {
  if (dm.kind !== 'group') return dm.recipient?.displayName || 'Unknown';
  return dm.name || dmPeople(dm).map((u) => u.displayName).join(', ') || 'Empty group';
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

// --- custom roles ---

// A member's roles, highest first.
export function memberRoles(serverId, userId) {
  const server = state.servers.get(serverId);
  const member = state.members.get(serverId)?.find((m) => m.user.id === userId);
  if (!server?.roles?.length || !member?.roleIds?.length) return [];
  return server.roles.filter((role) => member.roleIds.includes(role.id));
}

// The colour of someone's name in a server: their highest role that has one.
export function roleColor(serverId, userId) {
  if (!serverId) return null;
  return memberRoles(serverId, userId).find((role) => role.color)?.color || null;
}
