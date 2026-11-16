// Opencord HQ: the dashboard, as a server. Only the owner is in it (no invites, no joining). An "Opencord" bot
// account posts the numbers as messages and keeps editing them in place, so each channel reads like a live
// report. Buttons under the messages do the owner's jobs: suspending people, admins, who may sign up.
//
//   OVERVIEW  #today     who's here, what happened today, a refresh button
//             #limits    every limit, and which ones stopped someone
//             #free-plan Cloudflare's free allowances, how much is used, what happens if they run out
//   PEOPLE    #accounts  everyone, with Suspend / Make admin buttons
//             #sign-ups  open / invite only / closed, and sign-ups per day
//   ACTIVITY  #charts    the last 30 days as little bar charts
//             #servers   the busiest servers this week
const db = require('../db');
const platform = require('../platform');
const users = require('../models/users');
const servers = require('../models/servers');
const channels = require('../models/channels');
const messages = require('../models/messages');
const sessions = require('../models/sessions');
const appSettings = require('../models/appSettings');
const realtime = require('../realtime');
const stats = require('./stats');
const { postMessage } = require('./post');
const { fail } = require('./http');

const LAYOUT = [
  ['OVERVIEW', ['today', 'limits', 'free-plan']],
  ['PEOPLE', ['accounts', 'sign-ups']],
  ['ACTIVITY', ['charts', 'servers']],
];
const TOPICS = {
  today: 'Right now and today', limits: 'Every limit and how often it fired', 'free-plan': "Cloudflare's free allowances",
  accounts: 'Everyone with an account', 'sign-ups': 'Who may make an account', charts: 'The last 30 days', servers: 'Busiest servers this week',
};
const FREE_REQUESTS = 100000;
const MAX_PEOPLE_SHOWN = 40;

// --- formatting ---

const n = (x) => Number(x || 0).toLocaleString('en-US');
const IRREGULAR = { person: 'people' };
const plural = (x, word) => `${n(x)} ${x === 1 ? word : IRREGULAR[word] || `${word}s`}`;
function bytes(x) {
  if (x >= 1024 ** 3) return `${(x / 1024 ** 3).toFixed(2)} GB`;
  if (x >= 1024 ** 2) return `${(x / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.round(x / 1024)} KB`;
}
// ██████░░░░░░░░ 42%
function meter(used, of, width = 20) {
  const ratio = Math.min(1, of ? used / of : 0);
  const full = Math.round(ratio * width);
  return `${'█'.repeat(full)}${'░'.repeat(width - full)} ${Math.round(ratio * 100)}%`;
}
// ▁▂▅▇█ over 30 days
function spark(points) {
  const max = Math.max(1, ...points.map((p) => p.n));
  return points.map((p) => (p.n ? '▁▂▃▄▅▆▇█'[Math.min(7, Math.floor((p.n / max) * 7.999))] : ' ')).join('');
}
const day = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const when = (ms) => (ms ? `<t:${Math.floor(ms / 1000)}:R>` : 'never');
function untilReset() {
  const now = new Date();
  const mins = Math.round((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) - now) / 60000);
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

// --- the server itself ---

const state = () => appSettings.get('hq', null);
const saveState = (s) => appSettings.set('hq', s);

function owner() {
  return db.prepare("SELECT * FROM users WHERE app_role = 'owner' AND is_bot = 0 LIMIT 1").get() || null;
}

function isHq(serverId) {
  return Boolean(serverId) && state()?.serverId === serverId;
}

// Makes (or repairs) HQ: the bot, the server with the owner as its only member, the categories and channels.
function ensure() {
  const boss = owner();
  if (!boss) return null;
  const s = state() || { messages: {} };
  if (!s.botId || !users.get(s.botId)) {
    const bot = users.create({ username: `opencord_hq_${Math.random().toString(36).slice(2, 7)}`, displayName: 'Opencord', passwordHash: '!hq' });
    db.prepare('UPDATE users SET is_bot = 1 WHERE id = ?').run(bot.id);
    s.botId = bot.id;
  }
  let server = s.serverId && servers.get(s.serverId);
  if (!server) {
    server = servers.create(boss.id, 'Opencord HQ');
    for (const c of channels.forServer(server.id)) channels.remove(c.id); // no #general
    s.serverId = server.id;
    s.channels = {};
    s.messages = {};
    realtime.joinServer(boss.id, server.id);
  }
  // The owner (and only the owner) is in it, and owns it; the bot is in it to post.
  if (server.owner_id !== boss.id) servers.update(server.id, { ownerId: boss.id });
  for (const id of servers.memberIds(server.id)) if (id !== boss.id && id !== s.botId) servers.removeMember(server.id, id);
  if (!servers.isMember(server.id, boss.id)) { servers.addMember(server.id, boss.id); realtime.joinServer(boss.id, server.id); }
  if (!servers.isMember(server.id, s.botId)) servers.addMember(server.id, s.botId);

  s.channels ||= {};
  for (const [category, names] of LAYOUT) {
    const catKey = `#${category}`;
    if (!s.channels[catKey] || !channels.get(s.channels[catKey])) s.channels[catKey] = channels.create(server.id, category, { kind: 'category' }).id;
    for (const name of names) {
      if (s.channels[name] && channels.get(s.channels[name])) continue;
      const channel = channels.create(server.id, name, { parentId: s.channels[catKey] });
      channels.update(channel.id, { topic: TOPICS[name], readOnly: 1 });
      s.channels[name] = channel.id;
    }
  }
  saveState(s);
  realtime.toUser(boss.id, 'server:update', servers.toServer(servers.get(server.id)));
  return s;
}

// One message per key: posted once, then edited in place (without the "edited" mark) when it changes.
function upsert(s, channelName, key, content, components = null) {
  const channel = channels.get(s.channels[channelName]);
  if (!channel) return;
  const existing = s.messages[key] && messages.get(s.messages[key]);
  if (existing) {
    const sameParts = (existing.components || null) === (components ? JSON.stringify(components) : null);
    if (existing.content === content && sameParts) return;
    db.prepare('UPDATE messages SET content = ?, components = ? WHERE id = ?').run(content, components ? JSON.stringify(components) : null, existing.id);
    realtime.toChannel(channel, 'message:update', messages.serialize(messages.get(existing.id)));
    return;
  }
  s.messages[key] = postMessage(channel, s.botId, content, { components }).id;
}

// Messages for people who are no longer listed are taken away.
function prune(s, keep) {
  for (const key of Object.keys(s.messages)) {
    if (!key.startsWith('person:') || keep.has(key)) continue;
    const row = messages.get(s.messages[key]);
    if (row) {
      messages.remove(row);
      realtime.toChannel(channels.get(row.channel_id), 'message:delete', { id: row.id, channelId: row.channel_id });
    }
    delete s.messages[key];
  }
}

// --- what each channel says ---

function today(o) {
  const t = o.totals;
  return [
    '# Today',
    `-# Updated ${when(Date.now())} · refreshes every 10 minutes, or press the button`,
    `**${n(o.active.now)}** online now · **${n(o.active.today)}** active today · **${n(o.active.week)}** this week · **${n(o.active.month)}** this month`,
    `**${n(o.days.messages.at(-1).n)}** messages today · **${n(o.days.signups.at(-1).n)}** new accounts today`,
    '',
    `${plural(t.people, 'person')}, ${plural(t.bots, 'bot')}, ${plural(t.servers, 'server')}, ${plural(t.messages, 'message')}, ${plural(t.files, 'file')} (${bytes(t.fileBytes)})`,
    o.retention.joinedBefore ? `${n(o.retention.cameBack)} of ${n(o.retention.joinedBefore)} people came back after the day they joined.` : '',
    o.suspended ? `${plural(o.suspended, 'account')} suspended.` : '',
  ].filter((line) => line !== '').join('\n');
}

function limitsText(o) {
  const rows = [
    ...o.limits.rates.map((l) => [l.label, `${n(l.limit)} per ${l.windowMs >= 86400000 ? 'day' : l.windowMs >= 3600000 ? 'hour' : l.windowMs >= 60000 ? `${l.windowMs / 60000} min` : `${l.windowMs / 1000} s`}`, l.hitsToday, l.hitsWeek]),
    ...o.limits.sizes.map((l) => [l.label, l.unit === 'bytes' ? bytes(l.value) : n(l.value), l.hitsToday, l.hitsWeek]),
  ];
  const hit = rows.filter((r) => r[2]);
  const width = Math.max(...rows.map((r) => r[0].length));
  const table = rows.map(([label, allowed, d, w]) => `${d ? '!' : ' '} ${label.padEnd(width)}  ${allowed.padEnd(14)} ${String(d || '-').padStart(5)} ${String(w || '-').padStart(6)}`);
  return [
    '# Limits',
    hit.length ? `**${hit.length}** stopped someone today: ${hit.map((r) => r[0].toLowerCase()).join(', ')}.` : 'Nothing has been stopped today.',
    '```',
    `  ${'Limit'.padEnd(width)}  ${'Allowed'.padEnd(14)} ${'today'.padStart(5)} ${'7 days'.padStart(6)}`,
    ...table,
    '```',
    '-# Someone who hits a limit gets a clear "slow down" or "out of space" message; nobody else notices.',
  ].join('\n');
}

function freePlan(o) {
  const requests = o.days.requests.at(-1).n;
  return [
    '# Free plan',
    `-# Daily allowances start over in ${untilReset()} (midnight UTC). Nothing here can ever bill you.`,
    '**Requests today**',
    `\`${meter(requests, FREE_REQUESTS)}\` ${n(requests)} of ${n(FREE_REQUESTS)}`,
    '**Storage**',
    `\`${meter(o.storage.usedBytes, o.storage.freePlanBytes)}\` ${bytes(o.storage.usedBytes)} of ${bytes(o.storage.freePlanBytes)}`,
    '',
    '- **Requests run out:** Opencord stops answering until midnight UTC, then carries on. Nothing is lost.',
    '- **Storage fills up:** uploads stop at 4 GB with a message, so chat always has room.',
    '- **Requests count:** the app\'s own API and file downloads. Pages, scripts and styles are free and unlimited.',
  ].join('\n');
}

function signupsText(o) {
  const label = { open: 'Open: anyone can make an account', invite: 'Invite only: a server invite is needed', closed: 'Closed: nobody new can join' }[o.registration];
  return [
    '# Sign-ups',
    `**${label}.**`,
    '-# Open still allows only 3 accounts a day per network and 30 an hour overall.',
    '',
    `Last 30 days: \`${spark(o.days.signups)}\` ${n(o.days.signups.reduce((a, p) => a + p.n, 0))} new`,
  ].join('\n');
}

function charts(o) {
  const line = (label, points) => `**${label}** · ${n(points.reduce((a, p) => a + p.n, 0))} in 30 days, most on one day ${n(Math.max(...points.map((p) => p.n)))}\n\`${spark(points)}\``;
  return [
    '# Last 30 days',
    `-# ${day(o.days.messages[0].day)} → today, one bar per day`,
    line('Active people', o.days.active),
    line('Messages', o.days.messages),
    line('Sign-ups', o.days.signups),
    line('Requests', o.days.requests),
  ].join('\n');
}

function serversText(list) {
  const shown = list.filter((s) => !isHq(s.id)).slice(0, 15);
  if (!shown.length) return '# Busiest servers\nNo servers yet.';
  return ['# Busiest servers', '-# By messages in the last 7 days',
    ...shown.map((s, i) => `${i + 1}. **${s.name.replace(/[*_~|`\\]/g, '\\$&')}** · ${plural(s.members, 'member')} · ${plural(s.messagesWeek, 'message')} this week`)].join('\n');
}

function personText(p) {
  const badges = [p.appRole === 'owner' && '**Owner**', p.appRole === 'admin' && '**Admin**', p.suspendedAt && '**Suspended**'].filter(Boolean).join(' · ');
  const last = p.lastActiveDay ? (p.lastActiveDay === new Date().toISOString().slice(0, 10) ? 'today' : day(p.lastActiveDay)) : 'not since tracking began';
  return [
    `### ${p.displayName.replace(/[*_~|`\\]/g, '\\$&')} \`@${p.username}\`${badges ? ` · ${badges}` : ''}`,
    `Joined ${when(p.joinedAt)} · last active ${last} · ${plural(p.messages, 'message')} · ${p.uploadBytes ? bytes(p.uploadBytes) : 'no'} uploads · in ${plural(p.servers, 'server')}`,
  ].join('\n');
}

function personButtons(p) {
  if (p.appRole === 'owner') return null;
  const out = [{ label: p.suspendedAt ? 'Unsuspend' : 'Suspend', style: p.suspendedAt ? 'secondary' : 'danger' }];
  if (!p.suspendedAt) out.push({ label: p.appRole === 'admin' ? 'Remove admin' : 'Make admin', style: 'secondary' });
  return out;
}

// --- refreshing ---

function refresh() {
  const s = ensure();
  if (!s) return;
  const o = stats.overview({ onlineNow: realtime.onlineCount() });
  const people = stats.people().filter((p) => p.id !== s.botId);
  upsert(s, 'today', 'today', today(o), [{ label: 'Refresh now', style: 'secondary' }]);
  upsert(s, 'limits', 'limits', limitsText(o));
  upsert(s, 'free-plan', 'free-plan', freePlan(o));
  upsert(s, 'sign-ups', 'sign-ups', signupsText(o), [
    { label: 'Open', style: o.registration === 'open' ? 'primary' : 'secondary' },
    { label: 'Invite only', style: o.registration === 'invite' ? 'primary' : 'secondary' },
    { label: 'Closed', style: o.registration === 'closed' ? 'primary' : 'secondary' },
  ]);
  upsert(s, 'charts', 'charts', charts(o));
  upsert(s, 'servers', 'servers', serversText(stats.serverList()));
  const listed = people.slice(0, MAX_PEOPLE_SHOWN);
  const keep = new Set();
  // Oldest first, so the newest account is at the bottom of the channel, like a chat.
  for (const p of [...listed].reverse()) {
    keep.add(`person:${p.id}`);
    upsert(s, 'accounts', `person:${p.id}`, personText(p), personButtons(p));
  }
  prune(s, keep);
  upsert(s, 'accounts', 'accounts-note', people.length > MAX_PEOPLE_SHOWN
    ? `-# Showing the ${MAX_PEOPLE_SHOWN} newest of ${plural(people.length, 'account')}.` : `-# ${plural(people.length, 'account')} in all.`);
  saveState(s);
}

// --- buttons ---

// A button under an HQ message. Only the owner can press them (they're the only one who can see them anyway).
function click(message, user, label) {
  const s = state();
  if (!s || message.author_id !== s.botId) return false;
  if (user.app_role !== 'owner') fail(403, 'Only the owner can do that.');
  const key = Object.keys(s.messages).find((k) => s.messages[k] === message.id);
  if (key === 'sign-ups') {
    const mode = { Open: 'open', 'Invite only': 'invite', Closed: 'closed' }[label];
    if (mode) appSettings.set('registration', mode);
  } else if (key?.startsWith('person:')) {
    const target = users.get(key.slice('person:'.length));
    if (!target || target.app_role === 'owner') fail(400, "That can't be done to this account.");
    if (label === 'Suspend') {
      users.update(target.id, { suspendedAt: Date.now(), suspendedReason: null });
      realtime.disconnectSessions(sessions.removeAll(target.id));
    } else if (label === 'Unsuspend') {
      users.update(target.id, { suspendedAt: null, suspendedReason: null });
    } else if (label === 'Make admin' || label === 'Remove admin') {
      users.update(target.id, { appRole: label === 'Make admin' ? 'admin' : null });
    }
  }
  refresh();
  return true;
}

function start() {
  platform.get('every')(10 * 60 * 1000, refresh, { needed: () => Boolean(owner()) });
}

module.exports = { refresh, ensure, isHq, click, start };
