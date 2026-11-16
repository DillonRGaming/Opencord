const express = require('express');
const limits = require('../lib/limits');
const hq = require('../lib/hq');
const config = require('../config');
const storage = require('../lib/storage');
const access = require('../lib/access');
const { fail, text } = require('../lib/http');
const servers = require('../models/servers');
const channels = require('../models/channels');
const users = require('../models/users');
const emojis = require('../models/emojis');
const audit = require('../models/audit');
const notes = require('../models/notes');
const attachments = require('../models/attachments');
const realtime = require('../realtime');
const bots = require('../lib/bots');
const botAi = require('../lib/botAi');

const router = express.Router();
const rawImage = express.raw({ type: () => true, limit: config.maxImageBytes });
const rawEmoji = express.raw({ type: () => true, limit: 512 * 1024 });

const serverName = (value) => text(value, 'Server name', { min: 1, max: 100 });
const channelName = (value) => text(value, 'Channel name', { min: 1, max: 100 }).toLowerCase().replace(/\s+/g, '-');
const categoryName = (value) => text(value, 'Category name', { min: 1, max: 100 });
const withPresence = (member) => ({ ...member, online: realtime.isOnline(member.user.id), status: realtime.statusOf(member.user.id) });
const HEX = /^#[0-9a-f]{6}$/i;
const KINDS = ['text', 'voice', 'category', 'posts', 'whiteboard', 'calendar', 'music', 'wiki', 'video'];
const MAX_EMOJIS = 100;
const TIMEOUTS = [60, 300, 600, 3600, 86400, 7 * 86400]; // seconds

function announce(server) {
  const json = servers.toServer(server);
  realtime.toServer(server.id, 'server:update', json);
  return json;
}

function userName(userId) {
  const user = users.get(userId);
  return user ? `@${user.username}` : userId;
}

// Admins can't act on the owner or on other admins; only the owner can.
function canActOn(server, actorId, targetId) {
  if (targetId === actorId) fail(400, "You can't do that to yourself.");
  const target = servers.roleOf(server.id, targetId);
  if (target === 'owner') fail(403, "You can't do that to the owner.");
  if (target === 'admin' && server.owner_id !== actorId) fail(403, 'Only the owner can do that to an admin.');
}

router.post('/', (req, res) => {
  const name = serverName(req.body.name);
  const mine = servers.forUser(req.user.id);
  limits.within('serversJoined', mine.length, 1, `You can be in up to ${limits.size('serversJoined')} servers. Leave one first.`);
  limits.within('serversOwned', mine.filter((s) => s.owner_id === req.user.id).length, 1,
    `You can own up to ${limits.size('serversOwned')} servers. Delete or hand one over first.`);
  limits.take('serversCreated', req.user.id);
  const server = servers.create(req.user.id, name);
  const json = servers.toServer(server);
  realtime.joinServer(req.user.id, server.id);
  realtime.toUser(req.user.id, 'server:create', json);
  res.status(201).json(json);
});

router.patch('/:id', (req, res) => {
  const server = access.permServer(req.params.id, req.user.id, 'manageServer');
  const fields = {};
  const changed = [];
  if (req.body.name !== undefined) { fields.name = serverName(req.body.name); changed.push(`name → ${fields.name}`); }
  if (req.body.description !== undefined) { fields.description = text(req.body.description, 'Description', { max: 500 }); changed.push('description'); }
  if (req.body.bannerColor !== undefined) {
    if (req.body.bannerColor !== null && !HEX.test(req.body.bannerColor)) fail(400, 'Banner colour must look like #a1b2c3.');
    fields.bannerColor = req.body.bannerColor;
    changed.push('banner colour');
  }
  const { welcomeChannelId, welcomeMessage, memberWait, invitesAdminOnly, pinsAdminOnly } = req.body;
  if (welcomeChannelId !== undefined) {
    if (welcomeChannelId !== null) {
      const ch = channels.get(String(welcomeChannelId));
      if (!ch || ch.server_id !== server.id || ch.kind !== 'text') fail(400, 'Pick a text channel in this server.');
    }
    fields.welcomeChannelId = welcomeChannelId;
    changed.push('welcome channel');
  }
  if (welcomeMessage !== undefined) { fields.welcomeMessage = text(welcomeMessage, 'Welcome message', { max: 500 }); changed.push('welcome message'); }
  if (memberWait !== undefined) {
    if (!Number.isSafeInteger(memberWait) || memberWait < 0 || memberWait > 7 * 86400) fail(400, 'The wait must be 0 to 7 days (in seconds).');
    fields.memberWait = memberWait;
    changed.push(`new members wait ${memberWait}s`);
  }
  if (invitesAdminOnly !== undefined) { fields.invitesAdminOnly = invitesAdminOnly ? 1 : 0; changed.push(`invites: ${invitesAdminOnly ? 'admins' : 'everyone'}`); }
  if (pinsAdminOnly !== undefined) { fields.pinsAdminOnly = pinsAdminOnly ? 1 : 0; changed.push(`pins: ${pinsAdminOnly ? 'admins' : 'everyone'}`); }
  const json = announce(servers.update(server.id, fields));
  if (changed.length) audit.log(server.id, req.user.id, 'server.update', server.name, changed.join(', '));
  res.json(json);
});

// Hand the server to another member. The old owner stays on as an admin.
router.post('/:id/owner', (req, res) => {
  const server = access.ownedServer(req.params.id, req.user.id);
  const userId = text(req.body.userId, 'userId');
  if (userId === req.user.id) fail(400, 'You already own this server.');
  if (hq.isHq(server.id)) fail(403, 'Opencord HQ always belongs to the Opencord owner.');
  if (!servers.isMember(server.id, userId)) fail(404, 'That user is not in this server.');
  servers.setRole(server.id, req.user.id, 'admin');
  const json = announce(servers.update(server.id, { ownerId: userId }));
  audit.log(server.id, req.user.id, 'server.transfer', userName(userId));
  realtime.toServer(server.id, 'member:update', { serverId: server.id, member: servers.member(server.id, req.user.id) });
  res.json(json);
});

function setIcon(req, res, file) {
  const server = access.permServer(req.params.id, req.user.id, 'manageServer');
  const updated = servers.update(server.id, { icon: file });
  if (server.icon) storage.remove(`icons/${server.icon}`);
  audit.log(server.id, req.user.id, file ? 'server.icon' : 'server.icon_remove', server.name);
  res.json(announce(updated));
}

router.put('/:id/icon', rawImage, async (req, res) => {
  access.permServer(req.params.id, req.user.id, 'manageServer');
  setIcon(req, res, await storage.saveImage('icons', req.body));
});

router.delete('/:id/icon', (req, res) => {
  setIcon(req, res, null);
});

function setBanner(req, res, file) {
  const server = access.permServer(req.params.id, req.user.id, 'manageServer');
  const updated = servers.update(server.id, { banner: file });
  if (server.banner) storage.remove(`icons/${server.banner}`);
  audit.log(server.id, req.user.id, file ? 'server.banner' : 'server.banner_remove', server.name);
  res.json(announce(updated));
}

router.put('/:id/banner', rawImage, async (req, res) => {
  access.permServer(req.params.id, req.user.id, 'manageServer');
  setBanner(req, res, await storage.saveImage('icons', req.body));
});

router.delete('/:id/banner', (req, res) => {
  setBanner(req, res, null);
});

// --- custom roles ---

const roleName = (value) => text(value, 'Role name', { min: 1, max: 40 });

function roleFields(body) {
  const fields = {};
  if (body.name !== undefined) fields.name = roleName(body.name);
  if (body.color !== undefined) {
    if (body.color !== null && !HEX.test(body.color)) fail(400, 'Role colour must look like #a1b2c3.');
    fields.color = body.color;
  }
  if (body.hoist !== undefined) fields.hoist = Boolean(body.hoist);
  if (body.admin !== undefined) fields.admin = Boolean(body.admin);
  if (body.mentionable !== undefined) fields.mentionable = Boolean(body.mentionable);
  if (body.perms !== undefined) {
    if (!Array.isArray(body.perms)) fail(400, 'Permissions must be a list.');
    fields.perms = [...new Set(body.perms.filter((p) => servers.PERMISSIONS.includes(p)))];
  }
  return fields;
}

// Only the owner can hand out admin powers, through a role or otherwise.
// Only the owner can manage roles with admin powers. People who can manage roles but aren't admins can
// only handle plain roles (names, colours, who has them): permissions are for admins and the owner to give.
function guardAdminRole(server, userId, role, fields = {}) {
  if ((role?.admin || fields.admin) && server.owner_id !== userId) fail(403, 'Only the owner can manage roles with admin powers.');
  if (servers.roleOf(server.id, userId) === 'member') {
    const carriesPerms = JSON.parse(role?.perms || '[]').length > 0;
    if (fields.perms !== undefined || carriesPerms) fail(403, 'Only admins can manage roles that give permissions.');
  }
}

function roleMembersChanged(server, roleId) {
  for (const userId of servers.memberIds(server.id)) {
    if (!roleId || servers.memberRoleIds(server.id, userId).includes(roleId)) memberChanged(server, userId);
  }
}

router.post('/:id/roles', (req, res) => {
  const server = access.permServer(req.params.id, req.user.id, 'manageRoles');
  const fields = roleFields(req.body);
  if (!fields.name) fail(400, 'Give the role a name.');
  guardAdminRole(server, req.user.id, null, fields);
  if (servers.roles(server.id).length >= 100) fail(400, 'A server can have up to 100 roles.');
  const role = servers.createRole(server.id, fields);
  announce(servers.get(server.id));
  audit.log(server.id, req.user.id, 'role.create', role.name);
  res.status(201).json(servers.toRole(role));
});

router.put('/:id/roles/order', (req, res) => {
  const server = access.permServer(req.params.id, req.user.id, 'manageRoles');
  const ids = req.body.ids;
  const known = servers.roles(server.id).map((r) => r.id);
  if (!Array.isArray(ids) || ids.length !== known.length || !ids.every((id) => known.includes(id))) fail(400, 'Send every role id once.');
  servers.orderRoles(server.id, ids);
  announce(servers.get(server.id));
  roleMembersChanged(server, null);
  res.sendStatus(204);
});

router.patch('/:id/roles/:roleId', (req, res) => {
  const server = access.permServer(req.params.id, req.user.id, 'manageRoles');
  const role = servers.getRole(server.id, req.params.roleId);
  if (!role) fail(404, 'Role not found.');
  const fields = roleFields(req.body);
  guardAdminRole(server, req.user.id, role, fields);
  const updated = servers.updateRole(server.id, role.id, fields);
  announce(servers.get(server.id));
  audit.log(server.id, req.user.id, 'role.update', updated.name);
  res.json(servers.toRole(updated));
});

router.delete('/:id/roles/:roleId', (req, res) => {
  const server = access.permServer(req.params.id, req.user.id, 'manageRoles');
  const role = servers.getRole(server.id, req.params.roleId);
  if (!role) fail(404, 'Role not found.');
  guardAdminRole(server, req.user.id, role);
  const holders = servers.memberIds(server.id).filter((userId) => servers.memberRoleIds(server.id, userId).includes(role.id));
  servers.removeRole(server.id, role.id);
  announce(servers.get(server.id));
  for (const userId of holders) memberChanged(server, userId);
  audit.log(server.id, req.user.id, 'role.delete', role.name);
  res.sendStatus(204);
});

function assignRole(req, res, on) {
  const server = access.permServer(req.params.id, req.user.id, 'manageRoles');
  const role = servers.getRole(server.id, req.params.roleId);
  if (!role) fail(404, 'Role not found.');
  const { userId } = req.params;
  if (!servers.isMember(server.id, userId)) fail(404, 'That user is not in this server.');
  guardAdminRole(server, req.user.id, role);
  if (userId !== req.user.id && servers.roleOf(server.id, userId) === 'admin' && server.owner_id !== req.user.id) {
    fail(403, "Only the owner can change an admin's roles.");
  }
  servers.setMemberRole(server.id, userId, role.id, on);
  memberChanged(server, userId);
  if (role.admin) announce(servers.get(server.id));
  audit.log(server.id, req.user.id, on ? 'role.give' : 'role.take', userName(userId), role.name);
  res.json(servers.member(server.id, userId));
}

router.put('/:id/members/:userId/roles/:roleId', (req, res) => assignRole(req, res, true));
router.delete('/:id/members/:userId/roles/:roleId', (req, res) => assignRole(req, res, false));

router.delete('/:id', (req, res) => {
  const server = access.ownedServer(req.params.id, req.user.id);
  const files = attachments.pathsForServer(server.id);
  const emojiFiles = emojis.forServer(server.id).map((e) => `emojis/${emojis.get(e.id).file}`);
  servers.remove(server.id);
  storage.remove(...files, ...emojiFiles, server.icon && `icons/${server.icon}`, server.banner && `icons/${server.banner}`);
  realtime.toServer(server.id, 'server:delete', { id: server.id });
  realtime.closeServer(server.id);
  res.sendStatus(204);
});

// --- members, roles, kicks, bans, timeouts ---

router.get('/:id/members', (req, res) => {
  const server = access.memberServer(req.params.id, req.user.id);
  res.json(servers.members(server.id).map(withPresence));
});

function removeMember(server, userId) {
  const user = users.get(userId);
  servers.removeMember(server.id, userId);
  if (user && !user.is_bot) require('../lib/post').emit('leave', { serverId: server.id, user: users.toUser(user) });
  realtime.leaveServer(userId, server.id);
  realtime.toUser(userId, 'server:delete', { id: server.id });
  realtime.toServer(server.id, 'member:remove', { serverId: server.id, userId });
}

function memberChanged(server, userId) {
  realtime.toServer(server.id, 'member:update', { serverId: server.id, member: withPresence(servers.member(server.id, userId)) });
}

router.delete('/:id/members/@me', (req, res) => {
  const server = access.memberServer(req.params.id, req.user.id);
  if (server.owner_id === req.user.id) fail(400, "The owner can't leave. Delete the server or hand it to someone first.");
  removeMember(server, req.user.id);
  audit.log(server.id, req.user.id, 'member.leave', userName(req.user.id));
  res.sendStatus(204);
});

router.delete('/:id/members/:userId', (req, res) => {
  const server = access.permServer(req.params.id, req.user.id, 'moderateMembers');
  const { userId } = req.params;
  if (!servers.isMember(server.id, userId)) fail(404, 'That user is not in this server.');
  canActOn(server, req.user.id, userId);
  removeMember(server, userId);
  audit.log(server.id, req.user.id, 'member.kick', userName(userId), text(req.body?.reason ?? '', 'Reason', { max: 500 }));
  res.sendStatus(204);
});

router.put('/:id/members/:userId/role', (req, res) => {
  const server = access.ownedServer(req.params.id, req.user.id);
  const { userId } = req.params;
  const role = req.body.role;
  if (!['admin', 'member'].includes(role)) fail(400, 'Role must be admin or member.');
  if (!servers.isMember(server.id, userId)) fail(404, 'That user is not in this server.');
  if (userId === server.owner_id) fail(400, 'The owner is always in charge.');
  servers.setRole(server.id, userId, role);
  memberChanged(server, userId);
  announce(servers.get(server.id));
  audit.log(server.id, req.user.id, role === 'admin' ? 'member.admin_add' : 'member.admin_remove', userName(userId));
  res.json(servers.member(server.id, userId));
});

router.put('/:id/members/:userId/timeout', (req, res) => {
  const server = access.permServer(req.params.id, req.user.id, 'moderateMembers');
  const { userId } = req.params;
  if (!servers.isMember(server.id, userId)) fail(404, 'That user is not in this server.');
  canActOn(server, req.user.id, userId);
  const seconds = req.body.seconds;
  if (seconds !== 0 && !TIMEOUTS.includes(seconds)) fail(400, 'That timeout length is not one of the choices.');
  const until = seconds ? Date.now() + seconds * 1000 : null;
  servers.setMemberTimeout(server.id, userId, until);
  memberChanged(server, userId);
  audit.log(server.id, req.user.id, seconds ? 'member.timeout' : 'member.timeout_remove', userName(userId),
    [seconds && `for ${seconds >= 86400 ? `${seconds / 86400}d` : seconds >= 3600 ? `${seconds / 3600}h` : `${seconds / 60}m`}`, req.body.reason].filter(Boolean).join(' · '));
  res.json(servers.member(server.id, userId));
});

// Moderator notes about a member: only people who can moderate members can read or write them.
router.get('/:id/members/:userId/notes', (req, res) => {
  const server = access.permServer(req.params.id, req.user.id, 'moderateMembers');
  res.json(notes.list(server.id, req.params.userId));
});

router.post('/:id/members/:userId/notes', (req, res) => {
  const server = access.permServer(req.params.id, req.user.id, 'moderateMembers');
  const { userId } = req.params;
  if (!users.get(userId)) fail(404, 'User not found.');
  const note = notes.add(server.id, userId, req.user.id, text(req.body.content, 'Note', { min: 1, max: 1000 }));
  audit.log(server.id, req.user.id, 'member.note', userName(userId));
  res.status(201).json(note);
});

router.delete('/:id/members/:userId/notes/:noteId', (req, res) => {
  const server = access.permServer(req.params.id, req.user.id, 'moderateMembers');
  if (!notes.remove(server.id, req.params.noteId)) fail(404, 'Note not found.');
  res.sendStatus(204);
});

router.get('/:id/bans', (req, res) => {
  const server = access.permServer(req.params.id, req.user.id, 'moderateMembers');
  res.json(servers.bans(server.id));
});

router.put('/:id/bans/:userId', (req, res) => {
  const server = access.permServer(req.params.id, req.user.id, 'moderateMembers');
  const { userId } = req.params;
  if (!users.get(userId)) fail(404, 'User not found.');
  if (servers.isMember(server.id, userId)) canActOn(server, req.user.id, userId);
  else if (userId === req.user.id) fail(400, "You can't ban yourself.");
  const reason = text(req.body.reason ?? '', 'Reason', { max: 500 });
  servers.ban(server.id, userId, reason);
  if (servers.isMember(server.id, userId)) removeMember(server, userId);
  audit.log(server.id, req.user.id, 'member.ban', userName(userId), reason);
  res.sendStatus(204);
});

router.delete('/:id/bans/:userId', (req, res) => {
  const server = access.permServer(req.params.id, req.user.id, 'moderateMembers');
  if (!servers.unban(server.id, req.params.userId)) fail(404, 'That user is not banned.');
  audit.log(server.id, req.user.id, 'member.unban', userName(req.params.userId));
  res.sendStatus(204);
});

// --- invites ---

const INVITE_EXPIRY = [0, 3600, 86400, 7 * 86400, 30 * 86400]; // seconds, 0 = never

router.post('/:id/invites', (req, res) => {
  const server = access.memberServer(req.params.id, req.user.id);
  if (hq.isHq(server.id) && server.owner_id !== req.user.id) fail(403, 'Only the Opencord owner can invite people to Dev.');
  if (server.invites_admin_only && !servers.can(server.id, req.user.id, 'createInvites')) fail(403, 'You need permission to make invites in this server.');
  const maxUses = req.body.maxUses == null || req.body.maxUses === 0 ? null : req.body.maxUses;
  if (maxUses !== null && (!Number.isSafeInteger(maxUses) || maxUses < 1 || maxUses > 10000)) fail(400, 'Max uses must be between 1 and 10000.');
  limits.within('invitesPerServer', servers.invites(server.id).length, 1, `A server can have up to ${limits.size('invitesPerServer')} invites. Delete some old ones first.`);
  const expiresIn = req.body.expiresIn ?? 0;
  if (!INVITE_EXPIRY.includes(expiresIn)) fail(400, 'That expiry is not one of the choices.');
  const code = servers.createInvite(server.id, req.user.id, { maxUses, expiresAt: expiresIn ? Date.now() + expiresIn * 1000 : null });
  audit.log(server.id, req.user.id, 'invite.create', code);
  res.status(201).json(servers.toInvite(code, server));
});

router.get('/:id/invites', (req, res) => {
  const server = access.permServer(req.params.id, req.user.id, 'manageServer');
  res.json(servers.invites(server.id));
});

router.delete('/:id/invites/:code', (req, res) => {
  const server = access.permServer(req.params.id, req.user.id, 'manageServer');
  if (!servers.removeInvite(server.id, req.params.code)) fail(404, 'Invite not found.');
  audit.log(server.id, req.user.id, 'invite.delete', req.params.code);
  res.sendStatus(204);
});

// --- channels and categories ---

router.post('/:id/channels', (req, res) => {
  const server = access.permServer(req.params.id, req.user.id, 'manageChannels');
  const kind = req.body.kind ?? 'text';
  if (!KINDS.includes(kind)) fail(400, 'Unknown channel kind.');
  limits.within('channelsPerServer', servers.channelCount(server.id), 1, `A server can have up to ${limits.size('channelsPerServer')} channels.`);
  const name = kind === 'category' ? categoryName(req.body.name) : channelName(req.body.name);
  let parentId = null;
  if (req.body.parentId && kind !== 'category') {
    const parent = channels.get(req.body.parentId);
    if (!parent || parent.server_id !== server.id || parent.kind !== 'category') fail(400, 'That category is not in this server.');
    parentId = parent.id;
  }
  const json = channels.toChannel(channels.create(server.id, name, { kind, parentId }));
  realtime.toServer(server.id, 'channel:create', json);
  audit.log(server.id, req.user.id, `${kind === 'category' ? 'category' : 'channel'}.create`, kind === 'category' ? name : `#${name}`, kind);
  res.status(201).json(json);
});

// Channel order and categories at once: [{ id, parentId }] top to bottom.
router.put('/:id/channels/order', (req, res) => {
  const server = access.permServer(req.params.id, req.user.id, 'manageChannels');
  const items = req.body.items ?? (req.body.ids || []).map((id) => ({ id }));
  if (!Array.isArray(items) || items.some((i) => typeof i?.id !== 'string')) fail(400, 'items must be a list of { id, parentId }.');
  const own = new Map(channels.forServer(server.id).map((c) => [c.id, c]));
  for (const item of items) {
    if (!own.has(item.id) || !('parentId' in item)) continue;
    const parent = item.parentId && own.get(item.parentId);
    if (item.parentId && (!parent || parent.kind !== 'category')) fail(400, 'That category is not in this server.');
    if (own.get(item.id).kind !== 'category') channels.update(item.id, { parentId: item.parentId || null });
  }
  channels.reorder(server.id, items.map((i) => i.id));
  audit.log(server.id, req.user.id, 'channel.reorder', server.name);
  res.json(announce(servers.get(server.id)));
});

// --- emoji ---

const emojiName = (value) => {
  const name = text(value, 'Emoji name', { min: 2, max: 32 }).toLowerCase().replace(/[^a-z0-9_]/g, '_');
  if (name.length < 2) fail(400, 'Emoji names need at least 2 letters, numbers or underscores.');
  return name;
};

router.post('/:id/emojis', rawEmoji, async (req, res) => {
  const server = access.permServer(req.params.id, req.user.id, 'manageServer');
  const name = emojiName(String(req.query.name || ''));
  if (emojis.count(server.id) >= MAX_EMOJIS) fail(400, `A server can have up to ${MAX_EMOJIS} emoji.`);
  if (emojis.nameTaken(server.id, name)) fail(409, `There is already an emoji called :${name}:.`);
  const file = await storage.saveImage('emojis', req.body);
  const emoji = emojis.toEmoji(emojis.create(server.id, name, file, req.user.id));
  audit.log(server.id, req.user.id, 'emoji.create', `:${name}:`);
  announce(servers.get(server.id));
  res.status(201).json(emoji);
});

router.patch('/:id/emojis/:emojiId', (req, res) => {
  const server = access.permServer(req.params.id, req.user.id, 'manageServer');
  const emoji = emojis.get(req.params.emojiId);
  if (!emoji || emoji.server_id !== server.id) fail(404, 'Emoji not found.');
  const name = emojiName(req.body.name);
  if (name !== emoji.name && emojis.nameTaken(server.id, name)) fail(409, `There is already an emoji called :${name}:.`);
  const json = emojis.toEmoji(emojis.rename(emoji.id, name));
  audit.log(server.id, req.user.id, 'emoji.update', `:${emoji.name}:`, `renamed to :${name}:`);
  announce(servers.get(server.id));
  res.json(json);
});

router.delete('/:id/emojis/:emojiId', (req, res) => {
  const server = access.permServer(req.params.id, req.user.id, 'manageServer');
  const emoji = emojis.get(req.params.emojiId);
  if (!emoji || emoji.server_id !== server.id) fail(404, 'Emoji not found.');
  emojis.remove(emoji.id);
  storage.remove(`emojis/${emoji.file}`);
  audit.log(server.id, req.user.id, 'emoji.delete', `:${emoji.name}:`);
  announce(servers.get(server.id));
  res.sendStatus(204);
});

// --- bots ---

function serverBot(server, botId) {
  const bot = bots.get(botId);
  if (!bot || bot.server_id !== server.id) fail(404, 'Bot not found.');
  return bot;
}

router.get('/:id/bots', (req, res) => {
  const server = access.permServer(req.params.id, req.user.id, 'manageBots');
  res.json(bots.forServer(server.id));
});

router.post('/:id/bots', (req, res) => {
  const server = access.permServer(req.params.id, req.user.id, 'manageBots');
  if (bots.forServer(server.id).length >= 10) fail(400, 'A server can have up to 10 bots.');
  const name = text(req.body.name, 'Bot name', { min: 1, max: 32 });
  const bot = bots.create(server.id, req.user.id, name);
  const member = withPresence(servers.member(server.id, bot.user_id));
  realtime.toServer(server.id, 'member:add', { serverId: server.id, member });
  audit.log(server.id, req.user.id, 'bot.create', name);
  res.status(201).json(bots.toBot(bot));
});

router.patch('/:id/bots/:botId', (req, res) => {
  const server = access.permServer(req.params.id, req.user.id, 'manageBots');
  const bot = serverBot(server, req.params.botId);
  const fields = {};
  if (req.body.enabled !== undefined) fields.enabled = Boolean(req.body.enabled);
  if (req.body.admin !== undefined) {
    bots.setAdmin(bot, Boolean(req.body.admin));
    realtime.toServer(server.id, 'server:update', servers.toServer(servers.get(server.id)));
    memberChanged(server, bot.user_id);
  }
  if (req.body.program !== undefined) {
    try { fields.program = bots.validateProgram(req.body.program); } catch (err) { fail(400, err.message); }
  }
  if (req.body.name !== undefined) {
    const user = users.update(bot.user_id, { displayName: text(req.body.name, 'Bot name', { min: 1, max: 32 }) });
    realtime.toServer(server.id, 'user:update', users.toUser(user));
  }
  const updated = bots.update(bot.id, fields);
  audit.log(server.id, req.user.id, 'bot.update', users.get(bot.user_id).display_name,
    [fields.program && 'blocks', fields.enabled !== undefined && (fields.enabled ? 'turned on' : 'turned off'), req.body.name && 'name', req.body.admin !== undefined && (req.body.admin ? 'made admin' : 'admin removed')].filter(Boolean).join(', '));
  res.json(bots.toBot(updated));
});

// The bot's profile: like a person's (name, status, bio, banner, picture), changed by whoever manages bots.
function botChanged(server, bot) {
  const user = users.get(bot.user_id);
  realtime.toAudience(user.id, 'user:update', users.toUser(user));
  realtime.toServer(server.id, 'user:update', users.toUser(user));
  return bots.toBot(bots.get(bot.id));
}

router.patch('/:id/bots/:botId/profile', (req, res) => {
  const server = access.permServer(req.params.id, req.user.id, 'manageBots');
  const bot = serverBot(server, req.params.botId);
  const fields = users.profileFields(req.body || {});
  users.update(bot.user_id, fields);
  audit.log(server.id, req.user.id, 'bot.update', users.get(bot.user_id).display_name, 'profile');
  res.json(botChanged(server, bot));
});

function setBotAvatar(server, bot, file) {
  const before = users.get(bot.user_id).avatar;
  users.update(bot.user_id, { avatar: file });
  if (before && !users.isDefaultAvatar(before) && before !== file) storage.remove(`avatars/${before}`);
  return botChanged(server, bot);
}

router.put('/:id/bots/:botId/avatar', rawImage, async (req, res) => {
  const server = access.permServer(req.params.id, req.user.id, 'manageBots');
  const bot = serverBot(server, req.params.botId);
  res.json(setBotAvatar(server, bot, await storage.saveImage('avatars', req.body)));
});

router.put('/:id/bots/:botId/avatar/default/:n', (req, res) => {
  const server = access.permServer(req.params.id, req.user.id, 'manageBots');
  const bot = serverBot(server, req.params.botId);
  // 1 to DEFAULT_AVATARS, or "bot" for the robot picture.
  const n = req.params.n === 'bot' ? 'bot' : Number(req.params.n);
  if (n !== 'bot' && (!Number.isInteger(n) || n < 1 || n > users.DEFAULT_AVATARS)) fail(400, 'No such default avatar.');
  res.json(setBotAvatar(server, bot, users.defaultAvatar(n)));
});

router.delete('/:id/bots/:botId/avatar', (req, res) => {
  const server = access.permServer(req.params.id, req.user.id, 'manageBots');
  const bot = serverBot(server, req.params.botId);
  res.json(setBotAvatar(server, bot, users.defaultAvatar('bot'))); // removing a picture goes back to the robot
});

// The bot's AI: endpoint, key, model, instructions, when it answers. The key is write-only.
router.put('/:id/bots/:botId/ai', (req, res) => {
  const server = access.permServer(req.params.id, req.user.id, 'manageBots');
  const bot = serverBot(server, req.params.botId);
  try { botAi.saveSettings(bot, req.body || {}); } catch (err) { fail(400, err.message); }
  audit.log(server.id, req.user.id, 'bot.update', users.get(bot.user_id).display_name, 'AI settings');
  res.json(bots.toBot(bots.get(bot.id)));
});

router.get('/:id/bots/:botId/ai/models', async (req, res) => {
  const server = access.permServer(req.params.id, req.user.id, 'manageBots');
  const bot = serverBot(server, req.params.botId);
  try {
    res.json(await botAi.listModels(bot));
  } catch (err) {
    if (err instanceof botAi.AiError) fail(400, err.message);
    throw err;
  }
});

// The builder's test chat: { messages: [{ role: 'user' | 'assistant', content }], channelId? } → { reply, trace }.
router.post('/:id/bots/:botId/ai/chat', async (req, res) => {
  const server = access.permServer(req.params.id, req.user.id, 'manageBots');
  const bot = serverBot(server, req.params.botId);
  const turns = (Array.isArray(req.body.messages) ? req.body.messages : []).slice(-40)
    .map((m) => ({ role: m?.role === 'assistant' ? 'assistant' : 'user', content: String(m?.content ?? '').slice(0, 4000) }))
    .filter((m) => m.content.trim());
  if (!turns.length) fail(400, 'Say something first.');
  const me = users.get(req.user.id);
  const named = turns.map((t) => (t.role === 'user' ? { ...t, content: `${me.display_name} (@${me.username}): ${t.content}` } : t));
  const channel = req.body.channelId ? channels.get(req.body.channelId) : null;
  const where = channel && channel.server_id === server.id && channel.kind === 'text' ? channel : null;
  try {
    res.json(await bots.testChat(bot, { turns: named, channel: where, user: users.toUser(me) }));
  } catch (err) {
    if (err instanceof botAi.AiError) fail(400, err.message);
    throw err;
  }
});

router.delete('/:id/bots/:botId', (req, res) => {
  const server = access.permServer(req.params.id, req.user.id, 'manageBots');
  const bot = serverBot(server, req.params.botId);
  const name = users.get(bot.user_id).display_name;
  bots.remove(bot);
  realtime.toServer(server.id, 'member:remove', { serverId: server.id, userId: bot.user_id });
  audit.log(server.id, req.user.id, 'bot.delete', name);
  res.sendStatus(204);
});

// --- audit log ---

router.get('/:id/audit-log', (req, res) => {
  const server = access.permServer(req.params.id, req.user.id, 'viewAuditLog');
  const before = typeof req.query.before === 'string' ? req.query.before : null;
  res.json(audit.list(server.id, { before }));
});

module.exports = { router, channelName, categoryName, withPresence, removeMember };
