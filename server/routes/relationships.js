const express = require('express');
const { fail, text } = require('../lib/http');
const users = require('../models/users');
const relationships = require('../models/relationships');
const servers = require('../models/servers');
const realtime = require('../realtime');

const router = express.Router();

function announce(userId, otherId) {
  realtime.toUser(userId, 'relationship:update', relationships.relation(userId, otherId));
}

function becomeFriends(userId, otherId) {
  relationships.setBoth(userId, otherId, 'friend', 'friend');
  announce(userId, otherId);
  announce(otherId, userId);
  // New friends can now see each other's status dot.
  realtime.toUser(userId, 'presence', { userId: otherId, online: realtime.isOnline(otherId) });
  realtime.toUser(otherId, 'presence', { userId, online: realtime.isOnline(userId) });
}

router.post('/', (req, res) => {
  const me = req.user.id;
  const other = users.getByUsername(text(req.body.username, 'Username').toLowerCase());
  if (!other) fail(404, 'Nobody has that username.');
  if (other.id === me) fail(400, "You can't add yourself.");

  const mine = relationships.get(me, other.id);
  if (mine?.status === 'friend') fail(409, 'You are already friends.');
  if (mine?.status === 'outgoing') fail(409, 'You already sent them a request.');
  if (mine?.status === 'blocked') fail(400, 'You blocked this user. Unblock them first.');
  if (relationships.get(other.id, me)?.status === 'blocked') fail(403, "You can't send this user a request.");
  // Their privacy setting: who may send them friend requests.
  const from = users.settingOf(other.id, 'friendRequestsFrom', 'everyone');
  if (relationships.get(me, other.id)?.status !== 'incoming') {
    if (from === 'nobody') fail(403, "They aren't taking friend requests.");
    if (from === 'servers' && !servers.shareServer(me, other.id)) fail(403, 'They only take friend requests from people in their servers.');
  }

  if (mine?.status === 'incoming') {
    becomeFriends(me, other.id);
  } else {
    relationships.setBoth(me, other.id, 'outgoing', 'incoming');
    announce(me, other.id);
    announce(other.id, me);
  }
  res.json(relationships.relation(me, other.id));
});

router.put('/:userId', (req, res) => {
  const me = req.user.id;
  const otherId = req.params.userId;
  if (relationships.get(me, otherId)?.status !== 'incoming') fail(404, 'There is no request from that user.');
  becomeFriends(me, otherId);
  res.json(relationships.relation(me, otherId));
});

// Remove friend, decline, cancel, or unblock.
router.delete('/:userId', (req, res) => {
  const me = req.user.id;
  const otherId = req.params.userId;
  const mine = relationships.get(me, otherId);
  if (!mine) fail(404, 'Nothing to remove.');

  if (mine.status === 'blocked') {
    relationships.remove(me, otherId);
  } else {
    relationships.removeBoth(me, otherId);
    realtime.toUser(otherId, 'relationship:remove', { userId: me });
  }
  realtime.toUser(me, 'relationship:remove', { userId: otherId });
  res.sendStatus(204);
});

router.post('/:userId/block', (req, res) => {
  const me = req.user.id;
  const otherId = req.params.userId;
  if (otherId === me) fail(400, "You can't block yourself.");
  if (!users.get(otherId)) fail(404, 'User not found.');

  if (relationships.block(me, otherId)) realtime.toUser(otherId, 'relationship:remove', { userId: me });
  announce(me, otherId);
  res.json(relationships.relation(me, otherId));
});

module.exports = router;
