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
  posts: new Map(), // postId → Post, for posts channels that have been opened
  myRoles: {}, // serverId → my role ids (kept up to date from member updates)
  dmPings: new Map(), // DM channelId → unread messages from others, shown as red counts
  voice: new Map(), // voice channelId → [{ userId, muted, deafened, speaking }]
  hqServerId: null, // the Dev dashboard server, if the owner has one
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
  state.hqServerId = data.hqServerId ?? null;
  state.relationships = new Map(data.relationships.map((relation) => [relation.user.id, relation]));
  state.servers = new Map(data.servers.map((server) => [server.id, server]));
  state.dms = new Map(data.dms.map((dm) => [dm.id, dm]));
  state.members.clear();
  state.readStates = data.readStates;
  state.online = new Set(data.online).add(data.me.id);
  state.statuses = new Map(Object.entries(data.statuses || {}));
  state.unreadNotifications = data.unreadNotifications || 0;
  state.dmPings = new Map(Object.entries(data.dmPings || {}));
  state.myRoles = data.myRoles || {};
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
  if (state.posts.has(channelId)) return state.posts.get(channelId);
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
  const channel = state.dms.get(channelId);
  if (channel && (!channel.lastMessageId || messageId >= channel.lastMessageId)) state.dmPings.delete(channelId);
}

export function dmPingTotal() {
  let total = 0;
  for (const n of state.dmPings.values()) total += n;
  return total;
}

// DMs newest first; ones just opened (no messages yet) sit at the top.
export function sortedDms() {
  // Newest first: by the last message, or for a DM with none yet, by when it was made (ids are in time order).
  const key = (dm) => dm.lastMessageId || dm.id;
  return [...state.dms.values()].sort((a, b) => (key(a) < key(b) ? 1 : key(a) > key(b) ? -1 : 0));
}

export function relationsWith(status) {
  // Newest first: the friend (or request) you just added sits at the top.
  return [...state.relationships.values()].filter((relation) => relation.status === status).sort((a, b) => (b.since || 0) - (a.since || 0));
}

export function isOwner(serverId) {
  return state.servers.get(serverId)?.ownerId === state.me.id;
}

// --- permissions (the server checks them too; these decide what to show) ---

export const PERMISSIONS = [
  ['manageServer', 'Manage the server', 'Change the name, icon, banner, emoji, invites and community settings.'],
  ['manageChannels', 'Manage channels', 'Create, edit, reorder and delete channels and categories, and see every channel.'],
  ['manageRoles', 'Manage roles', 'Create plain roles and hand them out. Roles with permissions stay with admins.'],
  ['manageMessages', 'Manage messages', 'Delete and pin anyone’s messages, and tidy up posts, events, songs and pages.'],
  ['moderateMembers', 'Moderate members', 'Time out, kick and ban people (not admins).'],
  ['manageBots', 'Manage bots and webhooks', 'Make and edit bots and webhooks.'],
  ['viewAuditLog', 'See the audit log', 'See who changed what in the server.'],
  ['mentionEveryone', 'Mention @everyone', 'Ping the whole server with @everyone and @here.'],
  ['createInvites', 'Make invites', 'Make invite links, even when invites are set to admins only.'],
];

export function myRoleIds(serverId) {
  return state.members.get(serverId)?.find((m) => m.user.id === state.me.id)?.roleIds || state.myRoles[serverId] || [];
}

// Owner and admins can do everything; everyone else gets what their roles switch on.
export function can(serverId, perm) {
  if (canModerate(serverId)) return true;
  const server = state.servers.get(serverId);
  const mine = myRoleIds(serverId);
  return Boolean(server?.roles?.some((r) => mine.includes(r.id) && r.perms?.includes(perm)));
}

// Server settings opens for anyone with a permission it has a page for.
export function hasSettingsAccess(serverId) {
  return ['manageServer', 'manageChannels', 'manageRoles', 'moderateMembers', 'manageBots', 'viewAuditLog'].some((p) => can(serverId, p));
}

// Channels limited to some roles are hidden from everyone else.
export function canSeeChannel(serverId, channel) {
  if (!channel.viewRoles) return true;
  if (can(serverId, 'manageChannels')) return true;
  const mine = myRoleIds(serverId);
  return channel.viewRoles.some((id) => mine.includes(id));
}

export function canPostIn(serverId, channel) {
  if (!channel.readOnly || canModerate(serverId)) return true;
  const mine = myRoleIds(serverId);
  return (channel.postRoles || []).some((id) => mine.includes(id));
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
  return server.channels.some((c) => isUnread(c) && canSeeChannel(server.id, c));
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

// --- settings that change behaviour ---

export const setting = (key, fallback) => state.me?.settings?.[key] ?? fallback;

// Quiet hours: no sounds, desktop notifications or call rings between two times (it can wrap past midnight).
export function quietNow() {
  const q = setting('quietHours', null);
  if (!q?.on || !q.from || !q.to) return false;
  const now = new Date();
  const minutes = now.getHours() * 60 + now.getMinutes();
  const [fh, fm] = q.from.split(':').map(Number);
  const [th, tm] = q.to.split(':').map(Number);
  const from = fh * 60 + fm;
  const to = th * 60 + tm;
  return from <= to ? minutes >= from && minutes < to : minutes >= from || minutes < to;
}
