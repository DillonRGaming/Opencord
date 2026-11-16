// Dev: the owner's dashboard, as a server. Only the owner is in it (no invites, no joining). An "Opencord" bot posts
// the numbers as messages with real tables, tiles and charts (drawn by public/js/views/rich.js) and keeps editing
// them in place. Clicking anyone in a table opens their stats page (public/js/views/personStats.js).
//
//   OVERVIEW  #today      online now, today's numbers, who's been most active
//             #free-plan  Cloudflare's free allowances and what happens if they run out
//             #limits     every limit, and which ones stopped someone
//   PEOPLE    #users      everyone, newest first
//             #sign-ups   open / invite only / closed, and the latest accounts
//   ACTIVITY  #activity   the last 30 days as charts
//             #servers    the busiest servers
const db = require('../db');
const platform = require('../platform');
const users = require('../models/users');
const servers = require('../models/servers');
const channels = require('../models/channels');
const messages = require('../models/messages');
const appSettings = require('../models/appSettings');
const realtime = require('../realtime');
const stats = require('./stats');
const { postMessage } = require('./post');
const { fail } = require('./http');

const NAME = 'Dev';
const LOGO = '@default/1'; // the lock logo on green, like the favicon
const LAYOUT = [
  ['OVERVIEW', ['today', 'free-plan', 'limits']],
  ['PEOPLE', ['users', 'sign-ups']],
  ['ACTIVITY', ['activity', 'servers']],
];
const TOPICS = {
  today: 'Right now and today', 'free-plan': "Cloudflare's free allowances", limits: 'Every limit and how often it fired',
  users: 'Everyone, newest first. Click anyone for their stats', 'sign-ups': 'Who may make an account',
  activity: 'The last 30 days', servers: 'Busiest servers',
};
const FREE_REQUESTS = 100000;
const DAY_MS = 86400000;
const USERS_PER_MESSAGE = 50;

// --- small helpers ---

const n = (x) => Number(x || 0).toLocaleString('en-US');
const when = (ms) => (ms ? `<t:${Math.floor(ms / 1000)}:R>` : 'never');
const escape = (text) => String(text).replace(/[*_~|`\\<]/g, '\\$&');
const userCell = (u, sub) => ({ user: users.toUser(u), sub });
const shortDay = (day) => new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const ago = (ms) => {
  if (!ms) return 'never';
  const mins = Math.round((Date.now() - ms) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
};
const minutes = (m) => (m >= 60 ? `${Math.floor(m / 60)}h ${Math.round(m % 60)}m` : `${Math.round(m)}m`);
function untilReset() {
  const now = new Date();
  const mins = Math.round((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) - now) / 60000);
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}
const bytes = (x) => (x >= 1024 ** 3 ? `${(x / 1024 ** 3).toFixed(2)} GB` : x >= 1024 ** 2 ? `${(x / 1024 ** 2).toFixed(1)} MB` : `${Math.round(x / 1024)} KB`);

// --- the server itself ---

const state = () => appSettings.get('hq', null);
const saveState = (s) => appSettings.set('hq', s);

function owner() {
  return db.prepare("SELECT * FROM users WHERE app_role = 'owner' AND is_bot = 0 LIMIT 1").get() || null;
}

function isHq(serverId) {
  return Boolean(serverId) && state()?.serverId === serverId;
}

// Makes (or repairs) Dev: the bot, the server with the owner as its only member, the categories and channels.
function ensure() {
  const boss = owner();
  if (!boss) return null;
  const s = state() || { messages: {} };
  if (!s.botId || !users.get(s.botId)) {
    const bot = users.create({ username: `opencord_hq_${Math.random().toString(36).slice(2, 7)}`, displayName: 'Opencord', passwordHash: '!hq' });
    db.prepare('UPDATE users SET is_bot = 1 WHERE id = ?').run(bot.id);
    s.botId = bot.id;
  }
  if (users.get(s.botId).avatar !== LOGO) users.update(s.botId, { avatar: LOGO });
  let server = s.serverId && servers.get(s.serverId);
  if (!server) {
    server = servers.create(boss.id, NAME);
    for (const c of channels.forServer(server.id)) channels.remove(c.id); // no #general
    s.serverId = server.id;
    s.channels = {};
    s.messages = {};
    realtime.joinServer(boss.id, server.id);
  }
  if (server.name !== NAME || server.icon !== LOGO) servers.update(server.id, { name: NAME, icon: LOGO });
  // The owner (and only the owner) is in it, and owns it; the bot is in it to post.
  if (server.owner_id !== boss.id) servers.update(server.id, { ownerId: boss.id });
  for (const id of servers.memberIds(server.id)) if (id !== boss.id && id !== s.botId) servers.removeMember(server.id, id);
  if (!servers.isMember(server.id, boss.id)) { servers.addMember(server.id, boss.id); realtime.joinServer(boss.id, server.id); }
  if (!servers.isMember(server.id, s.botId)) servers.addMember(server.id, s.botId);

  // Channels: make what's missing, and drop ones from older layouts.
  s.channels ||= {};
  const wanted = new Set();
  for (const [category, names] of LAYOUT) {
    const catKey = `#${category}`;
    wanted.add(catKey);
    if (!s.channels[catKey] || !channels.get(s.channels[catKey])) s.channels[catKey] = channels.create(server.id, category, { kind: 'category' }).id;
    for (const name of names) {
      wanted.add(name);
      if (s.channels[name] && channels.get(s.channels[name])) continue;
      const channel = channels.create(server.id, name, { parentId: s.channels[catKey] });
      channels.update(channel.id, { topic: TOPICS[name], readOnly: 1 });
      s.channels[name] = channel.id;
    }
  }
  for (const [key, id] of Object.entries(s.channels)) {
    if (wanted.has(key)) continue;
    if (channels.get(id)) channels.remove(id);
    delete s.channels[key];
  }
  // Keep the order of LAYOUT (channels added later would otherwise go to the end).
  channels.reorder(server.id, LAYOUT.flatMap(([category, names]) => [s.channels[`#${category}`], ...names.map((x) => s.channels[x])]));
  for (const [key, id] of Object.entries(s.messages)) if (!messages.get(id)) delete s.messages[key];
  saveState(s);
  realtime.toUser(boss.id, 'server:update', servers.toServer(servers.get(server.id)));
  return s;
}

// One message per key: posted once, then edited in place (without the "edited" mark) when it changes.
function upsert(s, channelName, key, content, components = null) {
  const channel = channels.get(s.channels[channelName]);
  if (!channel) return;
  const parts = components ? JSON.stringify(components) : null;
  const existing = s.messages[key] && messages.get(s.messages[key]);
  if (existing) {
    if (existing.content === content && (existing.components || null) === parts) return;
    db.prepare('UPDATE messages SET content = ?, components = ? WHERE id = ?').run(content, parts, existing.id);
    realtime.toChannel(channel, 'message:update', messages.serialize(messages.get(existing.id)));
    return;
  }
  s.messages[key] = postMessage(channel, s.botId, content, { components }).id;
}

// Takes away messages whose keys start with `prefix` but aren't in `keep`.
function prune(s, prefix, keep) {
  for (const key of Object.keys(s.messages)) {
    if (!key.startsWith(prefix) || keep.has(key)) continue;
    const row = messages.get(s.messages[key]);
    if (row) {
      messages.remove(row);
      realtime.toChannel(channels.get(row.channel_id), 'message:delete', { id: row.id, channelId: row.channel_id });
    }
    delete s.messages[key];
  }
}

// --- the numbers ---

function onlineMinutesByUser(since) {
  const now = Date.now();
  const rows = db.prepare(`SELECT user_id, SUM(MIN(COALESCE(ended_at, ?), ?) - MAX(started_at, ?)) ms FROM online_spans
    WHERE COALESCE(ended_at, ?) > ? GROUP BY user_id`).all(now, now, since, now, since);
  return new Map(rows.map((r) => [r.user_id, r.ms / 60000]));
}

function lastOnline(userId) {
  if (realtime.isOnline(userId)) return null;
  return db.prepare('SELECT MAX(COALESCE(ended_at, started_at)) t FROM online_spans WHERE user_id = ?').get(userId).t
    || users.get(userId)?.last_seen || null;
}

// --- what each channel shows ---

function today(s, o) {
  const humans = db.prepare('SELECT * FROM users WHERE is_bot = 0').all();
  const online = humans.filter((u) => realtime.isOnline(u.id));
  const midnight = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  const busiest = db.prepare(`SELECT author_id, COUNT(*) n FROM messages m JOIN users u ON u.id = m.author_id
    WHERE m.created_at >= ? AND u.is_bot = 0 GROUP BY author_id ORDER BY n DESC LIMIT 10`).all(midnight);
  const onlineToday = onlineMinutesByUser(midnight);
  upsert(s, 'today', 'today', `# Today\n-# Updated ${when(Date.now())} · every 10 minutes, or press Refresh`, [
    { type: 'tiles', items: [
      { label: 'Online now', value: n(o.active.now) },
      { label: 'Active today', value: n(o.active.today), sub: `${n(o.active.week)} this week · ${n(o.active.month)} this month` },
      { label: 'Messages today', value: n(o.days.messages.at(-1).n), sub: `${n(o.totals.messages)} in all` },
      { label: 'New accounts today', value: n(o.days.signups.at(-1).n), sub: `${n(o.totals.people)} people in all` },
      { label: 'Came back', value: o.retention.joinedBefore ? `${n(o.retention.cameBack)} / ${n(o.retention.joinedBefore)}` : '—', sub: 'used it again after joining' },
      { label: 'Servers', value: n(o.totals.servers), sub: `${n(o.totals.files)} files · ${bytes(o.totals.fileBytes)}` },
    ] },
    { type: 'table', columns: [{ label: `Online now (${online.length})` }, { label: 'Online today', align: 'right' }],
      rows: online.length ? online.map((u) => [userCell(u), minutes(onlineToday.get(u.id) || 0)]) : [[{ text: 'Nobody right now', tone: 'muted' }, '']] },
    { type: 'table', columns: [{ label: 'Most messages today' }, { label: 'Messages', align: 'right' }],
      rows: busiest.length ? busiest.map((r) => [userCell(users.get(r.author_id)), n(r.n)]) : [[{ text: 'No messages yet today', tone: 'muted' }, '']] },
    { label: 'Refresh now', style: 'secondary' },
  ]);
}

function freePlan(s, o) {
  const requests = o.days.requests.at(-1).n;
  upsert(s, 'free-plan', 'free-plan', `# Free plan\n-# Daily allowances start over in ${untilReset()} (midnight UTC). Nothing here can ever bill you.`, [
    { type: 'meter', label: 'Requests today', used: requests, of: FREE_REQUESTS, text: `${n(requests)} of ${n(FREE_REQUESTS)}` },
    { type: 'meter', label: 'Storage', used: o.storage.usedBytes, of: o.storage.freePlanBytes, text: `${bytes(o.storage.usedBytes)} of ${bytes(o.storage.freePlanBytes)}` },
    { type: 'table', columns: [{ label: 'If this runs out' }, { label: 'What happens' }], rows: [
      ['Requests (100,000 a day)', 'Opencord stops answering until midnight UTC, then carries on. Nothing is lost.'],
      ['Storage (5 GB)', 'Uploads stop at 4 GB with a message, so chat always has room.'],
      ['Someone hits a limit', 'Only they see "slow down" or "out of space". Everyone else carries on.'],
    ] },
  ]);
}

function limitsView(s, o) {
  const per = (ms) => (ms >= DAY_MS ? 'day' : ms >= 3600000 ? 'hour' : ms >= 60000 ? `${ms / 60000} min` : `${ms / 1000} s`);
  const rows = [
    ...o.limits.rates.map((l) => [l.label, `${n(l.limit)} per ${per(l.windowMs)}`, l.hitsToday, l.hitsWeek]),
    ...o.limits.sizes.map((l) => [l.label, l.unit === 'bytes' ? bytes(l.value) : n(l.value), l.hitsToday, l.hitsWeek]),
  ].sort((a, b) => b[3] - a[3]);
  const hit = rows.filter((r) => r[2]).length;
  upsert(s, 'limits', 'limits', `# Limits\n-# ${hit ? `${hit} stopped someone today` : 'Nothing has been stopped today'}`, [
    { type: 'table', columns: [{ label: 'Limit' }, { label: 'Allowed' }, { label: 'Today', align: 'right' }, { label: 'Last 7 days', align: 'right' }],
      rows: rows.map(([label, allowed, d, w]) => [label, allowed, d ? { text: n(d), tone: 'bad' } : { text: '—', tone: 'muted' }, w ? n(w) : { text: '—', tone: 'muted' }]) },
  ]);
}

function usersView(s, o) {
  const people = stats.people().filter((p) => p.id !== s.botId);
  const month = onlineMinutesByUser(Date.now() - 30 * DAY_MS);
  const rows = people.map((p) => {
    const u = users.get(p.id);
    const tags = [p.appRole === 'owner' && 'Owner', p.appRole === 'admin' && 'Admin', p.suspendedAt && 'Suspended'].filter(Boolean);
    const isOnline = realtime.isOnline(p.id);
    return [
      userCell(u, tags.length ? `@${p.username} · ${tags.join(' · ')}` : `@${p.username}`),
      { text: shortDay(new Date(p.joinedAt).toISOString().slice(0, 10)), sub: ago(p.joinedAt) },
      isOnline ? { text: 'Online now', tone: 'good' } : { text: ago(lastOnline(p.id)), tone: 'muted' },
      n(p.messages),
      minutes(month.get(p.id) || 0),
      p.uploadBytes ? bytes(p.uploadBytes) : { text: '—', tone: 'muted' },
      n(p.servers),
    ];
  });
  const columns = [{ label: 'Person' }, { label: 'Joined' }, { label: 'Last online' }, { label: 'Messages', align: 'right' },
    { label: 'Online (30 days)', align: 'right' }, { label: 'Uploads', align: 'right' }, { label: 'Servers', align: 'right' }];
  const keep = new Set();
  const pages = Math.max(1, Math.ceil(rows.length / USERS_PER_MESSAGE));
  for (let i = 0; i < pages; i++) {
    const key = `users:${i}`;
    keep.add(key);
    const title = i === 0 ? `# Users\n-# ${n(people.length)} ${people.length === 1 ? 'person' : 'people'} · newest first · click anyone for everything about them` : `-# ${i * USERS_PER_MESSAGE + 1}–${Math.min(rows.length, (i + 1) * USERS_PER_MESSAGE)}`;
    upsert(s, 'users', key, title, [{ type: 'table', columns, rows: rows.slice(i * USERS_PER_MESSAGE, (i + 1) * USERS_PER_MESSAGE) }]);
  }
  prune(s, 'users:', keep);
  prune(s, 'person:', new Set()); // cards from the older layout
}

function signupsView(s, o) {
  const label = { open: 'Open: anyone can make an account', invite: 'Invite only: a server invite is needed', closed: 'Closed: nobody new can join' }[o.registration];
  const latest = db.prepare('SELECT * FROM users WHERE is_bot = 0 ORDER BY created_at DESC LIMIT 15').all();
  upsert(s, 'sign-ups', 'sign-ups', `# Sign-ups\n**${label}.**\n-# Open still allows only 3 accounts a day per network and 30 an hour overall.`, [
    { label: 'Open', style: o.registration === 'open' ? 'primary' : 'secondary' },
    { label: 'Invite only', style: o.registration === 'invite' ? 'primary' : 'secondary' },
    { label: 'Closed', style: o.registration === 'closed' ? 'primary' : 'secondary' },
    { type: 'chart', title: 'New accounts per day', unit: 'new accounts', points: o.days.signups.map((d) => ({ label: shortDay(d.day), n: d.n })) },
    { type: 'table', columns: [{ label: 'Latest accounts' }, { label: 'Joined', align: 'right' }],
      rows: latest.map((u) => [userCell(u), ago(u.created_at)]) },
  ]);
}

function activityView(s, o) {
  const chart = (title, unit, points) => ({ type: 'chart', title, unit, points: points.map((d) => ({ label: shortDay(d.day), n: d.n })) });
  const total = (points) => n(points.reduce((a, d) => a + d.n, 0));
  upsert(s, 'activity', 'activity', '# Last 30 days\n-# Hover a bar for that day', [
    { type: 'tiles', items: [
      { label: 'Messages', value: total(o.days.messages), sub: 'in 30 days' },
      { label: 'New accounts', value: total(o.days.signups), sub: 'in 30 days' },
      { label: 'Requests', value: total(o.days.requests), sub: 'in 30 days' },
      { label: 'Most active in a day', value: n(Math.max(...o.days.active.map((d) => d.n))), sub: 'people' },
    ] },
    chart('Active people per day', 'active', o.days.active),
    chart('Messages per day', 'messages', o.days.messages),
    chart('Requests per day', 'requests', o.days.requests),
  ]);
}

function serversView(s) {
  const list = stats.serverList().filter((x) => !isHq(x.id));
  upsert(s, 'servers', 'servers', `# Servers\n-# ${n(list.length)} in all, busiest this week first`, [
    { type: 'table', columns: [{ label: 'Server' }, { label: 'Members', align: 'right' }, { label: 'Messages this week', align: 'right' }, { label: 'Made', align: 'right' }],
      rows: list.length ? list.map((x) => [{ text: escape(x.name) }, n(x.members), n(x.messagesWeek), ago(x.createdAt)]) : [[{ text: 'No servers yet', tone: 'muted' }, '', '', '']] },
  ]);
}

// --- refreshing ---

function refresh() {
  const s = ensure();
  if (!s) return;
  const o = stats.overview({ onlineNow: realtime.onlineCount() });
  today(s, o);
  freePlan(s, o);
  limitsView(s, o);
  usersView(s, o);
  signupsView(s, o);
  activityView(s, o);
  serversView(s);
  saveState(s);
}

// --- buttons ---

// A button under a Dev message. Only the owner can press them (they're the only one who can see them anyway).
function click(message, user, label) {
  const s = state();
  if (!s || message.author_id !== s.botId) return false;
  if (user.app_role !== 'owner') fail(403, 'Only the owner can do that.');
  const key = Object.keys(s.messages).find((k) => s.messages[k] === message.id);
  if (key === 'sign-ups') {
    const mode = { Open: 'open', 'Invite only': 'invite', Closed: 'closed' }[label];
    if (mode) appSettings.set('registration', mode);
  }
  refresh();
  return true;
}

function start() {
  platform.get('every')(10 * 60 * 1000, refresh, { needed: () => Boolean(owner()) });
}

module.exports = { refresh, ensure, isHq, click, start };
