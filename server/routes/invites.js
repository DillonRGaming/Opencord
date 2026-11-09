const express = require('express');
const auth = require('../lib/auth');
const { fail } = require('../lib/http');
const servers = require('../models/servers');
const realtime = require('../realtime');
const { withPresence } = require('./servers');

const router = express.Router();

function findInvite(code) {
  const invite = servers.getInvite(code.toLowerCase());
  if (!invite) fail(404, 'That invite is invalid or has been deleted.');
  return { invite, server: servers.get(invite.server_id) };
}

// The only non-auth route outside /api/auth: logged-out visitors see the invite before signing up.
router.get('/:code', (req, res) => {
  const { invite, server } = findInvite(req.params.code);
  res.json(servers.toInvite(invite.code, server));
});

router.post('/:code', auth.requireAuth, (req, res) => {
  const { invite, server } = findInvite(req.params.code);
  const userId = req.user.id;
  if (!servers.isMember(server.id, userId)) {
    servers.addMember(server.id, userId);
    servers.countInviteUse(invite.code);
    realtime.toServer(server.id, 'member:add', { serverId: server.id, member: withPresence(servers.member(server.id, userId)) });
    realtime.toServer(server.id, 'presence', { userId, online: realtime.isOnline(userId) });
    realtime.joinServer(userId, server.id);
    realtime.toUser(userId, 'server:create', servers.toServer(server));
  }
  res.json(servers.toServer(server));
});

module.exports = router;
