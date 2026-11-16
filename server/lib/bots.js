// Runs bots built in the block editor. A bot's program is a list of scripts; each script is a trigger
// (when this happens…) and a stack of blocks (…do these). Programs are plain data, never code: this file
// is the only thing that decides what a block does, with hard limits so a bot can't flood or hang.
const db = require('../db');
const { newId } = require('./ids');
const users = require('../models/users');
const servers = require('../models/servers');
const channels = require('../models/channels');
const messages = require('../models/messages');
const realtime = require('../realtime');
const post = require('./post');
const audit = require('../models/audit');
const previews = require('./previews');

const MAX_STEPS = 500; // blocks per run
const MAX_RUN_MS = 10 * 60_000; // a run (even a forever loop) stops after 10 minutes
const MAX_RUNNING = 5; // scripts running at once per bot
const MAX_SENDS = 5; // messages per run
const MAX_WAIT = 10; // seconds for one wait block
const PER_MINUTE = 30; // messages per bot per minute
const MAX_VARS = 200;
const MAX_TEXT = 2000;
const MAX_HTTP = 3; // web requests per run
const MAX_LIST = 200; // items in a list variable

// --- storage ---

function toBot(row) {
  const user = users.get(row.user_id);
  return {
    id: row.id, serverId: row.server_id, enabled: Boolean(row.enabled), program: JSON.parse(row.program),
    admin: servers.roleOf(row.server_id, row.user_id) === 'admin',
    user: users.toUser(user), createdAt: row.created_at,
  };
}

function forServer(serverId) {
  return db.prepare('SELECT * FROM bots WHERE server_id = ? ORDER BY created_at').all(serverId).map(toBot);
}

function get(id) {
  return db.prepare('SELECT * FROM bots WHERE id = ?').get(id);
}

const create = db.transaction((serverId, creatorId, name) => {
  let username;
  do username = `bot_${Math.random().toString(36).slice(2, 8)}`; while (users.getByUsername(username));
  const user = users.create({ username, displayName: name, passwordHash: '!bot' });
  db.prepare('UPDATE users SET is_bot = 1 WHERE id = ?').run(user.id);
  servers.addMember(serverId, user.id);
  const id = newId();
  db.prepare('INSERT INTO bots (id, server_id, user_id, creator_id, program, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, serverId, user.id, creatorId, '[]', Date.now());
  return get(id);
});

function setAdmin(bot, admin) {
  servers.setRole(bot.server_id, bot.user_id, admin ? 'admin' : 'member');
}

function update(id, { enabled, program }) {
  if (enabled !== undefined) db.prepare('UPDATE bots SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id);
  if (program !== undefined) db.prepare('UPDATE bots SET program = ? WHERE id = ?').run(JSON.stringify(program), id);
  return get(id);
}

const remove = db.transaction((bot) => {
  realtime.botLeaveVoice(bot.user_id);
  db.prepare('DELETE FROM users WHERE id = ?').run(bot.user_id); // cascades to membership, bot row and vars
});

function getVar(botId, key) {
  return db.prepare('SELECT value FROM bot_vars WHERE bot_id = ? AND key = ?').get(botId, key)?.value ?? '';
}

function setVar(botId, key, value) {
  const count = db.prepare('SELECT COUNT(*) AS n FROM bot_vars WHERE bot_id = ?').get(botId).n;
  const exists = db.prepare('SELECT 1 FROM bot_vars WHERE bot_id = ? AND key = ?').get(botId, key);
  if (!exists && count >= MAX_VARS) return;
  db.prepare('INSERT OR REPLACE INTO bot_vars (bot_id, key, value) VALUES (?, ?, ?)').run(botId, key, String(value).slice(0, MAX_TEXT));
}

// Lists are kept in a variable as JSON.
function getList(botId, name) {
  try {
    const value = JSON.parse(getVar(botId, `list:${name}`) || '[]');
    return Array.isArray(value) ? value.map(String) : [];
  } catch {
    return [];
  }
}

function setList(botId, name, items) {
  setVar(botId, `list:${name}`, JSON.stringify(items.slice(-MAX_LIST)));
}

// Reads "a.b.0.c" out of parsed JSON.
function pick(data, path) {
  let value = data;
  for (const key of path.split('.').filter(Boolean)) {
    if (value == null || typeof value !== 'object') return '';
    value = value[key];
  }
  if (value == null) return '';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

// --- checking a program before saving it ---

const TRIGGERS = ['message', 'command', 'join', 'timer', 'button', 'reaction', 'leave', 'menu'];
const ACTIONS = ['send', 'reply', 'react', 'wait', 'set', 'change', 'if', 'repeat', 'random', 'stop',
  'forever', 'until', 'dm', 'ping', 'pin', 'join_voice', 'leave_voice',
  'buttons', 'menu_send', 'http', 'math', 'random_number', 'list_add', 'list_remove', 'list_pick', 'list_clear', 'text_case', 'unpin'];
// These only run when the bot is an admin.
const ADMIN_ACTIONS = ['delete', 'purge', 'create_channel', 'delete_channel', 'rename_channel', 'topic', 'slowmode', 'lock',
  'kick', 'ban', 'timeout', 'untimeout', 'everyone', 'invite',
  'give_role', 'take_role', 'toggle_role', 'create_role', 'delete_role', 'rename_role', 'color_role'];
const ALL_ACTIONS = [...ACTIONS, ...ADMIN_ACTIONS];
const OPS = ['equals', 'not', 'contains', 'starts', 'greater', 'less', 'has_role', 'not_role'];
const MATH = ['+', '-', '*', '/', '%', 'min', 'max', 'round'];

function clean(value, max = MAX_TEXT) {
  return String(value ?? '').slice(0, max);
}

function validateBlocks(blocks, depth = 0) {
  if (!Array.isArray(blocks) || depth > 6) throw new Error('Blocks are nested too deep.');
  return blocks.slice(0, 100).map((b) => {
    if (!b || !ALL_ACTIONS.includes(b.type)) throw new Error('Unknown block.');
    const out = { type: b.type };
    for (const key of ['text', 'emoji', 'name', 'value', 'left', 'right', 'channel', 'reason', 'role', 'url', 'field']) if (b[key] !== undefined) out[key] = clean(b[key]);
    if (b.math !== undefined) out.math = MATH.includes(b.math) ? b.math : '+';
    if (b.textCase !== undefined) out.textCase = ['upper', 'lower', 'length', 'reverse', 'trim'].includes(b.textCase) ? b.textCase : 'upper';
    if (b.min !== undefined) out.min = Math.round(Number(b.min)) || 0;
    if (b.max !== undefined) out.max = Math.round(Number(b.max)) || 0;
    if (b.color !== undefined) out.color = /^#[0-9a-f]{6}$/i.test(b.color) ? b.color : null;
    if (b.target !== undefined) out.target = b.target === 'mentioned' ? 'mentioned' : 'person';
    if (b.kind !== undefined) out.kind = b.kind === 'voice' ? 'voice' : 'text';
    if (b.lock !== undefined) out.lock = b.lock === 'unlock' ? 'unlock' : 'lock';
    if (b.slow !== undefined) out.slow = Math.min(Math.max(Math.round(Number(b.slow)) || 0, 0), 21600);
    if (b.count !== undefined) out.count = Math.min(Math.max(Math.round(Number(b.count)) || 1, 1), 100);
    if (b.minutes !== undefined) out.minutes = Math.min(Math.max(Math.round(Number(b.minutes)) || 1, 1), 10080);
    if (b.op !== undefined) out.op = OPS.includes(b.op) ? b.op : 'equals';
    if (b.seconds !== undefined) out.seconds = Math.min(Math.max(Number(b.seconds) || 0, 0), MAX_WAIT);
    if (b.times !== undefined) out.times = Math.min(Math.max(Math.round(Number(b.times)) || 1, 1), 10);
    if (b.options !== undefined) out.options = (Array.isArray(b.options) ? b.options : []).slice(0, 20).map((o) => clean(o));
    if (b.do !== undefined) out.do = validateBlocks(b.do, depth + 1);
    if (b.else !== undefined) out.else = validateBlocks(b.else, depth + 1);
    return out;
  });
}

function validateProgram(program) {
  if (!Array.isArray(program)) throw new Error('A program is a list of scripts.');
  return program.slice(0, 30).map((script) => {
    // A stack with no trigger is allowed (it's parked on the canvas) but never runs.
    if (script?.trigger == null) return { trigger: null, blocks: validateBlocks(script?.blocks || []), x: Number(script?.x) || 0, y: Number(script?.y) || 0 };
    const t = script.trigger;
    if (!TRIGGERS.includes(t.type)) throw new Error('Unknown trigger.');
    const trigger = { type: t.type };
    if (t.type === 'message') {
      trigger.match = ['any', 'contains', 'starts', 'equals'].includes(t.match) ? t.match : 'contains';
      trigger.text = clean(t.text, 200);
    }
    if (t.type === 'command') {
      trigger.name = clean(t.name, 32).replace(/^[!/]/, '').toLowerCase().replace(/\s+/g, '');
      trigger.description = clean(t.description, 100);
    }
    if (t.type === 'button' || t.type === 'menu') trigger.text = clean(t.text, 80);
    if (t.type === 'reaction') trigger.emoji = clean(t.emoji, 80);
    if (t.type === 'timer') {
      trigger.minutes = Math.min(Math.max(Math.round(Number(t.minutes)) || 60, 1), 10080);
      trigger.channel = clean(t.channel, 40);
    }
    return { trigger, blocks: validateBlocks(script.blocks || []), x: Number(script.x) || 0, y: Number(script.y) || 0 };
  });
}

// --- running ---

const sentAt = new Map(); // botId → timestamps of recent sends

function canSend(botId) {
  const now = Date.now();
  const recent = (sentAt.get(botId) || []).filter((t) => now - t < 60_000);
  sentAt.set(botId, recent);
  if (recent.length >= PER_MINUTE) return false;
  recent.push(now);
  return true;
}

// {user} {mention} {args} {arg1}… {channel} {server} {var.name} {random 1 10}
function fill(text, ctx) {
  return clean(String(text ?? '').replace(/\{(\w+)(?:[.\s]([^}]*))?\}/g, (whole, key, rest) => {
    switch (key) {
      case 'user': return ctx.user?.displayName ?? '';
      case 'mention': return ctx.user ? `@${ctx.user.username}` : '';
      case 'username': return ctx.user?.username ?? '';
      case 'args': return ctx.args.join(' ');
      case 'channel': return ctx.channel?.name ?? '';
      case 'server': return servers.get(ctx.bot.server_id)?.name ?? '';
      case 'message': return ctx.message?.content ?? '';
      case 'roles': return ctx.user ? rolesOf(ctx, ctx.user.id).map((r) => r.name).join(', ') : '';
      case 'button': return ctx.button ?? '';
      case 'choice': return ctx.choice ?? '';
      case 'emoji': return ctx.emoji ?? '';
      case 'list': {
        // {list.name} → the items joined with commas; {list.name.length} → how many.
        const [name, prop] = (rest || '').split('.');
        const items = getList(ctx.bot.id, name);
        return prop === 'length' ? String(items.length) : items.join(', ');
      }
      case 'time': return new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      case 'date': return new Date().toLocaleDateString('en-GB');
      case 'var': return getVar(ctx.bot.id, rest || '');
      case 'random': {
        const [lo, hi] = (rest || '1 10').split(/\s+/).map(Number);
        return String(Math.floor(Math.random() * ((hi || 10) - (lo || 1) + 1)) + (lo || 1));
      }
      default: {
        const arg = /^arg(\d)$/.exec(key);
        return arg ? (ctx.args[Number(arg[1]) - 1] ?? '') : whole;
      }
    }
  }));
}

function test(block, ctx) {
  const left = fill(block.left, ctx);
  const right = fill(block.right, ctx);
  switch (block.op) {
    case 'not': return left.toLowerCase() !== right.toLowerCase();
    case 'contains': return left.toLowerCase().includes(right.toLowerCase());
    case 'starts': return left.toLowerCase().startsWith(right.toLowerCase());
    case 'greater': return Number(left) > Number(right);
    case 'less': return Number(left) < Number(right);
    // "the person has the role <right>" (left is ignored).
    case 'has_role': return Boolean(ctx.user) && rolesOf(ctx, ctx.user.id).some((r) => r.name.toLowerCase() === right.trim().toLowerCase());
    case 'not_role': return !ctx.user || !rolesOf(ctx, ctx.user.id).some((r) => r.name.toLowerCase() === right.trim().toLowerCase());
    default: return left.toLowerCase() === right.toLowerCase();
  }
}

function serverChannel(id, ctx, kind = 'text') {
  const channel = id && channels.get(id);
  return channel && channel.server_id === ctx.bot.server_id && channel.kind === kind ? channel : null;
}

function targetChannel(block, ctx) {
  return serverChannel(block.channel, ctx) || ctx.channel;
}

// "the person" is whoever set the script off; "the first person mentioned" is the first @name in their message.
function targetUser(block, ctx) {
  if (block.target !== 'mentioned') return ctx.user ? users.get(ctx.user.id) : null;
  const name = /(?<![\w@])@([a-z0-9_.]{2,32})/i.exec(ctx.message?.content || '')?.[1];
  const user = name && users.getByUsername(name.toLowerCase());
  return user && servers.isMember(ctx.bot.server_id, user.id) ? user : null;
}

function isAdmin(ctx) {
  return servers.roleOf(ctx.bot.server_id, ctx.bot.user_id) === 'admin';
}

// Bots act like admins: never on the owner, other admins or themselves.
function canTouch(ctx, user) {
  if (!user || user.id === ctx.bot.user_id) return false;
  return servers.roleOf(ctx.bot.server_id, user.id) === 'member';
}

function say(ctx, channel, content, replyToId = null) {
  if (!channel || !content || ctx.sends >= MAX_SENDS || !canSend(ctx.bot.id)) return null;
  ctx.sends += 1;
  return post.postMessage(channel, ctx.bot.user_id, content, { replyToId });
}

function log(ctx, action, target, details = '') {
  audit.log(ctx.bot.server_id, ctx.bot.user_id, action, target, details);
}

function channelChanged(row) {
  realtime.toServer(row.server_id, 'channel:update', channels.toChannel(row));
}

function kickUser(ctx, user) {
  servers.removeMember(ctx.bot.server_id, user.id);
  realtime.leaveServer(user.id, ctx.bot.server_id);
  realtime.toUser(user.id, 'server:delete', { id: ctx.bot.server_id });
  realtime.toServer(ctx.bot.server_id, 'member:remove', { serverId: ctx.bot.server_id, userId: user.id });
}

function memberChanged(ctx, userId) {
  realtime.toServer(ctx.bot.server_id, 'member:update', { serverId: ctx.bot.server_id, member: servers.member(ctx.bot.server_id, userId) });
}

const channelName = (text) => text.toLowerCase().replace(/\s+/g, '-').slice(0, 100);

// Roles by name (any case). Bots never touch roles with admin powers.
function findRole(ctx, name) {
  const wanted = name.trim().toLowerCase();
  return wanted ? servers.roles(ctx.bot.server_id).find((r) => r.name.toLowerCase() === wanted && !r.admin) || null : null;
}

function rolesOf(ctx, userId) {
  const ids = servers.memberRoleIds(ctx.bot.server_id, userId);
  return servers.roles(ctx.bot.server_id).filter((r) => ids.includes(r.id));
}

function rolesChanged(ctx) {
  realtime.toServer(ctx.bot.server_id, 'server:update', servers.toServer(servers.get(ctx.bot.server_id)));
}

class Stop extends Error {}

function tick(ctx) {
  ctx.steps += 1;
  if (ctx.steps > MAX_STEPS || Date.now() - ctx.started > MAX_RUN_MS) throw new Stop();
}

// Loops check the bot is still switched on, so turning it off stops a forever loop.
function stillOn(ctx) {
  const row = get(ctx.bot.id);
  if (!row?.enabled) throw new Stop();
}

async function runBlocks(blocks, ctx) {
  for (const block of blocks) {
    tick(ctx);
    if (ADMIN_ACTIONS.includes(block.type) && !isAdmin(ctx)) continue;
    switch (block.type) {
      case 'send':
      case 'random': {
        const source = block.type === 'random' ? block.options?.[Math.floor(Math.random() * (block.options?.length || 1))] : block.text;
        say(ctx, targetChannel(block, ctx), fill(source, ctx).trim());
        break;
      }
      case 'reply':
        say(ctx, ctx.channel, fill(block.text, ctx).trim(), ctx.message?.id);
        break;
      case 'ping': {
        const user = targetUser(block, ctx);
        if (user) say(ctx, ctx.channel, `@${user.username} ${fill(block.text, ctx)}`.trim());
        break;
      }
      case 'everyone':
        say(ctx, targetChannel(block, ctx), `@everyone ${fill(block.text, ctx)}`.trim());
        break;
      case 'dm': {
        const user = targetUser(block, ctx);
        const content = fill(block.text, ctx).trim();
        if (!user || !content || ctx.sends >= MAX_SENDS || !canSend(ctx.bot.id)) break;
        ctx.sends += 1;
        post.postMessage(channels.getOrCreateDm(ctx.bot.user_id, user.id), ctx.bot.user_id, content);
        break;
      }
      case 'react':
        if (ctx.message && block.emoji) {
          messages.react(ctx.message.id, ctx.bot.user_id, fill(block.emoji, ctx).slice(0, 80));
          realtime.toChannel(ctx.channel, 'message:update', messages.serialize(messages.get(ctx.message.id)));
        }
        break;
      case 'pin':
        if (ctx.message && messages.get(ctx.message.id)) {
          realtime.toChannel(ctx.channel, 'message:update', messages.serialize(messages.setPinned(ctx.message.id, true)));
        }
        break;
      case 'join_voice': {
        const channel = serverChannel(block.channel, ctx, 'voice');
        if (channel) realtime.botJoinVoice(channel, ctx.bot.user_id);
        break;
      }
      case 'leave_voice':
        realtime.botLeaveVoice(ctx.bot.user_id);
        break;
      case 'wait':
        await new Promise((resolve) => setTimeout(resolve, (block.seconds || 1) * 1000));
        break;
      case 'set':
        setVar(ctx.bot.id, block.name, fill(block.value, ctx));
        break;
      case 'change':
        setVar(ctx.bot.id, block.name, (Number(getVar(ctx.bot.id, block.name)) || 0) + (Number(fill(block.value, ctx)) || 0));
        break;
      case 'if':
        await runBlocks(test(block, ctx) ? block.do || [] : block.else || [], ctx);
        break;
      case 'repeat':
        for (let i = 0; i < (block.times || 1); i++) await runBlocks(block.do || [], ctx);
        break;
      case 'until':
        while (!test(block, ctx)) {
          tick(ctx);
          stillOn(ctx);
          await runBlocks(block.do || [], ctx);
          await new Promise((resolve) => setImmediate(resolve));
        }
        break;
      case 'forever':
        for (;;) {
          tick(ctx);
          stillOn(ctx);
          await runBlocks(block.do || [], ctx);
          // A forever loop with no wait inside still yields, and the step limit ends it.
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      case 'stop':
        throw new Stop();
      case 'buttons': {
        // A message with up to 5 buttons under it; clicking one runs "when a button is clicked".
        const labels = (block.options || []).map((o) => fill(o, ctx).trim().slice(0, 80)).filter(Boolean).slice(0, 5);
        const channel = targetChannel(block, ctx);
        const content = fill(block.text, ctx).trim();
        if (!channel || !content || !labels.length || ctx.sends >= MAX_SENDS || !canSend(ctx.bot.id)) break;
        ctx.sends += 1;
        post.postMessage(channel, ctx.bot.user_id, content, { components: labels.map((label) => ({ label })) });
        break;
      }
      case 'menu_send': {
        // A message with a drop-down of up to 25 choices; picking one runs "when someone picks from a menu".
        const options = (block.options || []).map((o) => fill(o, ctx).trim().slice(0, 80)).filter(Boolean).slice(0, 25);
        const channel = targetChannel(block, ctx);
        const content = fill(block.text, ctx).trim();
        if (!channel || !content || !options.length || ctx.sends >= MAX_SENDS || !canSend(ctx.bot.id)) break;
        ctx.sends += 1;
        post.postMessage(channel, ctx.bot.user_id, content, { components: [{ type: 'menu', placeholder: fill(block.name, ctx).slice(0, 80) || 'Pick one', options }] });
        break;
      }
      case 'http': {
        // GET a public web address (never this machine or the local network) and keep the reply in a variable.
        if ((ctx.http = (ctx.http || 0) + 1) > MAX_HTTP) break;
        const url = fill(block.url, ctx).trim();
        if (!/^https?:\/\//i.test(url)) break;
        const res = await previews.get(url, { maxBytes: 256 * 1024 });
        let value = res ? res.body.toString('utf8') : '';
        if (value && block.field) {
          try { value = pick(JSON.parse(value), fill(block.field, ctx)); } catch { value = ''; }
        }
        setVar(ctx.bot.id, block.name || 'response', value.slice(0, MAX_TEXT));
        break;
      }
      case 'math': {
        const a = Number(fill(block.left, ctx)) || 0;
        const b = Number(fill(block.right, ctx)) || 0;
        const result = {
          '+': a + b, '-': a - b, '*': a * b, '/': b ? a / b : 0, '%': b ? a % b : 0, min: Math.min(a, b), max: Math.max(a, b), round: Math.round(a),
        }[block.math || '+'];
        setVar(ctx.bot.id, block.name, Number.isFinite(result) ? Math.round(result * 1e6) / 1e6 : 0);
        break;
      }
      case 'random_number': {
        const lo = Math.min(block.min ?? 1, block.max ?? 10);
        const hi = Math.max(block.min ?? 1, block.max ?? 10);
        setVar(ctx.bot.id, block.name, Math.floor(Math.random() * (hi - lo + 1)) + lo);
        break;
      }
      case 'list_add': {
        const items = getList(ctx.bot.id, block.name);
        items.push(fill(block.value, ctx).slice(0, 200));
        setList(ctx.bot.id, block.name, items);
        break;
      }
      case 'list_remove': {
        const value = fill(block.value, ctx).toLowerCase();
        setList(ctx.bot.id, block.name, getList(ctx.bot.id, block.name).filter((item) => item.toLowerCase() !== value));
        break;
      }
      case 'list_clear':
        setList(ctx.bot.id, block.name, []);
        break;
      case 'list_pick': {
        const items = getList(ctx.bot.id, block.name);
        setVar(ctx.bot.id, block.value || 'picked', items.length ? items[Math.floor(Math.random() * items.length)] : '');
        break;
      }
      case 'text_case': {
        const text = fill(block.value, ctx);
        const out = { upper: text.toUpperCase(), lower: text.toLowerCase(), length: String(text.length), reverse: [...text].reverse().join(''), trim: text.trim() }[block.textCase || 'upper'];
        setVar(ctx.bot.id, block.name, out);
        break;
      }
      case 'unpin':
        if (ctx.message && messages.get(ctx.message.id)) {
          realtime.toChannel(ctx.channel, 'message:update', messages.serialize(messages.setPinned(ctx.message.id, false)));
        }
        break;

      // --- admin ---
      case 'delete':
        if (ctx.message) {
          const row = messages.get(ctx.message.id);
          if (row) {
            messages.remove(row);
            realtime.toChannel(ctx.channel, 'message:delete', { id: row.id, channelId: row.channel_id });
            log(ctx, 'message.delete', `#${ctx.channel.name}`, row.content.slice(0, 120));
          }
          ctx.message = null;
        }
        break;
      case 'purge': {
        const channel = targetChannel(block, ctx);
        if (!channel) break;
        const rows = db.prepare('SELECT * FROM messages WHERE channel_id = ? ORDER BY id DESC LIMIT ?').all(channel.id, block.count || 10);
        for (const row of rows) {
          messages.remove(row);
          realtime.toChannel(channel, 'message:delete', { id: row.id, channelId: channel.id });
        }
        log(ctx, 'message.delete', `#${channel.name}`, `cleared ${rows.length} messages`);
        break;
      }
      case 'create_channel': {
        const name = channelName(fill(block.name, ctx).trim());
        if (!name || channels.forServer(ctx.bot.server_id).length >= 200) break;
        const row = channels.create(ctx.bot.server_id, name, { kind: block.kind === 'voice' ? 'voice' : 'text' });
        realtime.toServer(ctx.bot.server_id, 'channel:create', channels.toChannel(row));
        log(ctx, 'channel.create', `#${name}`, block.kind);
        break;
      }
      case 'delete_channel': {
        const name = channelName(fill(block.name, ctx).trim());
        const row = channels.forServer(ctx.bot.server_id).find((c) => c.name === name && c.kind !== 'category');
        if (!row) break;
        channels.remove(row.id);
        realtime.toServer(ctx.bot.server_id, 'channel:delete', { id: row.id, serverId: ctx.bot.server_id });
        log(ctx, 'channel.delete', `#${name}`);
        if (ctx.channel?.id === row.id) ctx.channel = null;
        break;
      }
      case 'rename_channel': {
        const channel = targetChannel(block, ctx);
        const name = channelName(fill(block.name, ctx).trim());
        if (!channel || !name) break;
        channelChanged(channels.update(channel.id, { name }));
        log(ctx, 'channel.update', `#${channel.name}`, `renamed to #${name}`);
        break;
      }
      case 'topic': {
        const channel = targetChannel(block, ctx);
        if (!channel) break;
        channelChanged(channels.update(channel.id, { topic: fill(block.text, ctx).slice(0, 1024) }));
        log(ctx, 'channel.update', `#${channel.name}`, 'topic');
        break;
      }
      case 'slowmode': {
        const channel = targetChannel(block, ctx);
        if (!channel) break;
        const seconds = block.slow || 0;
        channelChanged(channels.update(channel.id, { slowmode: seconds }));
        log(ctx, 'channel.update', `#${channel.name}`, `slowmode ${seconds}s`);
        break;
      }
      case 'lock': {
        const channel = targetChannel(block, ctx);
        if (!channel) break;
        channelChanged(channels.update(channel.id, { readOnly: block.lock === 'unlock' ? 0 : 1 }));
        log(ctx, 'channel.update', `#${channel.name}`, block.lock === 'unlock' ? 'unlocked' : 'locked');
        break;
      }
      case 'kick':
      case 'ban': {
        const user = targetUser(block, ctx);
        if (!canTouch(ctx, user)) break;
        const reason = fill(block.reason, ctx).slice(0, 500);
        if (block.type === 'ban') servers.ban(ctx.bot.server_id, user.id, reason);
        kickUser(ctx, user);
        log(ctx, block.type === 'ban' ? 'member.ban' : 'member.kick', `@${user.username}`, reason);
        break;
      }
      case 'timeout': {
        const user = targetUser(block, ctx);
        if (!canTouch(ctx, user)) break;
        servers.setMemberTimeout(ctx.bot.server_id, user.id, Date.now() + (block.minutes || 10) * 60_000);
        memberChanged(ctx, user.id);
        log(ctx, 'member.timeout', `@${user.username}`, [`for ${block.minutes || 10}m`, fill(block.reason, ctx)].filter(Boolean).join(' · '));
        break;
      }
      case 'untimeout': {
        const user = targetUser(block, ctx);
        if (!canTouch(ctx, user)) break;
        servers.setMemberTimeout(ctx.bot.server_id, user.id, null);
        memberChanged(ctx, user.id);
        log(ctx, 'member.timeout_remove', `@${user.username}`);
        break;
      }
      case 'give_role':
      case 'take_role':
      case 'toggle_role': {
        const user = targetUser(block, ctx);
        const role = findRole(ctx, fill(block.role, ctx));
        if (!role || !canTouch(ctx, user)) break;
        const has = servers.memberRoleIds(ctx.bot.server_id, user.id).includes(role.id);
        const on = block.type === 'give_role' || (block.type === 'toggle_role' && !has);
        if (on === has) break;
        servers.setMemberRole(ctx.bot.server_id, user.id, role.id, on);
        memberChanged(ctx, user.id);
        log(ctx, on ? 'role.give' : 'role.take', `@${user.username}`, role.name);
        break;
      }
      case 'create_role': {
        const name = fill(block.role, ctx).trim().slice(0, 40);
        if (!name || findRole(ctx, name) || servers.roles(ctx.bot.server_id).length >= 100) break;
        servers.createRole(ctx.bot.server_id, { name, color: block.color || null });
        rolesChanged(ctx);
        log(ctx, 'role.create', name);
        break;
      }
      case 'delete_role': {
        const role = findRole(ctx, fill(block.role, ctx));
        if (!role) break;
        const holders = servers.memberIds(ctx.bot.server_id).filter((id) => servers.memberRoleIds(ctx.bot.server_id, id).includes(role.id));
        servers.removeRole(ctx.bot.server_id, role.id);
        rolesChanged(ctx);
        for (const id of holders) memberChanged(ctx, id);
        log(ctx, 'role.delete', role.name);
        break;
      }
      case 'rename_role': {
        const role = findRole(ctx, fill(block.role, ctx));
        const name = fill(block.name, ctx).trim().slice(0, 40);
        if (!role || !name) break;
        servers.updateRole(ctx.bot.server_id, role.id, { name });
        rolesChanged(ctx);
        log(ctx, 'role.update', role.name, `renamed to ${name}`);
        break;
      }
      case 'color_role': {
        const role = findRole(ctx, fill(block.role, ctx));
        if (!role) break;
        servers.updateRole(ctx.bot.server_id, role.id, { color: block.color || null });
        rolesChanged(ctx);
        log(ctx, 'role.update', role.name, 'colour');
        break;
      }
      case 'invite': {
        const code = servers.createInvite(ctx.bot.server_id, ctx.bot.user_id, { maxUses: null, expiresAt: Date.now() + 86_400_000 });
        setVar(ctx.bot.id, block.name || 'invite', `/invite/${code}`);
        log(ctx, 'invite.create', code);
        break;
      }
      default:
    }
  }
}

const running = new Map(); // botId → how many scripts are running

async function run(bot, blocks, ctx) {
  if ((running.get(bot.id) || 0) >= MAX_RUNNING) return;
  running.set(bot.id, (running.get(bot.id) || 0) + 1);
  try {
    await runBlocks(blocks, { bot, steps: 0, sends: 0, args: [], started: Date.now(), ...ctx });
  } catch (err) {
    if (!(err instanceof Stop)) console.error(`Bot ${bot.id} failed:`, err);
  } finally {
    running.set(bot.id, running.get(bot.id) - 1);
  }
}

function enabledBots(serverId) {
  return db.prepare('SELECT * FROM bots WHERE server_id = ? AND enabled = 1').all(serverId);
}

function matches(trigger, content) {
  const text = content.toLowerCase();
  const want = (trigger.text || '').toLowerCase();
  switch (trigger.match) {
    case 'any': return true;
    case 'starts': return text.startsWith(want);
    case 'equals': return text.trim() === want.trim();
    default: return want !== '' && text.includes(want);
  }
}

post.onPost((event, payload) => {
  if (event === 'message') {
    const { channel, message } = payload;
    if (channel.type !== 'text' || message.author.bot) return;
    for (const bot of enabledBots(channel.server_id)) {
      for (const script of JSON.parse(bot.program)) {
        const { trigger } = script;
        if (!trigger) continue;
        let args = [];
        if (trigger.type === 'command') {
          // !name or /name
          const m = /^[!/](\S+)\s*([\s\S]*)$/.exec(message.content.trim());
          if (!m || m[1].toLowerCase() !== trigger.name) continue;
          args = m[2].split(/\s+/).filter(Boolean);
        } else if (trigger.type !== 'message' || !matches(trigger, message.content)) continue;
        run(bot, script.blocks, { channel, message, user: message.author, args });
      }
    }
  }
  if (event === 'reaction') {
    const { channel, message, user, emoji } = payload;
    if (channel.type !== 'text' || user.bot) return;
    for (const bot of enabledBots(channel.server_id)) {
      for (const script of JSON.parse(bot.program)) {
        const t = script.trigger;
        if (t?.type === 'reaction' && (!t.emoji || t.emoji === emoji)) run(bot, script.blocks, { channel, message, user, emoji, args: [] });
      }
    }
  }
  if (event === 'leave') {
    const { serverId, user } = payload;
    const first = channels.forServer(serverId).find((c) => c.kind === 'text');
    for (const bot of enabledBots(serverId)) {
      for (const script of JSON.parse(bot.program)) {
        if (script.trigger?.type === 'leave') run(bot, script.blocks, { channel: first, user, args: [] });
      }
    }
  }
  if (event === 'join') {
    const { serverId, user } = payload;
    const first = channels.forServer(serverId).find((c) => c.kind === 'text');
    for (const bot of enabledBots(serverId)) {
      for (const script of JSON.parse(bot.program)) {
        if (script.trigger?.type === 'join') run(bot, script.blocks, { channel: first, user });
      }
    }
  }
});

// Timers: checked once a minute; a timer fires when the minutes since the epoch divide evenly.
require('../platform').get('every')(60_000, () => {
  const minute = Math.floor(Date.now() / 60_000);
  for (const bot of db.prepare('SELECT * FROM bots WHERE enabled = 1').all()) {
    for (const script of JSON.parse(bot.program)) {
      const { trigger } = script;
      if (trigger?.type !== 'timer' || minute % trigger.minutes) continue;
      const channel = channels.get(trigger.channel);
      if (channel && channel.server_id === bot.server_id && channel.kind === 'text') run(bot, script.blocks, { channel });
    }
  }
}, { needed: () => Boolean(db.prepare(`SELECT 1 FROM bots WHERE enabled = 1 AND program LIKE '%"timer"%' LIMIT 1`).get()) });

// Someone picked from a drop-down under one of a bot's messages: run its matching "menu" scripts.
function pickFromMenu(channel, message, user, choice) {
  const bot = db.prepare('SELECT * FROM bots WHERE user_id = ? AND enabled = 1').get(message.author_id);
  if (!bot || bot.server_id !== channel.server_id) return false;
  const json = messages.serialize(message);
  let ran = false;
  for (const script of JSON.parse(bot.program)) {
    const t = script.trigger;
    if (t?.type !== 'menu' || (t.text && t.text.toLowerCase() !== choice.toLowerCase())) continue;
    ran = true;
    run(bot, script.blocks, { channel, message: json, user: users.toUser(users.get(user.id)), choice, args: [choice] });
  }
  return ran;
}

// Someone clicked a button under one of a bot's messages: run that bot's matching "button" scripts.
function clickButton(channel, message, user, label) {
  const bot = db.prepare('SELECT * FROM bots WHERE user_id = ? AND enabled = 1').get(message.author_id);
  if (!bot || bot.server_id !== channel.server_id) return false;
  const json = messages.serialize(message);
  let ran = false;
  for (const script of JSON.parse(bot.program)) {
    const t = script.trigger;
    if (t?.type !== 'button' || (t.text && t.text.toLowerCase() !== label.toLowerCase())) continue;
    ran = true;
    run(bot, script.blocks, { channel, message: json, user: users.toUser(users.get(user.id)), button: label, args: [label] });
  }
  return ran;
}

module.exports = { toBot, forServer, get, create, update, remove, validateProgram, setAdmin, clickButton, pickFromMenu };
