const express = require('express');
const auth = require('../lib/auth');
const { fail } = require('../lib/http');
const servers = require('../models/servers');
const realtime = require('../realtime');
const audit = require('../models/audit');
const users = require('../models/users');
const post = require('../lib/post');
const { withPresence } = require('./servers');

const router = express.Router();

function findInvite(code) {
  const invite = servers.getInvite(code.toLowerCase());
  if (!invite || servers.inviteDead(invite)) fail(404, 'That invite is invalid, used up or has expired.');
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
  if (servers.isBanned(server.id, userId)) fail(403, 'You are banned from this server.');
  if (!servers.isMember(server.id, userId)) {
    servers.addMember(server.id, userId);
    servers.countInviteUse(invite.code);
    realtime.toServer(server.id, 'member:add', { serverId: server.id, member: withPresence(servers.member(server.id, userId)) });
    realtime.toServer(server.id, 'presence', { userId, online: realtime.isOnline(userId) });
    realtime.joinServer(userId, server.id);
    realtime.toUser(userId, 'server:create', servers.toServer(server));
    audit.log(server.id, userId, 'member.join', `@${req.user.username}`, `invite ${invite.code}`);
    post.emit('join', { serverId: server.id, user: users.toUser(req.user) });
    post.welcome(server, req.user);
  }
  res.json(servers.toServer(server));
});

module.exports = router;
