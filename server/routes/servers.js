const express = require('express');
const config = require('../config');
const storage = require('../lib/storage');
const access = require('../lib/access');
const { fail, text } = require('../lib/http');
const servers = require('../models/servers');
const channels = require('../models/channels');
const attachments = require('../models/attachments');
const realtime = require('../realtime');

const router = express.Router();
const rawImage = express.raw({ type: () => true, limit: config.maxImageBytes });

const serverName = (value) => text(value, 'Server name', { min: 1, max: 100 });
const channelName = (value) => text(value, 'Channel name', { min: 1, max: 100 }).toLowerCase().replace(/\s+/g, '-');
const withPresence = (member) => ({ ...member, online: realtime.isOnline(member.user.id) });

function announce(server) {
  const json = servers.toServer(server);
  realtime.toServer(server.id, 'server:update', json);
  return json;
}

router.post('/', (req, res) => {
  const server = servers.create(req.user.id, serverName(req.body.name));
  const json = servers.toServer(server);
  realtime.joinServer(req.user.id, server.id);
  realtime.toUser(req.user.id, 'server:create', json);
  res.status(201).json(json);
});

router.patch('/:id', (req, res) => {
  const server = access.ownedServer(req.params.id, req.user.id);
  res.json(announce(servers.update(server.id, { name: serverName(req.body.name) })));
});

function setIcon(req, res, file) {
  const server = access.ownedServer(req.params.id, req.user.id);
  const updated = servers.update(server.id, { icon: file });
  if (server.icon) storage.remove(`icons/${server.icon}`);
  res.json(announce(updated));
}

router.put('/:id/icon', rawImage, (req, res) => {
  access.ownedServer(req.params.id, req.user.id);
  setIcon(req, res, storage.saveImage('icons', req.body));
});

router.delete('/:id/icon', (req, res) => {
  setIcon(req, res, null);
});

router.delete('/:id', (req, res) => {
  const server = access.ownedServer(req.params.id, req.user.id);
  const files = attachments.pathsForServer(server.id);
  servers.remove(server.id);
  storage.remove(...files, server.icon && `icons/${server.icon}`);
  realtime.toServer(server.id, 'server:delete', { id: server.id });
  realtime.closeServer(server.id);
  res.sendStatus(204);
});

router.get('/:id/members', (req, res) => {
  const server = access.memberServer(req.params.id, req.user.id);
  res.json(servers.members(server.id).map(withPresence));
});

function removeMember(server, userId) {
  servers.removeMember(server.id, userId);
  realtime.leaveServer(userId, server.id);
  realtime.toUser(userId, 'server:delete', { id: server.id });
  realtime.toServer(server.id, 'member:remove', { serverId: server.id, userId });
}

router.delete('/:id/members/@me', (req, res) => {
  const server = access.memberServer(req.params.id, req.user.id);
  if (server.owner_id === req.user.id) fail(400, "The owner can't leave. Delete the server instead.");
  removeMember(server, req.user.id);
  res.sendStatus(204);
});

router.delete('/:id/members/:userId', (req, res) => {
  const server = access.ownedServer(req.params.id, req.user.id);
  if (req.params.userId === req.user.id) fail(400, "You can't kick yourself.");
  if (!servers.isMember(server.id, req.params.userId)) fail(404, 'That user is not in this server.');
  removeMember(server, req.params.userId);
  res.sendStatus(204);
});

router.post('/:id/invites', (req, res) => {
  const server = access.memberServer(req.params.id, req.user.id);
  res.status(201).json(servers.toInvite(servers.createInvite(server.id, req.user.id), server));
});

router.post('/:id/channels', (req, res) => {
  const server = access.ownedServer(req.params.id, req.user.id);
  const json = channels.toChannel(channels.create(server.id, channelName(req.body.name)));
  realtime.toServer(server.id, 'channel:create', json);
  res.status(201).json(json);
});

module.exports = { router, channelName, withPresence };
