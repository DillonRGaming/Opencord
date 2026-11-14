const servers = require('../models/servers');
const channels = require('../models/channels');
const { fail } = require('./http');

// Each returns the row, or answers 404/403. Non-members get 404 so they can't probe for ids.

function memberServer(serverId, userId) {
  const server = servers.get(serverId);
  if (!server || !servers.isMember(serverId, userId)) fail(404, 'Server not found.');
  return server;
}

function ownedServer(serverId, userId) {
  const server = memberServer(serverId, userId);
  if (server.owner_id !== userId) fail(403, 'Only the server owner can do that.');
  return server;
}

function visibleChannel(channelId, userId) {
  const channel = channels.get(channelId);
  if (!channel || !channels.canAccess(userId, channel)) fail(404, 'Channel not found.');
  return channel;
}

// Owner or admin: moderation, channels, invites, emoji, bots, audit log.
function modServer(serverId, userId) {
  const server = memberServer(serverId, userId);
  if (!['owner', 'admin'].includes(servers.roleOf(serverId, userId))) fail(403, 'Only admins and the owner can do that.');
  return server;
}

const PERMISSION_NAMES = {
  manageServer: 'manage the server', manageChannels: 'manage channels', manageRoles: 'manage roles',
  manageMessages: 'manage messages', moderateMembers: 'moderate members', manageBots: 'manage bots and webhooks',
  viewAuditLog: 'see the audit log', createInvites: 'make invites',
};

// A member who has `perm` (through a role, or as an admin or the owner).
function permServer(serverId, userId, perm) {
  const server = memberServer(serverId, userId);
  if (!servers.can(serverId, userId, perm)) fail(403, `You need permission to ${PERMISSION_NAMES[perm] || perm}.`);
  return server;
}

module.exports = { memberServer, ownedServer, modServer, permServer, visibleChannel };
