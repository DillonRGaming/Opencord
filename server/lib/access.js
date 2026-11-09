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

module.exports = { memberServer, ownedServer, visibleChannel };
