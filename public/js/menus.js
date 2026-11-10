// What each kind of thing offers on right-click. Views attach these with withMenu(el, () => …Menu(…)).
import * as api from './api.js';
import { state, emit, isUnread, markRead, canModerate, roleOf, dmName } from './store.js';
import { paths } from './router.js';
import * as actions from './actions.js';
import { attempt, copyText, toast } from './ui.js';

const copy = (text, what) => attempt(async () => { await copyText(text); toast(`${what} copied.`, 'ok'); });

function ackChannel(channel) {
  if (!isUnread(channel)) return;
  markRead(channel.id, channel.lastMessageId);
  emit('unread');
  api.post(`/api/channels/${channel.id}/ack`, { messageId: channel.lastMessageId }).catch(() => {});
}

// Lazy imports keep these menus from pulling every view in at startup (and avoid import cycles).
const views = {
  profile: () => import('./views/profile.js'),
  server: () => import('./views/serverPages.js'),
  settings: () => import('./views/serverSettings.js'),
  moderate: () => import('./views/moderation.js'),
  groups: () => import('./views/groups.js'),
};

export function userMenu(user, { serverId } = {}) {
  const me = user.id === state.me.id;
  const relation = state.relationships.get(user.id)?.status;
  const server = serverId && state.servers.get(serverId);
  const myRole = server && roleOf(serverId, state.me.id);
  const theirRole = server && roleOf(serverId, user.id);
  const outranks = server && !me && (myRole === 'owner' || (myRole === 'admin' && theirRole === 'member'));
  const member = server && state.members.get(serverId)?.find((m) => m.user.id === user.id);
  const moderate = async (action) => (await views.moderate()).openModerate(server, user, action);
  return [
    { label: 'Profile', icon: 'user', onClick: async () => (await views.profile()).openProfile(user, { serverId }) },
    !me && relation !== 'blocked' && !user.bot && { label: 'Message', icon: 'message', onClick: () => attempt(() => actions.openDm(user.id)) },
    !me && '-',
    !me && !relation && !user.bot && { label: 'Add friend', icon: 'userPlus', onClick: () => attempt(() => actions.sendFriendRequest(user.username).then(() => toast('Friend request sent.', 'ok'))) },
    !me && relation === 'incoming' && { label: 'Accept friend request', icon: 'check', onClick: () => attempt(() => actions.acceptFriend(user.id)) },
    !me && relation === 'outgoing' && { label: 'Cancel friend request', icon: 'x', onClick: () => attempt(() => actions.removeRelation(user.id)) },
    !me && relation === 'friend' && { label: 'Remove friend', icon: 'x', danger: true, confirm: true, onClick: () => attempt(() => actions.removeRelation(user.id)) },
    !me && relation !== 'blocked' && { label: 'Block', icon: 'ban', danger: true, confirm: true, onClick: () => attempt(() => actions.blockUser(user.id)) },
    !me && relation === 'blocked' && { label: 'Unblock', icon: 'ban', onClick: () => attempt(() => actions.removeRelation(user.id)) },
    myRole === 'owner' && !me && !user.bot && '-',
    myRole === 'owner' && !me && !user.bot && (theirRole === 'admin'
      ? { label: 'Remove admin', icon: 'shield', onClick: () => attempt(() => api.put(`/api/servers/${serverId}/members/${user.id}/role`, { role: 'member' })) }
      : { label: 'Make admin', icon: 'shield', onClick: () => attempt(() => api.put(`/api/servers/${serverId}/members/${user.id}/role`, { role: 'admin' })) }),
    outranks && '-',
    outranks && (member?.timeoutUntil
      ? { label: 'Remove timeout', icon: 'clock', onClick: () => attempt(() => api.put(`/api/servers/${serverId}/members/${user.id}/timeout`, { seconds: 0 })) }
      : { label: `Time out ${user.displayName}`, icon: 'clock', danger: true, onClick: () => moderate('timeout') }),
    outranks && { label: `Kick ${user.displayName}`, icon: 'logout', danger: true, onClick: () => moderate('kick') },
    outranks && { label: `Ban ${user.displayName}`, icon: 'ban', danger: true, onClick: () => moderate('ban') },
    '-',
    { label: 'Copy username', icon: 'at', onClick: () => copy(user.username, 'Username') },
    { label: 'Copy user ID', icon: 'copy', onClick: () => copy(user.id, 'User ID') },
  ];
}

export function categoryMenu(server, category) {
  const mod = canModerate(server.id);
  return [
    { label: 'Mark as read', icon: 'check', onClick: () => server.channels.filter((c) => c.parentId === category.id).forEach(ackChannel) },
    mod && '-',
    mod && { label: 'New channel here', icon: 'plus', onClick: async () => (await views.server()).openChannelPage(server, null, { parentId: category.id }) },
    mod && { label: 'Edit category', icon: 'pencil', onClick: async () => (await views.server()).openChannelPage(server, category) },
    mod && { label: 'Delete category', icon: 'trash', danger: true, confirm: true, onClick: () => attempt(() => api.del(`/api/channels/${category.id}`)) },
  ];
}

export function channelMenu(server, channel) {
  const owner = canModerate(server.id);
  return [
    { label: 'Mark as read', icon: 'check', onClick: () => ackChannel(channel) },
    { label: 'Copy link', icon: 'link', onClick: () => copy(`${location.origin}${paths.channel(server.id, channel.id)}`, 'Link') },
    owner && '-',
    owner && { label: 'Edit channel', icon: 'pencil', onClick: async () => (await views.server()).openChannelPage(server, channel) },
    owner && { label: 'Delete channel', icon: 'trash', danger: true, confirm: true, onClick: () => attempt(() => api.del(`/api/channels/${channel.id}`)) },
    '-',
    { label: 'Copy channel ID', icon: 'copy', onClick: () => copy(channel.id, 'Channel ID') },
  ];
}

export function serverMenu(server) {
  const mod = canModerate(server.id);
  const isOwner = server.ownerId === state.me.id;
  return [
    { label: 'Mark as read', icon: 'check', onClick: () => server.channels.forEach(ackChannel) },
    { label: 'Invite people', icon: 'userPlus', onClick: async () => attempt(async () => (await views.server()).openInviteLink(server)) },
    mod && '-',
    mod && { label: 'Server settings', icon: 'settings', onClick: async () => (await views.settings()).openServerSettings(server) },
    mod && { label: 'New channel', icon: 'plus', onClick: async () => (await views.server()).openChannelPage(server) },
    mod && { label: 'New category', icon: 'folder', onClick: async () => (await views.server()).openChannelPage(server, null, { kind: 'category' }) },
    !isOwner && '-',
    !isOwner && { label: 'Leave server', icon: 'logout', danger: true, confirm: true, onClick: () => attempt(() => api.del(`/api/servers/${server.id}/members/@me`)) },
    '-',
    { label: 'Copy server ID', icon: 'copy', onClick: () => copy(server.id, 'Server ID') },
  ];
}

export function dmMenu(dm) {
  if (dm.kind === 'group') {
    return [
      { label: 'Mark as read', icon: 'check', onClick: () => ackChannel(dm) },
      { label: 'Group settings', icon: 'settings', onClick: async () => (await views.groups()).openGroupSettings(dm) },
      '-',
      { label: 'Leave group', icon: 'logout', danger: true, confirm: true, onClick: () => attempt(() => api.del(`/api/dms/${dm.id}/members/@me`)) },
      '-',
      { label: 'Copy group ID', icon: 'copy', onClick: () => copy(dm.id, `${dmName(dm)} ID`) },
    ];
  }
  return [
    { label: 'Mark as read', icon: 'check', onClick: () => ackChannel(dm) },
    '-',
    ...userMenu(dm.recipient),
  ];
}

// handlers are the chat view's message handlers (see messageRow).
export function messageMenu(message, mine, handlers, row, quick) {
  return [
    { emojis: quick, onPick: (emoji) => handlers.onReact(message, emoji, true) },
    { label: 'Reply', icon: 'reply', onClick: () => handlers.onReply(message) },
    mine && { label: 'Edit message', icon: 'pencil', onClick: () => handlers.onEdit(message, row) },
    { label: message.pinned ? 'Unpin message' : 'Pin message', icon: 'pin', onClick: () => handlers.onPin(message) },
    '-',
    message.content && { label: 'Copy text', icon: 'copy', onClick: () => handlers.onCopy(message) },
    { label: 'Copy message link', icon: 'link', onClick: () => copy(`${location.origin}${location.pathname}#${message.id}`, 'Link') },
    { label: 'Copy message ID', icon: 'copy', onClick: () => copy(message.id, 'Message ID') },
    (mine || handlers.canDelete) && '-',
    (mine || handlers.canDelete) && { label: 'Delete message', icon: 'trash', danger: true, confirm: true, onClick: () => handlers.onDelete(message) },
  ];
}

