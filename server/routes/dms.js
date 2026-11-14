const express = require('express');
const { fail, text } = require('../lib/http');
const users = require('../models/users');
const relationships = require('../models/relationships');
const servers = require('../models/servers');
const channels = require('../models/channels');
const realtime = require('../realtime');
const { postMessage } = require('../lib/post');

const router = express.Router();
const GROUP_MAX = 10;

function canReach(me, otherId) {
  if (!users.get(otherId)) fail(404, 'User not found.');
  if (relationships.eitherBlocked(me, otherId)) fail(403, "You can't message this user.");
  if (!relationships.areFriends(me, otherId) && !servers.shareServer(me, otherId)) {
    fail(403, 'You can only message friends and people you share a server with.');
  }
  // Their privacy setting: DMs from friends only.
  if (users.settingOf(otherId, 'dmsFrom', 'servers') === 'friends' && !relationships.areFriends(me, otherId) && !users.get(me).is_bot) {
    fail(403, 'They only take messages from friends.');
  }
}

router.post('/', (req, res) => {
  const me = req.user.id;
  const otherId = text(req.body.userId, 'User');
  if (otherId === me) fail(400, "You can't message yourself.");
  canReach(me, otherId);
  res.json(channels.serialize(channels.getOrCreateDm(me, otherId), me));
});

// Each member sees the group from their own side, so send everyone their own copy.
function announce(row, removedIds = []) {
  for (const userId of channels.dmMemberIds(row.id)) realtime.toUser(userId, 'dm:update', channels.serialize(row, userId));
  for (const userId of removedIds) realtime.toUser(userId, 'dm:delete', { id: row.id });
}

function system(group, actorId, content) {
  postMessage(group, actorId, content);
}

function myGroup(id, userId) {
  const group = channels.get(id);
  if (!group || group.kind !== 'group' || !channels.dmMemberIds(id).includes(userId)) fail(404, 'Group not found.');
  return group;
}

router.post('/group', (req, res) => {
  const me = req.user.id;
  const ids = req.body.userIds;
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) fail(400, 'userIds must be a list.');
  const others = [...new Set(ids)].filter((id) => id !== me);
  if (others.length < 2) fail(400, 'Pick at least 2 people for a group. For one person, open a DM.');
  if (others.length + 1 > GROUP_MAX) fail(400, `Groups can have up to ${GROUP_MAX} people.`);
  others.forEach((id) => canReach(me, id));
  const name = text(req.body.name ?? '', 'Group name', { max: 100 });
  const group = channels.createGroup(me, others, name);
  announce(group);
  res.status(201).json(channels.serialize(group, me));
});

router.patch('/:id', (req, res) => {
  const group = myGroup(req.params.id, req.user.id);
  const name = text(req.body.name ?? '', 'Group name', { max: 100 });
  const updated = channels.setGroup(group.id, { name });
  announce(updated);
  system(updated, req.user.id, name ? `-# renamed the group to **${name.replace(/[*_~|`\\]/g, '\\$&')}**` : '-# removed the group name');
  res.json(channels.serialize(updated, req.user.id));
});

router.put('/:id/members/:userId', (req, res) => {
  const group = myGroup(req.params.id, req.user.id);
  const { userId } = req.params;
  if (channels.dmMemberIds(group.id).includes(userId)) fail(409, 'They are already in this group.');
  if (channels.dmMemberIds(group.id).length >= GROUP_MAX) fail(400, `Groups can have up to ${GROUP_MAX} people.`);
  canReach(req.user.id, userId);
  channels.addDmMember(group.id, userId);
  announce(channels.get(group.id));
  system(group, req.user.id, `-# added @${users.get(userId).username} to the group`);
  res.json(channels.serialize(channels.get(group.id), req.user.id));
});

// Leave (@me) or, for the group owner, remove someone.
router.delete('/:id/members/:userId', (req, res) => {
  const group = myGroup(req.params.id, req.user.id);
  const userId = req.params.userId === '@me' ? req.user.id : req.params.userId;
  if (userId !== req.user.id && group.owner_id !== req.user.id) fail(403, 'Only the group owner can remove people.');
  if (!channels.dmMemberIds(group.id).includes(userId)) fail(404, 'They are not in this group.');
  channels.removeDmMember(group.id, userId);
  const left = channels.dmMemberIds(group.id);
  if (!left.length) {
    channels.remove(group.id);
  } else {
    if (group.owner_id === userId) channels.setGroup(group.id, { ownerId: left[0] });
    system(channels.get(group.id), req.user.id, userId === req.user.id ? '-# left the group' : `-# removed @${users.get(userId).username} from the group`);
    announce(channels.get(group.id), [userId]);
  }
  realtime.toUser(userId, 'dm:delete', { id: group.id });
  res.sendStatus(204);
});

module.exports = router;
