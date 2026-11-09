const express = require('express');
const { fail, text } = require('../lib/http');
const users = require('../models/users');
const relationships = require('../models/relationships');
const servers = require('../models/servers');
const channels = require('../models/channels');

const router = express.Router();

router.post('/', (req, res) => {
  const me = req.user.id;
  const otherId = text(req.body.userId, 'User');
  if (otherId === me) fail(400, "You can't message yourself.");
  if (!users.get(otherId)) fail(404, 'User not found.');
  if (relationships.eitherBlocked(me, otherId)) fail(403, "You can't message this user.");
  if (!relationships.areFriends(me, otherId) && !servers.shareServer(me, otherId)) {
    fail(403, 'You can only message friends and people you share a server with.');
  }
  res.json(channels.serialize(channels.getOrCreateDm(me, otherId), me));
});

module.exports = router;
