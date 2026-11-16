// End-to-end test: starts a real server on a throwaway data folder and drives it over HTTP and /live.
// Run with: npm test               (the server as it runs on a computer)
//           npm run test:cf        (the Cloudflare version, in Wrangler's local Workers runtime)
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { liveClient } = require('./liveClient');

const ON_CLOUDFLARE = process.env.TARGET === 'cf';
const PORT = ON_CLOUDFLARE ? 8790 : 3190;
const BASE = `http://127.0.0.1:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencord-test-'));
const uploads = path.join(dataDir, 'uploads');
const OWNER_TOKEN = crypto.randomBytes(24).toString('hex');

// Checks that look at the upload folder directly. Cloudflare keeps files in Durable Objects, not a folder,
// so there these are skipped (the same code paths still run; only the peek at the disk is left out).
function onDisk(check) {
  if (!ON_CLOUDFLARE) check();
}

let passed = 0;
function ok(label) {
  passed += 1;
  console.log(`  ok  ${label}`);
}

// A logged-in browser stand-in: remembers its cookie.
// Every socket opened by the tests, so they can all be closed at the end (even after a failure).
const sockets = [];

class Client {
  jar = new Map(); // cookie name → value, like a browser keeps them

  get cookie() {
    return [...this.jar].map(([name, value]) => `${name}=${value}`).join('; ');
  }

  async request(method, url, body, headers = {}) {
    const isJson = body !== undefined && !Buffer.isBuffer(body);
    const res = await fetch(BASE + url, {
      method,
      headers: {
        cookie: this.cookie,
        ...(isJson ? { 'content-type': 'application/json' } : body ? { 'content-type': 'application/octet-stream' } : {}),
        ...headers,
      },
      body: isJson ? JSON.stringify(body) : body,
    });
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(';');
      const [name, value] = pair.trim().split('=');
      const cleared = !value || attrs.some((a) => /expires=Thu, 01 Jan 1970/i.test(a));
      if (cleared) this.jar.delete(name);
      else this.jar.set(name, value);
    }
    const type = res.headers.get('content-type') || '';
    const data = type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
    return { status: res.status, data, headers: res.headers };
  }

  // Expects success and returns the body.
  async call(method, url, body) {
    const res = await this.request(method, url, body);
    assert.ok(res.status < 300, `${method} ${url} → ${res.status} ${JSON.stringify(res.data)}`);
    return res.data;
  }

  async expect(status, method, url, body) {
    const res = await this.request(method, url, body);
    assert.equal(res.status, status, `${method} ${url} → ${res.status} ${JSON.stringify(res.data)}`);
    return res.data;
  }

  socket() {
    const socket = liveClient(BASE, { cookie: this.cookie });
    sockets.push(socket);
    return socket;
  }

  async upload(name, type, buffer) {
    const start = await this.call('POST', '/api/uploads', { name, size: buffer.length, type });
    if (start.attachment) return start.attachment;
    let offset = 0;
    for (;;) {
      const chunk = buffer.subarray(offset, offset + start.chunkSize);
      const res = await this.call('PUT', `/api/uploads/${start.id}?offset=${offset}`, chunk);
      offset = res.received;
      if (res.attachment) return res.attachment;
    }
  }
}

function nextEvent(socket, event, match = () => true) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`No "${event}" event arrived`)), 3000);
    const handler = (payload) => {
      if (!match(payload)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    };
    socket.on(event, handler);
  });
}

async function register(username) {
  const client = new Client();
  client.me = await client.call('POST', '/api/auth/register', { username, password: 'password123' });
  return client;
}

async function run() {
  // --- accounts ---
  const alice = await register('Alice');
  const bob = await register('bob');
  const carol = await register('carol');
  assert.equal(alice.me.username, 'alice');
  await new Client().expect(401, 'GET', '/api/bootstrap');
  await new Client().expect(409, 'POST', '/api/auth/register', { username: 'alice', password: 'password123' });
  await new Client().expect(400, 'POST', '/api/auth/register', { username: 'bad name!', password: 'password123' });
  await new Client().expect(400, 'POST', '/api/auth/register', { username: 'shorty', password: 'short' });
  await new Client().expect(401, 'POST', '/api/auth/login', { username: 'alice', password: 'wrong-password' });
  const res = await alice.request('POST', '/api/servers', { name: 'x' }, { origin: 'https://evil.example' });
  assert.equal(res.status, 403);
  const clock = await alice.call('GET', '/api/time');
  assert.ok(Math.abs(clock.now - Date.now()) < 5000);
  ok('register, login errors, cross-site requests refused');

  // --- realtime setup ---
  const aSock = alice.socket();
  const bSock = bob.socket();
  await Promise.all([nextEvent(aSock, 'connect'), nextEvent(bSock, 'connect')]);
  // Live connections: refused without a login, and refused from another site even with one.
  assert.equal(await nextEvent(liveClient(BASE), 'refused'), 401);
  assert.equal(await nextEvent(liveClient(BASE, { cookie: alice.cookie, origin: 'https://evil.example' }), 'refused'), 403);

  // --- friends ---
  let wait = nextEvent(bSock, 'relationship:update');
  let rel = await alice.call('POST', '/api/relationships', { username: 'bob' });
  assert.equal(rel.status, 'outgoing');
  assert.equal((await wait).status, 'incoming');
  await alice.expect(409, 'POST', '/api/relationships', { username: 'bob' });
  await alice.expect(400, 'POST', '/api/relationships', { username: 'alice' });
  await alice.expect(404, 'POST', '/api/relationships', { username: 'nobody' });
  wait = Promise.all([nextEvent(aSock, 'relationship:update'), nextEvent(aSock, 'presence', (p) => p.userId === bob.me.id)]);
  rel = await bob.call('PUT', `/api/relationships/${alice.me.id}`);
  assert.equal(rel.status, 'friend');
  const [relEvent, presence] = await wait;
  assert.equal(relEvent.status, 'friend');
  assert.equal(presence.online, true);
  ok('friend request, accept, realtime relationship + presence');

  // Both request each other → friends straight away.
  await carol.call('POST', '/api/relationships', { username: 'alice' });
  rel = await alice.call('POST', '/api/relationships', { username: 'carol' });
  assert.equal(rel.status, 'friend');
  await alice.call('DELETE', `/api/relationships/${carol.me.id}`);
  assert.equal((await carol.call('GET', '/api/bootstrap')).relationships.length, 0);
  ok('mutual requests become friends, remove friend');

  // --- DMs ---
  await carol.expect(403, 'POST', '/api/dms', { userId: alice.me.id });
  const dm = await alice.call('POST', '/api/dms', { userId: bob.me.id });
  assert.equal(dm.recipient.id, bob.me.id);
  assert.equal((await bob.call('GET', '/api/bootstrap')).dms.length, 0);
  wait = nextEvent(bSock, 'message:create');
  const dmMessage = await alice.call('POST', `/api/channels/${dm.id}/messages`, { content: 'hi **bob**' });
  assert.equal((await wait).id, dmMessage.id);
  const bobBoot = await bob.call('GET', '/api/bootstrap');
  assert.equal(bobBoot.dms[0].recipient.id, alice.me.id);
  assert.equal(bobBoot.readStates[dm.id], undefined);
  assert.ok(bobBoot.online.includes(alice.me.id));
  await carol.expect(404, 'GET', `/api/channels/${dm.id}/messages`);
  await bob.call('POST', `/api/channels/${dm.id}/ack`, { messageId: dmMessage.id });
  assert.equal((await bob.call('GET', '/api/bootstrap')).readStates[dm.id], dmMessage.id);
  ok('DM open, first message reaches the other person, unread + ack');

  // --- servers, invites ---
  const server = await alice.call('POST', '/api/servers', { name: 'Test Server' });
  const general = server.channels[0];
  assert.equal(general.name, 'general');
  await bob.expect(404, 'GET', `/api/channels/${general.id}/messages`);
  await bob.expect(404, 'POST', `/api/channels/${general.id}/messages`, { content: 'let me in' });
  const invite = await alice.call('POST', `/api/servers/${server.id}/invites`);
  assert.match(invite.code, /^[a-hjkmnp-z2-9]{8}$/);
  const preview = await new Client().call('GET', `/api/invites/${invite.code}`);
  assert.deepEqual(preview.server, { id: server.id, name: 'Test Server', icon: null, memberCount: 1 });
  await new Client().expect(401, 'POST', `/api/invites/${invite.code}`);
  await bob.expect(404, 'GET', '/api/invites/zzzzzzzz');
  wait = Promise.all([nextEvent(aSock, 'member:add'), nextEvent(bSock, 'server:create')]);
  await bob.call('POST', `/api/invites/${invite.code}`);
  await bob.call('POST', `/api/invites/${invite.code}`); // idempotent
  await wait;
  const members = await bob.call('GET', `/api/servers/${server.id}/members`);
  assert.equal(members.length, 2);
  assert.ok(members.every((m) => m.online));
  ok('create server, invite preview, join, member list');

  // --- channels ---
  await bob.expect(403, 'POST', `/api/servers/${server.id}/channels`, { name: 'nope' });
  wait = nextEvent(bSock, 'channel:create');
  const channel = await alice.call('POST', `/api/servers/${server.id}/channels`, { name: 'Off Topic' });
  assert.equal(channel.name, 'off-topic');
  assert.equal((await wait).id, channel.id);
  const patched = await alice.call('PATCH', `/api/channels/${channel.id}`, { topic: 'anything goes' });
  assert.equal(patched.topic, 'anything goes');
  ok('channels: create, rename/topic, owner only');

  // --- messages: send, typing, edit, delete, paging ---
  wait = nextEvent(aSock, 'typing');
  bSock.emit('typing', general.id);
  assert.deepEqual(await wait, { channelId: general.id, userId: bob.me.id });
  wait = nextEvent(aSock, 'message:create');
  const message = await bob.call('POST', `/api/channels/${general.id}/messages`, { content: 'hello' });
  assert.equal((await wait).content, 'hello');
  await bob.expect(400, 'POST', `/api/channels/${general.id}/messages`, { content: '   ' });
  const long = 'x'.repeat(1000);
  assert.equal((await bob.call('POST', `/api/channels/${general.id}/messages`, { content: long })).content.length, 1000);
  await bob.expect(400, 'POST', `/api/channels/${general.id}/messages`, { content: `${long}!` });
  await alice.expect(403, 'PATCH', `/api/messages/${message.id}`, { content: 'hacked' });
  wait = nextEvent(aSock, 'message:update');
  const edited = await bob.call('PATCH', `/api/messages/${message.id}`, { content: 'hello!' });
  assert.ok(edited.editedAt);
  assert.equal((await wait).content, 'hello!');
  wait = nextEvent(bSock, 'message:delete');
  await alice.call('DELETE', `/api/messages/${message.id}`); // owner deletes someone else's message
  assert.equal((await wait).id, message.id);
  for (let i = 0; i < 60; i++) await alice.call('POST', `/api/channels/${general.id}/messages`, { content: `m${i}` });
  const page = await bob.call('GET', `/api/channels/${general.id}/messages`);
  assert.equal(page.length, 50);
  assert.equal(page.at(-1).content, 'm59');
  const older = await bob.call('GET', `/api/channels/${general.id}/messages?before=${page[0].id}`);
  assert.equal(older.length, 11);
  assert.equal(older.at(-1).content, 'm9');
  ok('messages: realtime, typing, 1000-char limit, edit, owner delete, paging');

  // --- replies, reactions, pins, search ---
  const original = await alice.call('POST', `/api/channels/${general.id}/messages`, { content: 'pizza or tacos?' });
  const reply = await bob.call('POST', `/api/channels/${general.id}/messages`, { content: 'tacos 100%', replyToId: original.id });
  assert.deepEqual([reply.replyTo.id, reply.replyTo.author.id, reply.replyTo.content], [original.id, alice.me.id, 'pizza or tacos?']);
  await bob.expect(400, 'POST', `/api/channels/${channel.id}/messages`, { content: 'wrong channel', replyToId: original.id });
  wait = nextEvent(aSock, 'message:update', (m) => m.reactions.length);
  await bob.call('PUT', `/api/messages/${original.id}/reactions/${encodeURIComponent('🌮')}`);
  await alice.call('PUT', `/api/messages/${original.id}/reactions/${encodeURIComponent('🌮')}`);
  assert.deepEqual((await wait).reactions, [{ emoji: '🌮', userIds: [bob.me.id] }]);
  let reacted = await bob.call('PUT', `/api/messages/${original.id}/reactions/${encodeURIComponent('🌮')}`); // twice is fine
  assert.deepEqual(reacted.reactions[0].userIds, [bob.me.id, alice.me.id]);
  reacted = await bob.call('DELETE', `/api/messages/${original.id}/reactions/${encodeURIComponent('🌮')}`);
  assert.deepEqual(reacted.reactions, [{ emoji: '🌮', userIds: [alice.me.id] }]);
  await carol.expect(404, 'PUT', `/api/messages/${original.id}/reactions/x`);
  assert.equal((await bob.call('PUT', `/api/messages/${reply.id}/pin`)).pinned, true);
  assert.deepEqual((await alice.call('GET', `/api/channels/${general.id}/pins`)).map((m) => m.id), [reply.id]);
  await bob.call('DELETE', `/api/messages/${reply.id}/pin`);
  assert.equal((await alice.call('GET', `/api/channels/${general.id}/pins`)).length, 0);
  const found = await alice.call('GET', `/api/channels/${general.id}/search?q=${encodeURIComponent('TACOS')}`);
  assert.deepEqual(found.map((m) => m.id), [reply.id, original.id]);
  assert.equal((await alice.call('GET', `/api/channels/${general.id}/search?q=${encodeURIComponent('100%')}`)).length, 1);
  await alice.call('DELETE', `/api/messages/${original.id}`);
  const after = await bob.call('GET', `/api/channels/${general.id}/messages?limit=1`);
  assert.deepEqual(after[0].replyTo, { id: original.id, deleted: true });
  ok('replies, reactions, pins, search');

  // --- uploads ---
  const video = crypto.randomBytes(21 * 1024 * 1024);
  const attachment = await bob.upload('my clip.mp4', 'video/mp4', video);
  assert.equal(attachment.kind, 'video');
  assert.equal(attachment.size, video.length);
  const stored = path.join(uploads, 'videos', `${attachment.id}.mp4`);
  onDisk(() => {
    assert.equal(fs.statSync(stored).size, video.length);
    assert.equal(fs.readdirSync(path.join(uploads, 'tmp')).length, 0);
  });
  await alice.expect(404, 'GET', attachment.url); // unsent: uploader only
  await alice.expect(400, 'POST', `/api/channels/${general.id}/messages`, { attachmentIds: [attachment.id] });
  const withFile = await bob.call('POST', `/api/channels/${general.id}/messages`, { attachmentIds: [attachment.id] });
  assert.equal(withFile.attachments[0].id, attachment.id);
  await bob.expect(400, 'POST', `/api/channels/${general.id}/messages`, { attachmentIds: [attachment.id] });

  const full = await alice.request('GET', attachment.url);
  assert.equal(full.status, 200);
  assert.equal(full.headers.get('content-type'), 'video/mp4');
  assert.ok(full.data.equals(video));
  const range = await alice.request('GET', attachment.url, undefined, { range: 'bytes=1000000-1000099' });
  assert.equal(range.status, 206);
  assert.equal(range.headers.get('content-range'), `bytes 1000000-1000099/${video.length}`);
  assert.ok(range.data.equals(video.subarray(1000000, 1000100)));
  await carol.expect(404, 'GET', attachment.url);
  await new Client().expect(401, 'GET', attachment.url);
  ok('21 MB chunked upload, Range request, non-members refused');

  // Resume: a chunk at the wrong offset reports where to continue from.
  const start = await bob.call('POST', '/api/uploads', { name: 'page.html', size: 10, type: 'text/html' });
  await bob.call('PUT', `/api/uploads/${start.id}?offset=0`, Buffer.from('<b>hi'));
  const conflict = await bob.expect(409, 'PUT', `/api/uploads/${start.id}?offset=0`, Buffer.from('<b>hi'));
  assert.equal(conflict.received, 5);
  assert.deepEqual(await bob.call('GET', `/api/uploads/${start.id}`), { received: 5, size: 10 });
  await bob.expect(413, 'PUT', `/api/uploads/${start.id}?offset=5`, Buffer.from('way too many bytes'));
  assert.equal((await bob.call('GET', `/api/uploads/${start.id}`)).received, 5);
  const done = await bob.call('PUT', `/api/uploads/${start.id}?offset=5`, Buffer.from('</b>!'));
  assert.equal(done.attachment.kind, 'file');
  const html = await bob.request('GET', done.attachment.url);
  assert.equal(html.headers.get('content-type'), 'application/octet-stream');
  assert.match(html.headers.get('content-disposition'), /^attachment/);
  assert.equal(html.data.toString(), '<b>hi</b>!');
  const empty = await bob.upload('empty.txt', 'text/plain', Buffer.alloc(0));
  assert.equal(empty.size, 0);
  const cancelled = await bob.call('POST', '/api/uploads', { name: 'a.bin', size: 5, type: '' });
  await bob.call('DELETE', `/api/uploads/${cancelled.id}`);
  onDisk(() => assert.equal(fs.existsSync(path.join(uploads, 'tmp', cancelled.id)), false));
  ok('upload resume, oversized chunk rolled back, html served as download, empty file, cancel');

  // Deleting a message deletes its file.
  await bob.call('DELETE', `/api/messages/${withFile.id}`);
  onDisk(() => assert.equal(fs.existsSync(stored), false));
  await bob.expect(404, 'GET', attachment.url);
  ok('deleting a message deletes its files');

  // --- profile ---
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  assert.match(bob.me.avatar, /^\/avatars\/([1-9]|10)\.svg$/, 'new accounts start with a default avatar');
  assert.equal((await alice.request('GET', bob.me.avatar)).headers.get('content-type'), 'image/svg+xml');
  let me = await bob.call('PUT', '/api/users/@me/avatar/default/7');
  assert.equal(me.avatar, '/avatars/7.svg');
  await bob.expect(400, 'PUT', '/api/users/@me/avatar/default/11');
  await bob.expect(400, 'PUT', '/api/users/@me/avatar/default/0');
  wait = nextEvent(aSock, 'user:update', (u) => u.id === bob.me.id);
  me = await bob.call('PUT', '/api/users/@me/avatar', png);
  assert.match(me.avatar, /^\/media\/avatars\/.+\.png$/);
  assert.equal((await wait).avatar, me.avatar);
  assert.equal((await alice.request('GET', me.avatar)).headers.get('content-type'), 'image/png');
  await bob.expect(400, 'PUT', '/api/users/@me/avatar', Buffer.from('<svg onload=alert(1)>'));
  const firstAvatar = path.join(uploads, 'avatars', path.basename(me.avatar));
  me = await bob.call('PUT', '/api/users/@me/avatar', png);
  onDisk(() => assert.equal(fs.existsSync(firstAvatar), false));
  me = await bob.call('PATCH', '/api/users/@me', {
    displayName: 'Bobby', bio: 'hello', statusText: 'busy', bannerColor: '#ff8800', settings: { theme: 'oled' },
  });
  assert.deepEqual([me.displayName, me.bannerColor, me.settings.theme], ['Bobby', '#ff8800', 'oled']);
  await bob.expect(400, 'PATCH', '/api/users/@me', { bannerColor: 'red' });
  me = await bob.call('PATCH', '/api/users/@me', { bannerPattern: 'zigzag', bannerPatternColor: '#112233' });
  assert.deepEqual([me.bannerPattern, me.bannerPatternColor], ['zigzag', '#112233']);
  await bob.expect(400, 'PATCH', '/api/users/@me', { bannerPattern: 'tartan' });
  await bob.expect(400, 'PATCH', '/api/users/@me', { bannerPatternColor: 'blue' });
  assert.equal((await alice.call('GET', `/api/users/${bob.me.id}`)).bannerPattern, 'zigzag');
  await bob.expect(400, 'PATCH', '/api/users/@me', { bio: 'x'.repeat(191) });
  assert.equal((await alice.call('GET', `/api/users/${bob.me.id}`)).displayName, 'Bobby');
  me = await bob.call('DELETE', '/api/users/@me/avatar');
  assert.equal(me.avatar, null);
  ok('default avatars, avatar upload/replace/remove, profile + settings');

  // --- password change logs out other sessions ---
  const bob2 = new Client();
  await bob2.call('POST', '/api/auth/login', { username: 'BOB', password: 'password123' });
  const b2Sock = bob2.socket();
  await nextEvent(b2Sock, 'connect');
  wait = nextEvent(b2Sock, 'disconnect');
  await bob.expect(403, 'PUT', '/api/users/@me/password', { currentPassword: 'nope', newPassword: 'newpassword1' });
  await bob.call('PUT', '/api/users/@me/password', { currentPassword: 'password123', newPassword: 'newpassword1' });
  await wait;
  await bob2.expect(401, 'GET', '/api/users/@me');
  await bob.call('GET', '/api/users/@me');
  ok('change password logs out other sessions');

  // --- roles and the server banner ---
  const withBanner = await alice.call('PUT', `/api/servers/${server.id}/banner`, png);
  assert.match(withBanner.banner, /^\/media\/icons\//);
  await bob.expect(403, 'PUT', `/api/servers/${server.id}/banner`, png);
  await bob.expect(403, 'POST', `/api/servers/${server.id}/roles`, { name: 'Sneaky' });
  const mods = await alice.call('POST', `/api/servers/${server.id}/roles`, { name: 'Mods', color: '#e3a3a3', admin: true });
  const fans = await alice.call('POST', `/api/servers/${server.id}/roles`, { name: 'Fans', hoist: true });
  await alice.expect(400, 'POST', `/api/servers/${server.id}/roles`, { name: 'Bad', color: 'red' });
  wait = nextEvent(bSock, 'member:update', (e) => e.member.user.id === bob.me.id && e.member.roleIds.includes(fans.id));
  await alice.call('PUT', `/api/servers/${server.id}/members/${bob.me.id}/roles/${fans.id}`);
  await wait;
  await bob.expect(403, 'PUT', `/api/servers/${server.id}/members/${bob.me.id}/roles/${mods.id}`);
  await alice.call('PUT', `/api/servers/${server.id}/members/${bob.me.id}/roles/${mods.id}`);
  let bootstrapServer = (await bob.call('GET', '/api/bootstrap')).servers.find((s) => s.id === server.id);
  assert.ok(bootstrapServer.adminIds.includes(bob.me.id), 'an admin role makes you an admin');
  assert.deepEqual(bootstrapServer.roles.map((r) => r.name), ['Fans', 'Mods']);
  // Bob is an admin now (through the role) but still can't touch roles with admin powers.
  await bob.expect(403, 'PATCH', `/api/servers/${server.id}/roles/${mods.id}`, { name: 'Mine' });
  await bob.call('PATCH', `/api/servers/${server.id}/roles/${fans.id}`, { color: '#a9c79a' });
  await alice.call('PUT', `/api/servers/${server.id}/roles/order`, { ids: [mods.id, fans.id] });
  const bobMember = (await alice.call('GET', `/api/servers/${server.id}/members`)).find((m) => m.user.id === bob.me.id);
  assert.deepEqual(bobMember.roleIds, [mods.id, fans.id]);
  await alice.call('DELETE', `/api/servers/${server.id}/roles/${mods.id}`);
  bootstrapServer = (await bob.call('GET', '/api/bootstrap')).servers.find((s) => s.id === server.id);
  assert.ok(!bootstrapServer.adminIds.includes(bob.me.id), 'deleting the role takes the powers away');
  await bob.expect(403, 'POST', `/api/servers/${server.id}/roles`, { name: 'Again' });
  await alice.call('DELETE', `/api/servers/${server.id}/banner`);
  ok('roles: create, colour, hoist, admin powers, order, assign, delete; server banner');

  // --- message limit, posts channels, whiteboards ---
  await bob.expect(400, 'POST', `/api/channels/${general.id}/messages`, { content: 'x'.repeat(1001) });
  await bob.call('POST', `/api/channels/${general.id}/messages`, { content: 'y'.repeat(1000) });
  const forum = await alice.call('POST', `/api/servers/${server.id}/channels`, { name: 'Ideas', kind: 'posts' });
  assert.equal(forum.kind, 'posts');
  await bob.expect(400, 'POST', `/api/channels/${forum.id}/messages`, { content: 'not here' });
  await bob.expect(400, 'POST', `/api/channels/${forum.id}/posts`, { title: 'No body' });
  wait = nextEvent(aSock, 'post:create');
  const post = await bob.call('POST', `/api/channels/${forum.id}/posts`, { title: 'Game night?', content: 'Friday at 8' });
  assert.equal((await wait).id, post.id);
  assert.equal(post.title, 'Game night?');
  assert.equal(post.preview, 'Friday at 8');
  wait = nextEvent(bSock, 'message:create', (m) => m.channelId === post.id);
  await alice.call('POST', `/api/channels/${post.id}/messages`, { content: "I'm in" });
  await wait;
  let posts = await alice.call('GET', `/api/channels/${forum.id}/posts`);
  assert.deepEqual(posts.map((p) => [p.title, p.replies]), [['Game night?', 1]]);
  const boot = (await alice.call('GET', '/api/bootstrap')).servers.find((s) => s.id === server.id);
  assert.ok(!boot.channels.some((c) => c.kind === 'post'), 'posts stay out of the channel list');
  const renamed = await bob.call('PATCH', `/api/channels/${post.id}`, { name: 'Game night on Friday' });
  assert.equal(renamed.title, 'Game night on Friday');
  const second = await bob.call('POST', `/api/channels/${forum.id}/posts`, { title: 'Second', content: 'two' });
  await bob.call('DELETE', `/api/channels/${second.id}`);
  posts = await alice.call('GET', `/api/channels/${forum.id}/posts`);
  assert.equal(posts.length, 1);

  const board = await alice.call('POST', `/api/servers/${server.id}/channels`, { name: 'doodles', kind: 'whiteboard' });
  const liveSeen = nextEvent(aSock, 'wb:live', (e) => e.channelId === board.id);
  bSock.emit('wb:live', { channelId: board.id, key: 'k1', points: [[0, 0], [5, 5]], color: '#ff0000', size: 4 });
  assert.equal((await liveSeen).userId, bob.me.id);
  wait = nextEvent(aSock, 'wb:stroke', (e) => e.channelId === board.id);
  const saved = await new Promise((resolve) => bSock.emit('wb:stroke', { channelId: board.id, key: 'k1', points: [[0, 0], [5, 5], [10, 2]], color: '#ff0000', size: 4 }, resolve));
  assert.ok(saved.id);
  assert.equal((await wait).stroke.points.length, 3);
  const bad = await new Promise((resolve) => bSock.emit('wb:stroke', { channelId: board.id, points: 'nope' }, resolve));
  assert.ok(bad.error);
  assert.equal((await alice.call('GET', `/api/channels/${board.id}/strokes`)).length, 1);
  wait = nextEvent(bSock, 'wb:erase');
  aSock.emit('wb:erase', { channelId: board.id, id: saved.id });
  await wait;
  assert.equal((await bob.call('GET', `/api/channels/${board.id}/strokes`)).length, 0);
  await bob.expect(403, 'DELETE', `/api/channels/${board.id}/strokes`);
  await alice.call('DELETE', `/api/channels/${board.id}/strokes`);
  await alice.call('DELETE', `/api/channels/${forum.id}`);
  await alice.expect(404, 'GET', `/api/channels/${post.id}`);
  ok('1000-character limit; posts channels; whiteboard strokes live, saved, undone, cleared');

  // --- long messages are sent cut short; calendar, music and wiki channels ---
  const old = await bob.call('POST', `/api/channels/${general.id}/messages`, { content: 'short for now' });
  // Messages from before the limit can be huge: make one straight in the database (only possible on a computer).
  if (!ON_CLOUDFLARE) {
    const Database = require('better-sqlite3');
    const raw = new Database(path.join(dataDir, 'opencord.db'));
    raw.prepare('UPDATE messages SET content = ? WHERE id = ?').run('w'.repeat(50_000), old.id);
    raw.close();
    const listed = (await alice.call('GET', `/api/channels/${general.id}/messages?limit=5`)).find((m) => m.id === old.id);
    assert.ok(listed.truncated && listed.content.length < 2000 && listed.length === 50_000);
    assert.equal((await alice.call('GET', `/api/messages/${old.id}/content`)).content.length, 50_000);
  }

  const cal = await alice.call('POST', `/api/servers/${server.id}/channels`, { name: 'events', kind: 'calendar' });
  await bob.expect(400, 'POST', `/api/channels/${cal.id}/events`, { title: '', startsAt: Date.now() });
  await bob.expect(400, 'POST', `/api/channels/${cal.id}/events`, { title: 'Backwards', startsAt: 2000, endsAt: 1000 });
  wait = nextEvent(aSock, 'event:update', (e) => e.channelId === cal.id);
  const ev = await bob.call('POST', `/api/channels/${cal.id}/events`, { title: 'Game night', startsAt: Date.now() + 86_400_000, location: 'Lounge' });
  assert.equal((await wait).title, 'Game night');
  assert.deepEqual(ev.rsvps.going, [bob.me.id]);
  const answered = await alice.call('PUT', `/api/channels/${cal.id}/events/${ev.id}/rsvp`, { status: 'maybe' });
  assert.deepEqual(answered.rsvps.maybe, [alice.me.id]);
  await alice.call('PATCH', `/api/channels/${cal.id}/events/${ev.id}`, { title: 'Game night!' });
  await alice.call('PATCH', `/api/channels/${cal.id}`, { readOnly: true });
  await bob.expect(403, 'POST', `/api/channels/${cal.id}/events`, { title: 'Nope', startsAt: Date.now() });
  assert.equal((await bob.call('GET', `/api/channels/${cal.id}/events`))[0].title, 'Game night!');
  await bob.call('DELETE', `/api/channels/${cal.id}/events/${ev.id}`);
  assert.equal((await bob.call('GET', `/api/channels/${cal.id}/events`)).length, 0);

  const radio = await alice.call('POST', `/api/servers/${server.id}/channels`, { name: 'radio', kind: 'music' });
  await bob.expect(400, 'POST', `/api/channels/${radio.id}/music`, { url: 'https://example.com/not-music' });
  const song = await bob.upload('tune.mp3', 'audio/mpeg', Buffer.from('ID3fake-audio-bytes'));
  const songMsg = await bob.call('POST', `/api/channels/${general.id}/messages`, { attachmentIds: [song.id] });
  wait = nextEvent(aSock, 'music:update', (m) => m.channelId === radio.id);
  await bob.call('POST', `/api/channels/${radio.id}/music`, { url: songMsg.attachments[0].url });
  let music = await wait;
  assert.equal(music.queue.length, 1);
  assert.equal(music.playing.itemId, music.queue[0].id, 'the first song starts by itself');
  await alice.call('POST', `/api/channels/${radio.id}/music`, { url: songMsg.attachments[0].url });
  music = await alice.call('POST', `/api/channels/${radio.id}/music/control`, { action: 'pause' });
  assert.ok(music.playing.pausedAt);
  music = await alice.call('POST', `/api/channels/${radio.id}/music/control`, { action: 'play' });
  assert.equal(music.playing.pausedAt, null);
  const firstId = music.playing.itemId;
  await bob.call('POST', `/api/channels/${radio.id}/music/control`, { action: 'ended', itemId: firstId });
  music = await bob.call('POST', `/api/channels/${radio.id}/music/control`, { action: 'ended', itemId: firstId });
  assert.equal(music.queue.length, 2, 'played songs stay in the playlist');
  assert.equal(music.playing.itemId, music.queue[1].id, 'two "ended" for the same song only skip once');
  music = await bob.call('POST', `/api/channels/${radio.id}/music/control`, { action: 'previous', itemId: music.playing.itemId });
  assert.equal(music.playing.itemId, firstId, 'previous goes back a song');
  music = await bob.call('POST', `/api/channels/${radio.id}/music/control`, { action: 'jump', itemId: music.queue[1].id });
  assert.equal(music.playing.itemId, music.queue[1].id, 'any song can be picked');
  music = await bob.call('POST', `/api/channels/${radio.id}/music/control`, { action: 'ended', itemId: music.queue[1].id });
  assert.equal(music.playing, null, 'the playlist stops at the end');
  await bob.expect(403, 'DELETE', `/api/channels/${radio.id}/music/${music.queue[1].id}`);
  await alice.call('DELETE', `/api/channels/${radio.id}/music/${music.queue[1].id}`);
  assert.equal((await bob.call('GET', `/api/channels/${radio.id}/music`)).queue.length, 1);
  // Video channels use the same shared player: YouTube links and uploaded videos queue and play in sync.
  const tv = await alice.call('POST', `/api/servers/${server.id}/channels`, { name: 'tv', kind: 'video' });
  music = await bob.call('POST', `/api/channels/${tv.id}/music`, { url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw', title: 'Me at the zoo' });
  assert.equal(music.queue[0].title, 'Me at the zoo');
  assert.equal(music.playing.itemId, music.queue[0].id);
  const clip = await bob.upload('clip.mp4', 'video/mp4', Buffer.from('fake-mp4-bytes'));
  const tvClip = await bob.call('POST', `/api/channels/${tv.id}/videos`, { attachmentId: clip.id });
  music = await bob.call('POST', `/api/channels/${tv.id}/music`, { url: tvClip.source });
  assert.equal(music.queue[1].kind, 'video');
  assert.equal(music.playing.itemId, music.queue[0].id, 'queued, not played');
  music = await alice.call('POST', `/api/channels/${tv.id}/music`, { url: tvClip.source, playNow: true });
  assert.equal(music.playing.itemId, music.queue[2].id, 'play now starts it for everyone');
  await bob.expect(400, 'POST', `/api/channels/${tv.id}/music`, { url: songMsg.attachments[0].url }); // audio isn't a video
  await bob.expect(400, 'POST', `/api/channels/${radio.id}/music`, { url: tvClip.source }); // nor a video a song

  const wiki = await alice.call('POST', `/api/servers/${server.id}/channels`, { name: 'guide', kind: 'wiki' });
  wait = nextEvent(aSock, 'wiki:update', (p) => p.channelId === wiki.id);
  const home = await bob.call('POST', `/api/channels/${wiki.id}/pages`, { title: 'Home', content: '# Welcome\nSee [[Rules]].' });
  await wait;
  await alice.expect(400, 'POST', `/api/channels/${wiki.id}/pages`, { title: 'home', content: '' });
  await alice.call('PUT', `/api/channels/${wiki.id}/pages/${home.id}`, { title: 'Home', content: '# Welcome!' });
  const history = await bob.call('GET', `/api/channels/${wiki.id}/pages/${home.id}/history`);
  assert.equal(history[0].content, '# Welcome\nSee [[Rules]].');
  assert.equal((await bob.call('GET', `/api/channels/${wiki.id}/pages/${home.id}`)).content, '# Welcome!');
  assert.deepEqual((await bob.call('GET', `/api/channels/${wiki.id}/pages`)).map((p) => p.title), ['Home']);
  await bob.expect(403, 'DELETE', `/api/channels/${wiki.id}/pages/${home.id}`);
  await alice.call('DELETE', `/api/channels/${wiki.id}/pages/${home.id}`);
  await bob.expect(400, 'POST', `/api/channels/${wiki.id}/messages`, { content: 'not a chat' });
  for (const c of [cal, radio, wiki]) await alice.call('DELETE', `/api/channels/${c.id}`);
  ok('long messages sent cut short; calendar events and RSVPs; music queue in sync; wiki pages with history');

  // --- DM pings and DM calls ---
  await alice.call('POST', `/api/channels/${dm.id}/messages`, { content: 'ping one' });
  const last = await alice.call('POST', `/api/channels/${dm.id}/messages`, { content: 'ping two' });
  assert.equal((await bob.call('GET', '/api/bootstrap')).dmPings[dm.id], 2);
  await bob.call('POST', `/api/channels/${dm.id}/ack`, { messageId: last.id });
  assert.equal((await bob.call('GET', '/api/bootstrap')).dmPings[dm.id], undefined);
  const ring = nextEvent(bSock, 'call:ring', (e) => e.channelId === dm.id);
  const callNote = nextEvent(bSock, 'message:create', (m) => m.channelId === dm.id && m.components?.[0]?.type === 'call');
  const joined = await new Promise((resolve) => aSock.emit('voice:join', dm.id, resolve));
  assert.ok(joined.self && !joined.error);
  assert.equal((await ring).userId, alice.me.id);
  const note = await callNote;
  assert.ok(note.components[0].startedAt && !note.components[0].endedAt);
  wait = nextEvent(bSock, 'message:update', (m) => m.id === note.id && m.components[0].endedAt);
  aSock.emit('voice:leave');
  await wait; // the note now says how long the call lasted
  ok('DM pings count unread DMs; DM calls ring the other person');

  // --- bots can hand out and manage roles ---
  const bot = await alice.call('POST', `/api/servers/${server.id}/bots`, { name: 'Roley' });
  await alice.call('PATCH', `/api/servers/${server.id}/bots/${bot.id}`, { admin: true });
  const memberRole = await alice.call('POST', `/api/servers/${server.id}/roles`, { name: 'Members' });
  await alice.call('PATCH', `/api/servers/${server.id}/bots/${bot.id}`, {
    enabled: true,
    program: [
      { trigger: { type: 'command', name: 'join' }, blocks: [{ type: 'give_role', target: 'person', role: 'members' }] },
      { trigger: { type: 'command', name: 'newrole' }, blocks: [{ type: 'create_role', role: '{arg1}', color: '#123456' }] },
    ],
  });
  wait = nextEvent(aSock, 'member:update', (e) => e.member.user.id === bob.me.id && e.member.roleIds.includes(memberRole.id));
  await bob.call('POST', `/api/channels/${general.id}/messages`, { content: '!join' });
  await wait;
  wait = nextEvent(aSock, 'server:update', (e) => e.roles.some((r) => r.name === 'Gamers'));
  await bob.call('POST', `/api/channels/${general.id}/messages`, { content: '!newrole Gamers' });
  assert.equal((await wait).roles.find((r) => r.name === 'Gamers').color, '#123456');
  await alice.call('DELETE', `/api/servers/${server.id}/bots/${bot.id}`);
  ok('bots give roles and create roles');

  // --- role mentions, bot buttons and new blocks, webhooks, community and privacy settings ---
  const pingRole = await alice.call('POST', `/api/servers/${server.id}/roles`, { name: 'Gamers' + Date.now().toString(36).slice(-3) });
  await alice.call('PUT', `/api/servers/${server.id}/members/${bob.me.id}/roles/${pingRole.id}`);
  wait = nextEvent(bSock, 'notification', (n) => n.kind === 'role');
  await alice.call('POST', `/api/channels/${general.id}/messages`, { content: `<@&${pingRole.id}> game time` });
  await wait; // admins can always mention a role
  const erin = await register('erin');
  const erinInvite = await alice.call('POST', `/api/servers/${server.id}/invites`, {});
  await erin.call('POST', `/api/invites/${erinInvite.code}`);
  await erin.call('POST', `/api/channels/${general.id}/messages`, { content: `<@&${pingRole.id}> not mentionable yet` });
  assert.ok(!(await bob.call('GET', '/api/notifications')).some((n) => n.message?.content?.includes('not mentionable')));
  await alice.call('PATCH', `/api/servers/${server.id}/roles/${pingRole.id}`, { mentionable: true });
  wait = nextEvent(bSock, 'notification', (n) => n.kind === 'role' && n.message.author.id === erin.me.id);
  await erin.call('POST', `/api/channels/${general.id}/messages`, { content: `<@&${pingRole.id}> now it is` });
  await wait;

  const buttonBot = await alice.call('POST', `/api/servers/${server.id}/bots`, { name: 'Buttons' });
  await alice.call('PATCH', `/api/servers/${server.id}/bots/${buttonBot.id}`, {
    enabled: true,
    program: [
      { trigger: { type: 'command', name: 'team', description: 'Pick a team' }, blocks: [{ type: 'buttons', text: 'Pick:', options: ['Red', 'Blue'] }] },
      { trigger: { type: 'button', text: 'Red' }, blocks: [
        { type: 'math', name: 'reds', left: '{var.reds}', math: '+', right: '1' },
        { type: 'list_add', name: 'team', value: '{user}' },
        { type: 'if', left: '', op: 'has_role', right: pingRole.name, do: [{ type: 'reply', text: 'red {var.reds} {list.team.length} {button}' }], else: [] },
      ] },
    ],
  });
  {
    const listed = (await bob.call('GET', '/api/bootstrap')).servers.find((x) => x.id === server.id).commands;
    assert.ok(listed.some((c) => c.name === 'team' && c.description === 'Pick a team'), 'bot commands are listed for the / menu');
  }
  wait = nextEvent(bSock, 'message:create', (m) => m.components?.length === 2);
  await bob.call('POST', `/api/channels/${general.id}/messages`, { content: '/team' });
  const picker = await wait;
  wait = nextEvent(bSock, 'message:create', (m) => m.content.startsWith('red '));
  await bob.call('POST', `/api/messages/${picker.id}/buttons/0`);
  assert.equal((await wait).content, 'red 1 1 Red');
  await bob.expect(404, 'POST', `/api/messages/${picker.id}/buttons/5`);
  await alice.call('DELETE', `/api/servers/${server.id}/bots/${buttonBot.id}`);

  await bob.expect(403, 'POST', `/api/servers/${server.id}/webhooks`, { name: 'x', channelId: general.id });
  const hook = await alice.call('POST', `/api/servers/${server.id}/webhooks`, { name: 'CI', channelId: general.id });
  assert.match(hook.url, /^\/api\/webhooks\//);
  wait = nextEvent(bSock, 'message:create', (m) => m.content === 'Build passed');
  const anon = new Client();
  await anon.call('POST', hook.url, { content: 'Build passed' });
  assert.equal((await wait).author.displayName, 'CI');
  await anon.expect(404, 'POST', `${hook.url}x`, { content: 'nope' });
  await alice.call('DELETE', `/api/servers/${server.id}/webhooks/${hook.id}`);
  await anon.expect(404, 'POST', hook.url, { content: 'gone' });

  await alice.call('PATCH', `/api/servers/${server.id}`, { welcomeChannelId: general.id, welcomeMessage: 'Hi {user}, welcome to {server}', memberWait: 600, invitesAdminOnly: true, pinsAdminOnly: true });
  const frank = await register('frank');
  wait = nextEvent(aSock, 'message:create', (m) => m.content.startsWith('Hi @frank'));
  await frank.call('POST', `/api/invites/${erinInvite.code}`);
  assert.equal((await wait).author.displayName, 'Opencord');
  await frank.expect(403, 'POST', `/api/channels/${general.id}/messages`, { content: 'too soon' });
  await erin.expect(403, 'POST', `/api/servers/${server.id}/invites`, {});
  const pinMe = await alice.call('POST', `/api/channels/${general.id}/messages`, { content: 'pin me' });
  await erin.expect(403, 'PUT', `/api/messages/${pinMe.id}/pin`);
  await alice.call('PATCH', `/api/servers/${server.id}`, { welcomeChannelId: null, memberWait: 0, invitesAdminOnly: false, pinsAdminOnly: false });
  await frank.call('POST', `/api/channels/${general.id}/messages`, { content: 'now I can' });

  await erin.call('PATCH', '/api/users/@me', { settings: { dmsFrom: 'friends', friendRequestsFrom: 'nobody' } });
  await frank.expect(403, 'POST', '/api/dms', { userId: erin.me.id });
  await frank.expect(403, 'POST', '/api/relationships', { username: 'erin' });
  ok('role mentions; bot / commands, buttons, maths and lists; webhooks; welcome, new-member wait, invite and pin rules; privacy settings');

  // --- linked channels, message links, bot menus, several accounts on one browser ---
  const otherServer = await alice.call('POST', '/api/servers', { name: 'Second Server' });
  const secondGeneral = otherServer.channels[0];
  await bob.expect(403, 'GET', `/api/channels/${general.id}/links`);
  const linkInfo = await alice.call('GET', `/api/channels/${general.id}/links`);
  assert.ok(linkInfo.candidates.some((c) => c.id === secondGeneral.id));
  await alice.call('POST', `/api/channels/${general.id}/links`, { channelId: secondGeneral.id });
  wait = nextEvent(aSock, 'message:create', (m) => m.channelId === secondGeneral.id);
  const relayed = await bob.call('POST', `/api/channels/${general.id}/messages`, { content: 'hello both servers' });
  const relayCopy = await wait;
  assert.equal(relayCopy.content, 'hello both servers');
  assert.equal(relayCopy.author.id, bob.me.id);
  assert.equal(relayCopy.relay.channel, general.name);
  wait = nextEvent(aSock, 'message:update', (m) => m.id === relayCopy.id);
  await bob.call('PATCH', `/api/messages/${relayed.id}`, { content: 'edited everywhere' });
  assert.equal((await wait).content, 'edited everywhere');
  wait = nextEvent(aSock, 'message:delete', (m) => m.id === relayCopy.id);
  await bob.call('DELETE', `/api/messages/${relayed.id}`);
  await wait;
  await alice.call('DELETE', `/api/channels/${general.id}/links`);
  assert.equal((await alice.call('GET', `/api/channels/${general.id}/links`)).linked.length, 0);
  await alice.call('DELETE', `/api/servers/${otherServer.id}`);

  const quoted = await alice.call('POST', `/api/channels/${general.id}/messages`, { content: 'quote me' });
  assert.equal((await bob.call('GET', `/api/messages/${quoted.id}`)).content, 'quote me');
  await (await register('outsider')).expect(404, 'GET', `/api/messages/${quoted.id}`);

  const menuBot = await alice.call('POST', `/api/servers/${server.id}/bots`, { name: 'Menus' });
  await alice.call('PATCH', `/api/servers/${server.id}/bots/${menuBot.id}`, {
    enabled: true,
    program: [
      { trigger: { type: 'command', name: 'pick' }, blocks: [{ type: 'menu_send', text: 'Which?', name: 'Pick a game', options: ['Chess', 'Go'] }] },
      { trigger: { type: 'menu', text: '' }, blocks: [{ type: 'reply', text: 'you picked {choice}' }] },
    ],
  });
  wait = nextEvent(bSock, 'message:create', (m) => m.components?.[0]?.type === 'menu');
  await bob.call('POST', `/api/channels/${general.id}/messages`, { content: '!pick' });
  const menuMsg = await wait;
  await bob.expect(400, 'POST', `/api/messages/${menuMsg.id}/menus/0`, { value: 'Poker' });
  await new Promise((resolve) => setTimeout(resolve, 1100)); // one click a second per person
  wait = nextEvent(bSock, 'message:create', (m) => m.content === 'you picked Go');
  await bob.call('POST', `/api/messages/${menuMsg.id}/menus/0`, { value: 'Go' });
  await wait;
  await alice.call('DELETE', `/api/servers/${server.id}/bots/${menuBot.id}`);

  // One browser, two accounts: adding keeps the first; switching swaps; logging out opens the other.
  const browser = await register('multi1');
  await browser.call('POST', '/api/auth/register', { username: 'multi2', password: 'password123', add: true });
  let accounts = await browser.call('GET', '/api/auth/accounts');
  assert.deepEqual(accounts.map((a) => [a.username, a.current]), [['multi2', true], ['multi1', false]]);
  await browser.call('POST', '/api/auth/accounts/switch', { userId: accounts[1].id });
  assert.equal((await browser.call('GET', '/api/users/@me')).username, 'multi1');
  await browser.expect(404, 'POST', '/api/auth/accounts/switch', { userId: alice.me.id });
  await browser.call('POST', '/api/auth/register', { username: 'multi3', password: 'password123', add: true });
  const multi3 = (await browser.call('GET', '/api/auth/accounts')).find((a) => a.username === 'multi3');
  await browser.call('POST', '/api/auth/accounts/switch', { userId: accounts[1].id });
  await browser.call('POST', '/api/auth/accounts/remove', { userId: multi3.id });
  assert.ok(!(await browser.call('GET', '/api/auth/accounts')).some((a) => a.username === 'multi3'), 'a removed account leaves the switcher');
  const loggedOut = await browser.call('POST', '/api/auth/logout');
  assert.equal(loggedOut.switched, true);
  assert.equal((await browser.call('GET', '/api/users/@me')).username, 'multi2');
  assert.equal((await browser.call('POST', '/api/auth/logout')).switched, false);
  await browser.expect(401, 'GET', '/api/users/@me');
  ok('linked channels copy, edit and delete; message links; bot menus; several accounts, switching, logout to the next');

  // --- bot profiles: name, status, bio, banner and picture, by whoever manages bots ---
  {
    const bot = await alice.call('POST', `/api/servers/${server.id}/bots`, { name: 'Pretty' });
    assert.equal(bot.user.avatar, '/avatars/bot.svg', 'new bots get the robot picture');
    await bob.expect(403, 'PATCH', `/api/servers/${server.id}/bots/${bot.id}/profile`, { bio: 'hacked' });
    const wait = nextEvent(bSock, 'user:update', (u) => u.id === bot.user.id && u.bio === 'I help out');
    const updated = await alice.call('PATCH', `/api/servers/${server.id}/bots/${bot.id}/profile`, {
      displayName: 'Pretty Bot', statusText: 'Watching #general', bio: 'I help out', bannerColor: '#ff8800', bannerPattern: 'dots', bannerPatternColor: null,
    });
    await wait;
    assert.equal(updated.user.displayName, 'Pretty Bot');
    assert.equal(updated.user.statusText, 'Watching #general');
    assert.equal(updated.user.bannerPattern, 'dots');
    await alice.expect(400, 'PATCH', `/api/servers/${server.id}/bots/${bot.id}/profile`, { bannerColor: 'red' });
    await alice.expect(400, 'PATCH', `/api/servers/${server.id}/bots/${bot.id}/profile`, { displayName: '' });
    assert.equal((await alice.call('PUT', `/api/servers/${server.id}/bots/${bot.id}/avatar/default/3`)).user.avatar, '/avatars/3.svg');
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    const uploaded = await alice.request('PUT', `/api/servers/${server.id}/bots/${bot.id}/avatar`, png);
    assert.equal(uploaded.status, 200, JSON.stringify(uploaded.data));
    assert.match(uploaded.data.user.avatar, /^\/media\/avatars\//);
    assert.equal((await alice.call('PUT', `/api/servers/${server.id}/bots/${bot.id}/avatar/default/bot`)).user.avatar, '/avatars/bot.svg');
    assert.equal((await alice.call('DELETE', `/api/servers/${server.id}/bots/${bot.id}/avatar`)).user.avatar, '/avatars/bot.svg');
    await alice.call('DELETE', `/api/servers/${server.id}/bots/${bot.id}`);
  }
  ok('bot profiles: name, status, bio, banner, default and uploaded pictures; only for bot managers');

  // --- Scratch-style blocks: reporters in inputs, if/else, repeat, variables and lists ---
  {
    const bot = await alice.call('POST', `/api/servers/${server.id}/bots`, { name: 'Counter' });
    await alice.call('PATCH', `/api/servers/${server.id}/bots/${bot.id}`, {
      enabled: true,
      program: [{ trigger: { type: 'command', name: 'count' }, blocks: [
        { type: 'set', name: 'n', value: '0' },
        { type: 'list_clear', name: 'seen' },
        { type: 'repeat', times: { r: 'word', a: '1' }, do: [
          { type: 'change', name: 'n', value: 2 },
          { type: 'list_add', name: 'seen', value: { r: 'var', name: 'n' } },
        ] },
        { type: 'list_delete', name: 'seen', index: 'last' },
        { type: 'if_else', cond: { r: 'and', a: { r: 'gt', a: { r: 'var', name: 'n' }, b: '5' }, b: { r: 'list_contains', name: 'seen', a: '4' } },
          do: [{ type: 'reply', text: { r: 'join', a: { r: 'join', a: { r: 'mul', a: { r: 'var', name: 'n' }, b: '10' }, b: ' ' }, b: { r: 'join', a: { r: 'list', name: 'seen' }, b: { r: 'join', a: ' ', b: { r: 'case', fn: 'upper', a: { r: 'letter', a: '1', b: { r: 'user_name' } } } } } } }],
          else: [{ type: 'reply', text: 'small' }] },
      ] }],
    });
    let wait = nextEvent(bSock, 'message:create', (m) => m.author.id === bot.user.id);
    await bob.call('POST', `/api/channels/${general.id}/messages`, { content: '/count 3' });
    assert.equal((await wait).content, '60 2 4 B');
    wait = nextEvent(bSock, 'message:create', (m) => m.author.id === bot.user.id);
    await bob.call('POST', `/api/channels/${general.id}/messages`, { content: '/count 1' });
    assert.equal((await wait).content, 'small');
    await alice.expect(400, 'PATCH', `/api/servers/${server.id}/bots/${bot.id}`, { program: [{ trigger: { type: 'command', name: 'x' }, blocks: [{ type: 'reply', text: { r: 'nope' } }] }] });
    await alice.call('DELETE', `/api/servers/${server.id}/bots/${bot.id}`);
  }
  ok('Scratch-style blocks: reporters in inputs, if/else with and, repeat, variables, lists, join, letter, case');

  // --- AI bots: a pretend OpenAI-style and Anthropic-style service on this machine ---
  if (!ON_CLOUDFLARE) await aiBots(alice, bob, server, general, bSock);

  // --- role and channel permissions ---
  await bob.expect(403, 'POST', `/api/servers/${server.id}/channels`, { name: 'nope' });
  const builders = await alice.call('POST', `/api/servers/${server.id}/roles`, { name: 'Builders', perms: ['manageChannels', 'manageRoles', 'bogus'] });
  assert.deepEqual(builders.perms, ['manageChannels', 'manageRoles']);
  await alice.call('PUT', `/api/servers/${server.id}/members/${bob.me.id}/roles/${builders.id}`);
  const bobChannel = await bob.call('POST', `/api/servers/${server.id}/channels`, { name: 'bobs-room' });
  await bob.expect(403, 'PATCH', `/api/servers/${server.id}`, { name: 'Bob’s now' }); // no manageServer
  await bob.expect(403, 'GET', `/api/servers/${server.id}/audit-log`);
  // A role manager who isn't an admin can't hand out permissions.
  const plain = await bob.call('POST', `/api/servers/${server.id}/roles`, { name: 'Plain' });
  await bob.expect(403, 'PATCH', `/api/servers/${server.id}/roles/${plain.id}`, { perms: ['manageServer'] });
  await bob.expect(403, 'POST', `/api/servers/${server.id}/roles`, { name: 'Sneaky', perms: ['manageServer'] });

  // A channel only one role can see: others can't read it or get its messages.
  const vip = await alice.call('POST', `/api/servers/${server.id}/roles`, { name: 'VIP' });
  const secret = await alice.call('POST', `/api/servers/${server.id}/channels`, { name: 'vip-room' });
  await alice.call('PATCH', `/api/channels/${secret.id}`, { viewRoles: [vip.id] });
  await alice.call('DELETE', `/api/servers/${server.id}/members/${bob.me.id}/roles/${builders.id}`);
  await bob.expect(404, 'GET', `/api/channels/${secret.id}/messages`);
  let leaked = false;
  const spy = (m) => { if (m.channelId === secret.id) leaked = true; };
  bSock.on('message:create', spy);
  await alice.call('POST', `/api/channels/${secret.id}/messages`, { content: 'vips only' });
  await new Promise((resolve) => setTimeout(resolve, 300));
  bSock.off('message:create', spy);
  assert.equal(leaked, false, 'a hidden channel’s messages don’t reach people who can’t see it');
  await alice.call('PUT', `/api/servers/${server.id}/members/${bob.me.id}/roles/${vip.id}`);
  assert.equal((await bob.call('GET', `/api/channels/${secret.id}/messages`))[0].content, 'vips only');

  // Who can post: admins only, plus a picked role.
  await alice.call('PATCH', `/api/channels/${secret.id}`, { readOnly: true, postRoles: [] });
  await bob.expect(403, 'POST', `/api/channels/${secret.id}/messages`, { content: 'can I?' });
  await alice.call('PATCH', `/api/channels/${secret.id}`, { postRoles: [vip.id] });
  await bob.call('POST', `/api/channels/${secret.id}/messages`, { content: 'yes I can' });
  await alice.expect(400, 'PATCH', `/api/channels/${secret.id}`, { viewRoles: ['not-a-role'] });

  // @everyone only pings for people allowed to use it.
  await bob.call('POST', `/api/channels/${general.id}/messages`, { content: '@everyone hello?' });
  assert.ok(!(await alice.call('GET', '/api/notifications')).some((n) => n.kind === 'everyone' && n.actorId === bob.me.id));
  for (const id of [builders.id, plain.id, vip.id]) await alice.call('DELETE', `/api/servers/${server.id}/roles/${id}`);
  for (const id of [bobChannel.id, secret.id]) await alice.call('DELETE', `/api/channels/${id}`);
  ok('role permissions; hidden channels stay hidden; who can post; @everyone needs permission');

  // --- server icon, rename, kick, leave ---
  wait = nextEvent(bSock, 'server:update');
  const withIcon = await alice.call('PUT', `/api/servers/${server.id}/icon`, png);
  assert.match(withIcon.icon, /^\/media\/icons\//);
  await wait;
  await bob.expect(403, 'PATCH', `/api/servers/${server.id}`, { name: 'Mine now' });
  assert.equal((await alice.call('PATCH', `/api/servers/${server.id}`, { name: 'Renamed' })).name, 'Renamed');
  await alice.expect(400, 'DELETE', `/api/servers/${server.id}/members/@me`);
  await bob.expect(403, 'DELETE', `/api/servers/${server.id}/members/${alice.me.id}`);
  wait = nextEvent(bSock, 'server:delete');
  await alice.call('DELETE', `/api/servers/${server.id}/members/${bob.me.id}`);
  await wait;
  await bob.expect(404, 'GET', `/api/channels/${general.id}/messages`);
  await bob.call('POST', `/api/invites/${invite.code}`);
  wait = nextEvent(aSock, 'member:remove');
  await bob.call('DELETE', `/api/servers/${server.id}/members/@me`);
  await wait;
  ok('server icon, rename, kick, leave');

  // --- blocking ---
  wait = nextEvent(bSock, 'relationship:remove');
  rel = await alice.call('POST', `/api/relationships/${bob.me.id}/block`);
  assert.equal(rel.status, 'blocked');
  await wait;
  assert.equal((await bob.call('GET', '/api/bootstrap')).relationships.length, 0);
  await bob.expect(403, 'POST', `/api/channels/${dm.id}/messages`, { content: 'hello?' });
  await bob.expect(403, 'POST', '/api/dms', { userId: alice.me.id });
  await bob.expect(403, 'POST', '/api/relationships', { username: 'alice' });
  await alice.call('DELETE', `/api/relationships/${bob.me.id}`);
  assert.equal((await bob.call('POST', '/api/relationships', { username: 'alice' })).status, 'outgoing');
  ok('blocking stops DMs and requests, unblock');

  // --- deleting a channel / server removes files ---
  const pic = await alice.upload('pic.png', 'image/png', png);
  await alice.call('POST', `/api/channels/${channel.id}/messages`, { content: 'look', attachmentIds: [pic.id] });
  const pic2 = await alice.upload('pic2.png', 'image/png', png);
  await alice.call('POST', `/api/channels/${general.id}/messages`, { attachmentIds: [pic2.id] });
  const picPath = (a) => path.join(uploads, 'images', `${a.id}.png`);
  onDisk(() => assert.ok(fs.existsSync(picPath(pic)) && fs.existsSync(picPath(pic2))));
  await alice.call('DELETE', `/api/channels/${channel.id}`);
  onDisk(() => assert.equal(fs.existsSync(picPath(pic)), false));
  await alice.call('DELETE', `/api/servers/${server.id}`);
  onDisk(() => {
    assert.equal(fs.existsSync(picPath(pic2)), false);
    assert.equal(fs.readdirSync(path.join(uploads, 'icons')).length, 0);
  });
  assert.equal((await alice.call('GET', '/api/bootstrap')).servers.length, 0);
  ok('deleting a channel or server deletes its files');

  // --- presence + logout ---
  await bob.call('PUT', `/api/relationships/${alice.me.id}`).catch(() => {});
  await alice.call('PUT', `/api/relationships/${bob.me.id}`);
  wait = nextEvent(aSock, 'presence', (p) => p.userId === bob.me.id && !p.online);
  await bob.call('POST', '/api/auth/logout');
  await wait;
  await bob.expect(401, 'GET', '/api/users/@me');
  ok('logout disconnects sockets and shows offline');

  // --- app dashboard (owner/admin only) ---
  await alice.expect(404, 'GET', '/api/admin/overview');
  // Becoming the owner: the one-time claim with the secret token (wrong token refused), or set-role on a computer.
  await alice.expect(403, 'POST', '/api/admin/claim-owner', { token: 'not-the-token-at-all', username: 'alice' });
  if (ON_CLOUDFLARE) {
    await new Client().call('POST', '/api/admin/claim-owner', { token: OWNER_TOKEN, username: 'alice' });
  } else {
    execFileSync(process.execPath, ['scripts/set-role.js', 'alice', 'owner'], {
      cwd: path.join(__dirname, '..'), env: { ...process.env, DATA_DIR: dataDir }, stdio: 'ignore',
    });
  }
  await new Client().expect(409, 'POST', '/api/admin/claim-owner', { token: OWNER_TOKEN, username: 'bob' });
  assert.equal((await alice.call('GET', '/api/users/@me')).appRole, 'owner');
  const overview = await alice.call('GET', '/api/admin/overview');
  assert.ok(overview.totals.people >= 2 && overview.totals.messages > 0);
  assert.ok(overview.active.today >= 1 && overview.days.requests.at(-1).n > 0);
  assert.equal(overview.days.messages.length, 30);
  const people = await alice.call('GET', '/api/admin/people');
  assert.equal(people.find((p) => p.username === 'alice').appRole, 'owner');
  assert.equal((await alice.call('PUT', `/api/admin/people/${bob.me.id}/role`, { role: 'admin' })).appRole, 'admin');
  await alice.expect(400, 'PUT', `/api/admin/people/${bob.me.id}/role`, { role: 'owner' });
  await alice.expect(400, 'PUT', `/api/admin/people/${alice.me.id}/role`, { role: null });
  await alice.call('PUT', `/api/admin/people/${bob.me.id}/role`, { role: null });
  assert.ok(Array.isArray(await alice.call('GET', '/api/admin/servers')));
  ok('app dashboard: hidden from others, owner sees stats and manages admins');

  // --- abuse protection ---
  await new Client().expect(400, 'POST', '/api/auth/register', { username: 'admin', password: 'password123' });
  await new Client().expect(400, 'POST', '/api/auth/register', { username: 'opencord_team', password: 'password123' });
  await alice.expect(413, 'POST', '/api/uploads', { name: 'huge.bin', size: 51 * 1024 * 1024, type: 'application/octet-stream' });
  const abuseServer = await alice.call('POST', '/api/servers', { name: 'Abuse test' });
  const reactTo = await alice.call('POST', `/api/channels/${abuseServer.channels[0].id}/messages`, { content: 'react to me' });
  for (let i = 0; i < 20; i++) await alice.call('PUT', `/api/messages/${reactTo.id}/reactions/${encodeURIComponent(`r${i}`)}`);
  await alice.expect(400, 'PUT', `/api/messages/${reactTo.id}/reactions/one-too-many`);
  await alice.call('PUT', `/api/messages/${reactTo.id}/reactions/r0`); // an existing one is fine
  // Suspending logs someone out at once and keeps them out.
  const mallory = await register('mallory');
  await alice.call('PUT', `/api/admin/people/${mallory.me.id}/suspension`, { suspended: true });
  await mallory.expect(401, 'GET', '/api/users/@me');
  await new Client().expect(403, 'POST', '/api/auth/login', { username: 'mallory', password: 'password123' });
  await alice.expect(400, 'PUT', `/api/admin/people/${alice.me.id}/suspension`, { suspended: true });
  await alice.call('PUT', `/api/admin/people/${mallory.me.id}/suspension`, { suspended: false });
  await new Client().call('POST', '/api/auth/login', { username: 'mallory', password: 'password123' });
  // Sign-up modes: closed, and invite-only (needs a working invite).
  await alice.call('PUT', '/api/admin/registration', { mode: 'closed' });
  await new Client().expect(403, 'POST', '/api/auth/register', { username: 'latecomer', password: 'password123' });
  await alice.call('PUT', '/api/admin/registration', { mode: 'invite' });
  await new Client().expect(403, 'POST', '/api/auth/register', { username: 'latecomer', password: 'password123' });
  await new Client().expect(404, 'POST', '/api/auth/register', { username: 'latecomer', password: 'password123', inviteCode: 'nope1234' });
  const signupServer = abuseServer;
  const signupInvite = await alice.call('POST', `/api/servers/${signupServer.id}/invites`, {});
  const invited = new Client();
  invited.me = await invited.call('POST', '/api/auth/register', { username: 'latecomer', password: 'password123', inviteCode: signupInvite.code });
  assert.ok((await invited.call('GET', '/api/bootstrap')).servers.some((s) => s.id === signupServer.id));
  await alice.call('PUT', '/api/admin/registration', { mode: 'open' });
  const report = await alice.call('GET', '/api/admin/overview');
  assert.ok(report.limits.sizes.find((l) => l.kind === 'reactionsPerMessage').hitsToday >= 1);
  assert.ok(report.limits.sizes.find((l) => l.kind === 'fileBytes').hitsToday >= 1);
  ok('abuse protection: reserved names, upload and reaction limits, suspension, sign-up modes');

  // --- Dev: the dashboard as a private server ---
  const { serverId: hqId } = await alice.call('POST', '/api/admin/hq');
  const hqServer = (await alice.call('GET', '/api/bootstrap')).servers.find((x) => x.id === hqId);
  assert.equal(hqServer.name, 'Dev');
  assert.equal(hqServer.icon, '/avatars/lock.svg');
  const hqNames = hqServer.channels.map((c) => c.name);
  for (const name of ['OVERVIEW', 'today', 'free-plan', 'limits', 'users', 'sign-ups', 'activity', 'servers']) assert.ok(hqNames.includes(name), name);
  const hqChannel = (name) => hqServer.channels.find((c) => c.name === name);
  const todayMsg = (await alice.call('GET', `/api/channels/${hqChannel('today').id}/messages`))[0];
  assert.equal(todayMsg.author.avatar, '/avatars/lock.svg');
  assert.ok(todayMsg.components.some((c) => c.type === 'tiles') && todayMsg.components.some((c) => c.type === 'table'));
  // #users: one table of everyone; each person links to their stats.
  const usersMsg = (await alice.call('GET', `/api/channels/${hqChannel('users').id}/messages`))[0];
  const table = usersMsg.components.find((c) => c.type === 'table');
  const malloryRow = table.rows.find((r) => r[0].user?.username === 'mallory');
  assert.ok(malloryRow);
  const detail = await alice.call('GET', `/api/admin/people/${malloryRow[0].user.id}?tz=-60`);
  assert.equal(detail.user.username, 'mallory');
  assert.equal(detail.messagesPerDay.length, 30);
  assert.equal(detail.onlineByHour.length, 24);
  assert.ok(typeof detail.counts.onlineMinutes === 'number' && typeof detail.counts.friends === 'number');
  await carol.expect(404, 'GET', `/api/admin/people/${malloryRow[0].user.id}`);
  // Nobody else can see it unless the owner invites them.
  await carol.expect(404, 'GET', `/api/channels/${hqChannel('today').id}/messages`);
  assert.ok(!(await carol.call('GET', '/api/bootstrap')).servers.some((x) => x.id === hqId));
  // The sign-ups buttons work, only for the owner; a table isn't a button.
  const signupMsg = (await alice.call('GET', `/api/channels/${hqChannel('sign-ups').id}/messages`))[0];
  const closedIndex = signupMsg.components.findIndex((c) => c.label === 'Closed');
  await carol.expect(404, 'POST', `/api/messages/${signupMsg.id}/buttons/${closedIndex}`);
  await alice.expect(404, 'POST', `/api/messages/${signupMsg.id}/buttons/${signupMsg.components.findIndex((c) => c.type === 'table')}`);
  await new Promise((resolve) => setTimeout(resolve, 1100)); // buttons are limited to one a second
  await alice.call('POST', `/api/messages/${signupMsg.id}/buttons/${closedIndex}`);
  await new Client().expect(403, 'POST', '/api/auth/register', { username: 'toolate', password: 'password123' });
  await alice.call('PUT', '/api/admin/registration', { mode: 'open' });
  // Refreshing edits in place, never re-posts.
  await alice.call('POST', '/api/admin/hq');
  assert.equal((await alice.call('GET', `/api/channels/${hqChannel('today').id}/messages`)).length, 1);
  // A per-channel refresh updates just that channel; a category has nothing to refresh.
  assert.equal((await alice.call('POST', '/api/admin/hq', { channelId: hqChannel('users').id })).ok, true);
  assert.equal((await alice.call('POST', '/api/admin/hq', { channelId: hqChannel('OVERVIEW').id })).ok, false);
  // A new account shows up in #users straight away.
  await register('newcomer');
  const usersTable2 = (await alice.call('GET', `/api/channels/${hqChannel('users').id}/messages`))[0].components.find((c) => c.type === 'table');
  assert.ok(usersTable2.rows.some((r) => r[0].user?.username === 'newcomer'));
  // The owner can invite people; they can read it, but can't invite others or press its buttons, and a refresh
  // doesn't throw them out.
  const hqInvite = await alice.call('POST', `/api/servers/${hqId}/invites`, {});
  await carol.call('POST', `/api/invites/${hqInvite.code}`);
  assert.ok((await carol.call('GET', '/api/bootstrap')).servers.some((x) => x.id === hqId));
  assert.ok((await carol.call('GET', `/api/channels/${hqChannel('today').id}/messages`)).length);
  await carol.expect(403, 'POST', `/api/servers/${hqId}/invites`, {});
  await carol.expect(403, 'POST', `/api/messages/${signupMsg.id}/buttons/${closedIndex}`);
  await alice.call('POST', '/api/admin/hq');
  assert.ok((await carol.call('GET', '/api/bootstrap')).servers.some((x) => x.id === hqId));
  ok('Dev: dashboard server, tables and charts, person stats, owner-only invites and buttons');

  // --- pages and headers ---
  const page1 = await new Client().request('GET', '/channels/@me');
  assert.match(page1.headers.get('content-type'), /html/);
  assert.match(page1.headers.get('content-security-policy'), /script-src 'self'/);
  // A missing file is a 404 on a computer; Cloudflare's single-page mode answers with the app page instead, which
  // a browser won't run as a script (nosniff), so either is safe.
  if (ON_CLOUDFLARE) assert.match((await new Client().request('GET', '/js/missing.js')).headers.get('content-type'), /html/);
  else await new Client().expect(404, 'GET', '/js/missing.js');
  await alice.expect(404, 'GET', '/api/nope');
  ok('SPA fallback, security headers, 404s');

}

// A stand-in AI service. OpenAI format at /v1, Anthropic format at /anthropic/v1. It calls the "roll_dice"
// tool when asked to roll, says what the tool returned, and otherwise echoes the last thing it was told.
function fakeAi() {
  const http = require('node:http');
  const seen = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const send = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
      if (req.method === 'GET' && req.url.startsWith('/v1/models')) return send(200, { data: [{ id: 'fake-1' }, { id: 'fake-2' }] });
      const body = raw ? JSON.parse(raw) : {};
      seen.push({ url: req.url, headers: req.headers, body });
      if (body.model === 'broken') return send(401, { error: { message: 'Incorrect API key provided' } });
      // Tools are plain text: the model writes <tool name="…">{…}</tool>, the bot answers "Tool results…".
      const anthropic = req.url.startsWith('/anthropic/');
      const system = anthropic ? body.system : body.messages[0].content;
      const last = body.messages.at(-1);
      const lastText = String(last.content).split('\n').at(-1);
      const say = (text) => send(200, anthropic ? { content: [{ type: 'text', text }], stop_reason: 'end_turn' } : { choices: [{ message: { role: 'assistant', content: text } }] });
      const has = (tool) => system.includes(`- ${tool}:`);
      if (String(last.content).startsWith('Tool results')) return say(`Tool said: ${String(last.content).split('\n')[1].replace(/^[\w-]+: /, '')}`);
      if (/roll/i.test(lastText) && has('roll_dice')) return say(`Sure!\n<tool name="roll_dice">{"sides": ${anthropic ? 20 : 6}}</tool>`);
      if (/make a channel/i.test(lastText) && has('create_channel')) return say('<tool name="create_channel">{"name": "AI Made"}</tool>');
      return say(`${anthropic ? 'Claude echo' : 'Echo'}: ${lastText}`);
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, seen, base: `http://127.0.0.1:${server.address().port}` })));
}

async function aiBots(alice, bob, server, general, bSock) {
  const ai = await fakeAi();
  const base = `/api/servers/${server.id}/bots`;
  try {
    const bot = await alice.call('POST', base, { name: 'Brainy' });
    const connect = { type: 'ai_connect', url: `${ai.base}/v1`, key: 'sk-test-123', model: 'fake-1' };
    await alice.call('PATCH', `${base}/${bot.id}`, {
      enabled: true,
      program: [
        { trigger: { type: 'ai_message' }, blocks: [
          connect,
          { type: 'ai_instructions', text: 'Be a pirate.' },
          { type: 'if_else', cond: { r: 'contains', a: { r: 'said' }, b: 'secret' }, do: [{ type: 'reply', text: 'no secrets' }], else: [{ type: 'ai_reply' }] },
        ] },
        { trigger: { type: 'tool', name: 'Roll Dice', description: 'Roll a dice', options: ['sides (number): how many sides', 'note?: optional'] }, blocks: [
          { type: 'set', name: 'rolled', value: { r: 'tool_input', name: 'sides' } },
          { type: 'ai_tell', text: { r: 'join', a: 'rolled a ', b: { r: 'join', a: { r: 'var', name: 'rolled' }, b: { r: 'join', a: ' for ', b: { r: 'user_name' } } } } },
        ] },
        { trigger: { type: 'command', name: 'haiku' }, blocks: [
          connect,
          { type: 'reply', text: { r: 'ai_answer', a: { r: 'join', a: 'haiku about ', b: { r: 'words' } } } },
        ] },
      ],
    });
    const program = (await alice.call('GET', base)).find((b) => b.id === bot.id).program;
    assert.equal(program[1].trigger.name, 'roll_dice', 'tool names are tidied for the AI');

    // @mention: the AI answers as a reply, with the key and instructions sent along.
    let wait = nextEvent(bSock, 'message:create', (m) => m.author.id === bot.user.id);
    await bob.call('POST', `/api/channels/${general.id}/messages`, { content: `hey @${bot.user.username} how are you` });
    let answer = await wait;
    assert.match(answer.content, /^Echo: Bobby \(@bob\): hey @bot_\w+ how are you$/);
    assert.ok(answer.replyTo, 'the answer is a reply');
    const first = ai.seen.at(-1);
    assert.equal(first.headers.authorization, 'Bearer sk-test-123');
    assert.match(first.body.messages[0].content, /Be a pirate\./);
    assert.ok(!first.body.tools, 'tools are text, not the API\'s function calling');
    assert.match(first.body.messages[0].content, /- roll_dice: Roll a dice\n  inputs: "sides" \(number\) how many sides; "note" \(string, optional\) optional/);

    // A tool call runs the blocks under the tool hat and sends what they "tell the AI" back.
    wait = nextEvent(bSock, 'message:create', (m) => m.author.id === bot.user.id);
    await bob.call('POST', `/api/channels/${general.id}/messages`, { content: `@${bot.user.username} roll for me` });
    answer = await wait;
    assert.match(answer.content, /^Tool said: rolled a 6 for Bobby/);

    // Replies to the bot wake it too; an if block can answer without the AI; unrelated messages are ignored.
    wait = nextEvent(bSock, 'message:create', (m) => m.author.id === bot.user.id);
    await bob.call('POST', `/api/channels/${general.id}/messages`, { content: 'tell me a secret', replyToId: answer.id });
    assert.equal((await wait).content, 'no secrets');
    const calls = ai.seen.length;
    await bob.call('POST', `/api/channels/${general.id}/messages`, { content: 'just chatting' });
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(ai.seen.length, calls, 'unrelated messages are ignored');

    // The "AI answer to" reporter inside a reply.
    wait = nextEvent(bSock, 'message:create', (m) => m.author.id === bot.user.id);
    await bob.call('POST', `/api/channels/${general.id}/messages`, { content: '/haiku the sea' });
    assert.equal((await wait).content, 'Echo: haiku about the sea');

    // DMs with the bot.
    const dm = await bob.call('POST', '/api/dms', { userId: bot.user.id });
    wait = nextEvent(bSock, 'message:create', (m) => m.author.id === bot.user.id && m.channelId === dm.id);
    await bob.call('POST', `/api/channels/${dm.id}/messages`, { content: 'hello in private' });
    assert.match((await wait).content, /Echo: .*hello in private/);

    // The built-in guide is always there; server actions only when the bot AND the person are allowed.
    let wait2 = nextEvent(bSock, 'message:create', (m) => m.author.id === bot.user.id);
    await bob.call('POST', `/api/channels/${general.id}/messages`, { content: `@${bot.user.username} make a channel` });
    await wait2;
    let req = ai.seen.at(-1);
    assert.match(req.body.messages[0].content, /Opencord/);
    assert.match(req.body.messages[0].content, /You are not an admin of this server/);
    assert.ok(!req.body.messages[0].content.includes('- create_channel:'), 'no server tools while the bot is not an admin');
    await alice.call('PATCH', `${base}/${bot.id}`, { admin: true });
    wait2 = nextEvent(bSock, 'message:create', (m) => m.author.id === bot.user.id);
    await bob.call('POST', `/api/channels/${general.id}/messages`, { content: `@${bot.user.username} make a channel` });
    await wait2;
    req = ai.seen.at(-1);
    assert.match(req.body.messages[0].content, /doesn't have permission/);
    assert.ok(!req.body.messages[0].content.includes('- create_channel:'), 'no server tools for a member without permission');
    wait2 = nextEvent(bSock, 'message:create', (m) => m.author.id === bot.user.id);
    await alice.call('POST', `/api/channels/${general.id}/messages`, { content: `@${bot.user.username} make a channel` });
    assert.match((await wait2).content, /Tool said: Created the text channel #ai-made\./);
    assert.match(ai.seen.at(-1).body.messages[0].content, /may ask you to: create channel/);
    const made = (await alice.call('GET', '/api/bootstrap')).servers.find((x) => x.id === server.id).channels.find((c) => c.name === 'ai-made');
    assert.ok(made, 'the channel exists');
    await alice.call('DELETE', `/api/channels/${made.id}`).catch(() => {});
    await alice.call('PATCH', `${base}/${bot.id}`, { admin: false });

    // Anthropic's format, picked from the address.
    await alice.call('PATCH', `${base}/${bot.id}`, {
      program: [
        { trigger: { type: 'ai_message' }, blocks: [{ type: 'ai_connect', url: `${ai.base}/anthropic/v1`, key: 'sk-ant', model: 'claude-test' }, { type: 'ai_reply' }] },
        { trigger: { type: 'tool', name: 'roll_dice', description: 'Roll', options: ['sides (number)'] }, blocks: [{ type: 'ai_tell', text: { r: 'join', a: 'got ', b: { r: 'tool_input', name: 'sides' } } }] },
      ],
    });
    wait = nextEvent(bSock, 'message:create', (m) => m.author.id === bot.user.id);
    await bob.call('POST', `/api/channels/${general.id}/messages`, { content: `@${bot.user.username} roll please` });
    assert.equal((await wait).content, 'Tool said: got 20');
    const sent = ai.seen.at(-1);
    assert.equal(sent.headers['x-api-key'], 'sk-ant');
    assert.match(sent.body.system, /"sides" \(number\)/);

    // Errors come back readable, as the bot's reply.
    await alice.call('PATCH', `${base}/${bot.id}`, {
      program: [{ trigger: { type: 'ai_message' }, blocks: [{ type: 'ai_connect', url: `${ai.base}/v1`, key: 'x', model: 'broken' }, { type: 'ai_reply' }] }],
    });
    wait = nextEvent(bSock, 'message:create', (m) => m.author.id === bot.user.id);
    await bob.call('POST', `/api/channels/${general.id}/messages`, { content: `@${bot.user.username} hi` });
    assert.match((await wait).content, /Incorrect API key/);
    await alice.call('DELETE', `${base}/${bot.id}`);
  } finally {
    ai.server.close();
  }
  ok('AI bots from blocks: use AI, talk-to-me, replies, DMs, tools with inputs, AI answer reporter, guide prompt, server actions only for allowed people, Anthropic format, readable errors');
}

// The server under test: Node, or the Worker in Wrangler's local runtime (with its own throwaway storage).
function startServer() {
  const env = { ...process.env, REGISTRATION: 'open', LIMITS_SCALE: '1000', OWNER_CLAIM_TOKEN: OWNER_TOKEN, AI_ALLOW_LOCAL: '1' };
  if (!ON_CLOUDFLARE) {
    return spawn(process.execPath, ['server/index.js'], {
      cwd: path.join(__dirname, '..'),
      env: { ...env, PORT: String(PORT), HOST: '127.0.0.1', DATA_DIR: dataDir },
      stdio: ['ignore', 'pipe', 'inherit'],
    });
  }
  const vars = ['REGISTRATION', 'LIMITS_SCALE', 'OWNER_CLAIM_TOKEN'].flatMap((k) => ['--var', `${k}:${env[k]}`]);
  return spawn('npx', ['wrangler', 'dev', '--port', String(PORT), '--ip', '127.0.0.1', '--persist-to', dataDir, '--log-level', 'warn', ...vars], {
    cwd: path.join(__dirname, '..'), env, stdio: ['ignore', 'pipe', 'inherit'], detached: true,
  });
}

// Wrangler runs under npx, so stop the whole process group.
function stopServer(server) {
  try {
    if (ON_CLOUDFLARE) process.kill(-server.pid, 'SIGTERM');
    else server.kill();
  } catch {
    // already gone
  }
}

async function waitUntilUp() {
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`${BASE}/api/bootstrap`)).status === 401) return;
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('The server did not start.');
}

async function main() {
  if (ON_CLOUDFLARE) execFileSync(process.execPath, ['scripts/build-worker.js'], { cwd: path.join(__dirname, '..'), stdio: 'ignore' });
  const server = startServer();
  server.stdout.on('data', () => {});
  await waitUntilUp();
  try {
    await run();
    console.log(`\nAll ${passed} groups passed.`);
  } catch (err) {
    console.error(`\nFAILED after ${passed} groups:\n`, err);
    process.exitCode = 1;
  } finally {
    for (const socket of sockets) socket.close();
    stopServer(server);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

main();
