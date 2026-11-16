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
const botAi = require('./botAi');

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
const MAX_REPEAT = 100; // times round one "repeat" block
const MAX_NODES = 60; // reporter blocks inside one block's inputs

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
  db.prepare("UPDATE users SET is_bot = 1, avatar = '@default/bot' WHERE id = ?").run(user.id);
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
  // People's 1:1 DMs with the bot go too (a DM with nobody on the other end can't be shown).
  const dms = db.prepare(`SELECT channels.id FROM channels JOIN dm_members ON dm_members.channel_id = channels.id
    WHERE dm_members.user_id = ? AND channels.type = 'dm' AND COALESCE(channels.kind, 'dm') = 'dm'`).all(bot.user_id);
  for (const { id } of dms) {
    for (const userId of channels.dmMemberIds(id)) if (userId !== bot.user_id) realtime.toUser(userId, 'dm:delete', { id });
    db.prepare('DELETE FROM channels WHERE id = ?').run(id);
  }
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

const TRIGGERS = ['message', 'command', 'join', 'timer', 'button', 'reaction', 'leave', 'menu', 'tool', 'ai_message'];
const ACTIONS = ['send', 'reply', 'react', 'wait', 'set', 'change', 'if', 'repeat', 'random', 'stop',
  'forever', 'until', 'dm', 'ping', 'pin', 'join_voice', 'leave_voice',
  'buttons', 'menu_send', 'http', 'math', 'random_number', 'list_add', 'list_remove', 'list_pick', 'list_clear', 'text_case', 'unpin',
  'ai_connect', 'ai_reply', 'ai_ask', 'ai_tell', 'ai_instructions',
  'if_else', 'wait_until', 'list_delete', 'list_insert', 'list_replace'];
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

// --- reporters: the round (value) and pointed (true/false) blocks that go inside inputs ---
// Each is { r: type, …its inputs (a, b) and settings }. `fields` are fixed choices or names, `slots` take
// typed text or more reporters.
const VAR = { name: 'text' };
const REPORTERS = {
  // operators
  add: { slots: ['a', 'b'] }, sub: { slots: ['a', 'b'] }, mul: { slots: ['a', 'b'] }, div: { slots: ['a', 'b'] },
  mod: { slots: ['a', 'b'] }, random: { slots: ['a', 'b'] }, round: { slots: ['a'] },
  math: { slots: ['a'], fields: { fn: ['abs', 'floor', 'ceiling', 'sqrt'] } },
  join: { slots: ['a', 'b'] }, letter: { slots: ['a', 'b'] }, length: { slots: ['a'] },
  case: { slots: ['a'], fields: { fn: ['upper', 'lower'] } },
  contains: { slots: ['a', 'b'] }, starts: { slots: ['a', 'b'] }, gt: { slots: ['a', 'b'] }, lt: { slots: ['a', 'b'] }, eq: { slots: ['a', 'b'] },
  and: { slots: ['a', 'b'] }, or: { slots: ['a', 'b'] }, not: { slots: ['a'] },
  // variables and lists
  var: { fields: VAR }, list: { fields: VAR }, item: { slots: ['a'], fields: VAR }, list_length: { fields: VAR },
  list_contains: { slots: ['a'], fields: VAR }, list_random: { fields: VAR },
  // what happened
  user_name: {}, user_mention: {}, user_id: {}, message: {}, words: {}, word: { slots: ['a'] }, channel_name: {}, server_name: {},
  member_count: {}, button: {}, choice: {}, emoji: {}, said: {}, mentioned_name: {}, mentioned_mention: {}, has_role: { slots: ['a'] },
  now: { fields: { fn: ['year', 'month', 'date', 'weekday', 'hour', 'minute', 'second', 'time', 'day'] } },
  // web and AI
  web: { slots: ['a', 'b'] }, ai_answer: { slots: ['a'] }, tool_input: { fields: VAR }, ai_error: {},
};
const isReporter = (x) => Boolean(x) && typeof x === 'object' && !Array.isArray(x) && typeof x.r === 'string';
// Block inputs that may hold reporters.
const SLOT_KEYS = ['text', 'emoji', 'name', 'value', 'left', 'right', 'channel', 'reason', 'role', 'url', 'field', 'key', 'model',
  'seconds', 'times', 'count', 'minutes', 'slow', 'min', 'max', 'index', 'cond'];

function validateSlot(x, budget, depth = 0) {
  if (x == null) return '';
  if (typeof x === 'number') return Number.isFinite(x) ? x : 0;
  if (!isReporter(x)) return clean(x);
  const def = REPORTERS[x.r];
  if (!def || depth > 12 || (budget.n += 1) > MAX_NODES) throw new Error('Unknown or too many value blocks.');
  const out = { r: x.r };
  for (const key of def.slots || []) out[key] = validateSlot(x[key], budget, depth + 1);
  for (const [key, allowed] of Object.entries(def.fields || {})) {
    out[key] = Array.isArray(allowed) ? (allowed.includes(x[key]) ? x[key] : allowed[0]) : clean(x[key], 100);
  }
  return out;
}

function validateBlocks(blocks, depth = 0) {
  if (!Array.isArray(blocks) || depth > 6) throw new Error('Blocks are nested too deep.');
  const RETIRED = ['ai_model', 'ai_remember', 'ai_forget'];
  return blocks.slice(0, 100).filter((b) => !RETIRED.includes(b?.type)).map((raw) => {
    if (!raw || !ALL_ACTIONS.includes(raw.type)) throw new Error('Unknown block.');
    const out = { type: raw.type };
    // Inputs holding reporters are checked here; plain ones below, as before.
    const b = { ...raw };
    const budget = { n: 0 };
    for (const key of SLOT_KEYS) {
      if (isReporter(raw[key])) {
        out[key] = validateSlot(raw[key], budget);
        delete b[key];
      }
    }
    if (b.index !== undefined) out.index = clean(b.index, 20);
    for (const key of ['text', 'emoji', 'name', 'value', 'left', 'right', 'channel', 'reason', 'role', 'url', 'field', 'key', 'model']) if (b[key] !== undefined) out[key] = clean(b[key]);
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
    if (b.times !== undefined) out.times = Math.min(Math.max(Math.round(Number(b.times)) || 0, 0), MAX_REPEAT);
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
    if (t.type === 'tool') {
      // A tool the AI can use: a name the model calls it by, what it does, and its parameters (one per line).
      trigger.name = clean(t.name, 40).trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'tool';
      trigger.description = clean(t.description, 500);
      trigger.options = (Array.isArray(t.options) ? t.options : []).slice(0, 15).map((o) => clean(o, 200));
    }
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
      // AI: {param.city} is what the AI passed to a tool; {prompt} what someone said to it; {answer} its last answer.
      case 'param': {
        const value = ctx.params?.[rest || ''];
        return value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
      }
      case 'params': return ctx.params ? JSON.stringify(ctx.params) : '';
      case 'prompt': return ctx.prompt ?? ctx.message?.content ?? '';
      case 'answer': return ctx.answer ?? '';
      case 'ai': {
        if (rest === 'error') return ctx.aiError ?? '';
        return ctx.ai?.model ?? '';
      }
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

// --- working out inputs ---

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// 0.1 + 0.2 shows as 0.3, like Scratch.
const tidyNumber = (n) => (Number.isFinite(n) ? Math.round(n * 1e10) / 1e10 : 0);
const truthy = (x) => x === true || String(x).toLowerCase() === 'true';
// "1".."n" → 0..n-1; "last" → the last one; anything else → -1.
function listIndex(raw, length) {
  const text = String(raw ?? '').trim().toLowerCase();
  if (text === 'last') return length - 1;
  const n = Math.round(Number(text));
  return n >= 1 && n <= length ? n - 1 : -1;
}

// Scratch's comparison: numbers as numbers, everything else as text, ignoring case.
function compare(a, b) {
  const x = Number(a);
  const y = Number(b);
  if (String(a).trim() !== '' && String(b).trim() !== '' && !Number.isNaN(x) && !Number.isNaN(y)) return x - y;
  const p = String(a).toLowerCase();
  const q = String(b).toLowerCase();
  return p < q ? -1 : p > q ? 1 : 0;
}

// One input: a reporter is worked out; typed text still understands the old {user}-style templates.
async function slot(x, ctx) {
  if (isReporter(x)) return evaluate(x, ctx);
  if (typeof x === 'number') return x;
  return fill(x ?? '', ctx);
}

async function evaluate(node, ctx) {
  const a = () => slot(node.a, ctx);
  const b = () => slot(node.b, ctx);
  const n = async (x) => Number(await x) || 0;
  switch (node.r) {
    case 'add': return tidyNumber(await n(a()) + await n(b()));
    case 'sub': return tidyNumber(await n(a()) - await n(b()));
    case 'mul': return tidyNumber(await n(a()) * await n(b()));
    case 'div': { const d = await n(b()); return d ? tidyNumber(await n(a()) / d) : 0; }
    case 'mod': { const d = await n(b()); const x = await n(a()); return d ? tidyNumber(((x % d) + d) % d) : 0; }
    case 'random': {
      const lo = await n(a());
      const hi = await n(b());
      const [min, max] = lo <= hi ? [lo, hi] : [hi, lo];
      if (Number.isInteger(min) && Number.isInteger(max)) return min + Math.floor(Math.random() * (max - min + 1));
      return tidyNumber(min + Math.random() * (max - min));
    }
    case 'round': return Math.round(await n(a()));
    case 'math': {
      const x = await n(a());
      return tidyNumber({ abs: Math.abs(x), floor: Math.floor(x), ceiling: Math.ceil(x), sqrt: x >= 0 ? Math.sqrt(x) : 0 }[node.fn] ?? x);
    }
    case 'join': return `${await a()}${await b()}`.slice(0, MAX_TEXT);
    case 'letter': return [...String(await b())][Math.round(await n(a())) - 1] ?? '';
    case 'length': return [...String(await a())].length;
    case 'case': return node.fn === 'lower' ? String(await a()).toLowerCase() : String(await a()).toUpperCase();
    case 'contains': return String(await a()).toLowerCase().includes(String(await b()).toLowerCase());
    case 'starts': return String(await a()).toLowerCase().startsWith(String(await b()).toLowerCase());
    case 'gt': return compare(await a(), await b()) > 0;
    case 'lt': return compare(await a(), await b()) < 0;
    case 'eq': return compare(await a(), await b()) === 0;
    case 'and': return truthy(await a()) && truthy(await b());
    case 'or': return truthy(await a()) || truthy(await b());
    case 'not': return !truthy(await a());
    case 'var': return getVar(ctx.bot.id, node.name);
    case 'list': return getList(ctx.bot.id, node.name).join(' ');
    case 'item': {
      const items = getList(ctx.bot.id, node.name);
      const raw = String(await a()).trim().toLowerCase();
      if (raw === 'random') return items.length ? items[Math.floor(Math.random() * items.length)] : '';
      return items[listIndex(raw, items.length)] ?? '';
    }
    case 'list_length': return getList(ctx.bot.id, node.name).length;
    case 'list_contains': {
      const want = String(await a()).toLowerCase();
      return getList(ctx.bot.id, node.name).some((item) => item.toLowerCase() === want);
    }
    case 'list_random': {
      const items = getList(ctx.bot.id, node.name);
      return items.length ? items[Math.floor(Math.random() * items.length)] : '';
    }
    case 'user_name': return ctx.user?.displayName ?? '';
    case 'user_mention': return ctx.user ? `@${ctx.user.username}` : '';
    case 'user_id': return ctx.user?.username ?? '';
    case 'message': return ctx.message?.content ?? '';
    case 'words': return (ctx.args || []).join(' ');
    case 'word': return (ctx.args || [])[Math.round(await n(a())) - 1] ?? '';
    case 'channel_name': return ctx.channel?.name ?? '';
    case 'server_name': return servers.get(ctx.bot.server_id)?.name ?? '';
    case 'member_count': return servers.memberIds(ctx.bot.server_id).length;
    case 'button': return ctx.button ?? '';
    case 'choice': return ctx.choice ?? '';
    case 'emoji': return ctx.emoji ?? '';
    case 'said': return ctx.prompt ?? ctx.message?.content ?? '';
    case 'mentioned_name': return targetUser({ target: 'mentioned' }, ctx)?.display_name ?? '';
    case 'mentioned_mention': { const u = targetUser({ target: 'mentioned' }, ctx); return u ? `@${u.username}` : ''; }
    case 'has_role': {
      const want = String(await a()).trim().toLowerCase();
      return Boolean(ctx.user) && rolesOf(ctx, ctx.user.id).some((r) => r.name.toLowerCase() === want);
    }
    case 'now': {
      const d = new Date();
      return {
        year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, date: d.getUTCDate(), hour: d.getUTCHours(), minute: d.getUTCMinutes(), second: d.getUTCSeconds(),
        weekday: d.toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' }),
        time: d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }),
        day: d.toLocaleDateString('en-GB', { timeZone: 'UTC' }),
      }[node.fn] ?? '';
    }
    case 'web': {
      // GET a public web address (never this machine or the local network); a JSON path picks one part.
      if ((ctx.http = (ctx.http || 0) + 1) > MAX_HTTP) return '';
      const url = String(await a()).trim();
      if (!/^https?:\/\//i.test(url)) return '';
      const res = await previews.get(url, { maxBytes: 256 * 1024 });
      let value = res ? res.body.toString('utf8') : '';
      const path = String(await b()).trim();
      if (value && path) {
        try { value = pick(JSON.parse(value), path); } catch { value = ''; }
      }
      return value.slice(0, MAX_TEXT);
    }
    case 'ai_answer': {
      const prompt = String(await a()).trim();
      return prompt ? askAi(ctx, { prompt }) : '';
    }
    case 'tool_input': {
      const value = ctx.params?.[node.name];
      return value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
    }
    case 'ai_error': return ctx.aiError ?? '';
    default: return '';
  }
}

// All of a block's inputs as text, before it runs.
async function resolve(block, ctx) {
  const out = {};
  for (const key of SLOT_KEYS) {
    if (key === 'cond' || block[key] === undefined) continue;
    out[key] = String(await slot(block[key], ctx)).slice(0, MAX_TEXT);
  }
  return out;
}

// The condition of an if / repeat until / wait until: a pointed block, or the old "left op right" form.
// An empty condition is false, like Scratch.
async function check(block, ctx) {
  if (block.cond !== undefined) return isReporter(block.cond) ? truthy(await evaluate(block.cond, ctx)) : truthy(fill(block.cond, ctx));
  return block.op ? test(block, ctx) : false;
}

// --- AI ---

const MAX_AI_DEPTH = 2; // a tool may ask the AI something, but that can't call tools that ask again…

// Shows "… is typing" while the AI thinks.
function typing(ctx) {
  if (ctx.channel) realtime.toChannel(ctx.channel, 'typing', { channelId: ctx.channel.id, userId: ctx.bot.user_id });
}

// Asks the AI set by the last "use AI" block; tools it calls run as blocks. Resolves the answer, or '' with
// ctx.aiError set.
async function askAi(ctx, { prompt = null } = {}) {
  ctx.aiError = '';
  if ((ctx.aiDepth || 0) >= MAX_AI_DEPTH) {
    ctx.aiError = 'Tools can’t ask the AI this deep.';
    return '';
  }
  const row = get(ctx.bot.id);
  if (!row) return '';
  typing(ctx);
  const keepTyping = setInterval(() => typing(ctx), 4000);
  try {
    const answer = await botAi.converse(row, {
      ai: ctx.ai, channel: ctx.channel, message: ctx.message, prompt, instructions: ctx.aiExtra || '',
      runTool: (script, params) => runTool(row, script, params, ctx),
    });
    ctx.answer = answer;
    return answer;
  } catch (err) {
    if (!(err instanceof botAi.AiError)) console.error(`Bot ${ctx.bot.id} AI failed:`, err);
    ctx.aiError = err instanceof botAi.AiError ? err.message : 'The AI request failed.';
    return '';
  } finally {
    clearInterval(keepTyping);
  }
}

// The AI called one of the bot's tools: run the blocks under that "tool" hat. Whatever they "tell the AI" is
// the tool's result; with nothing told, the AI hears what happened.
async function runTool(bot, script, params, parent = {}) {
  const ctx = {
    bot, steps: 0, sends: 0, started: Date.now(), channel: parent.channel || null, message: parent.message || null, user: parent.user || null,
    params, args: Object.values(params).map((v) => (typeof v === 'object' ? JSON.stringify(v) : String(v))),
    prompt: parent.prompt, toolResult: [], aiDepth: (parent.aiDepth || 0) + 1, ai: parent.ai, aiExtra: parent.aiExtra,
  };
  try {
    await runBlocks(script.blocks || [], ctx);
  } catch (err) {
    if (!(err instanceof Stop)) throw err;
  }
  if (ctx.toolResult.length) return ctx.toolResult.join('\n');
  return ctx.sends ? `Done. Sent ${ctx.sends} message${ctx.sends === 1 ? '' : 's'}.` : 'Done.';
}

async function runBlocks(blocks, ctx) {
  for (const block of blocks) {
    tick(ctx);
    if (ADMIN_ACTIONS.includes(block.type) && !isAdmin(ctx)) continue;
    // Every input, worked out now: typed text (old {…} templates still work) or the blocks dropped into it.
    const v = await resolve(block, ctx);
    switch (block.type) {
      case 'send':
      case 'random': {
        const text = block.type === 'random' ? fill(block.options?.[Math.floor(Math.random() * (block.options?.length || 1))], ctx) : v.text;
        say(ctx, targetChannel(block, ctx), text.trim());
        break;
      }
      case 'reply':
        say(ctx, ctx.channel, v.text.trim(), ctx.message?.id);
        break;
      case 'ping': {
        const user = targetUser(block, ctx);
        if (user) say(ctx, ctx.channel, `@${user.username} ${v.text}`.trim());
        break;
      }
      case 'everyone':
        say(ctx, targetChannel(block, ctx), `@everyone ${v.text}`.trim());
        break;
      case 'dm': {
        const user = targetUser(block, ctx);
        const content = v.text.trim();
        if (!user || !content || ctx.sends >= MAX_SENDS || !canSend(ctx.bot.id)) break;
        ctx.sends += 1;
        post.postMessage(channels.getOrCreateDm(ctx.bot.user_id, user.id), ctx.bot.user_id, content);
        break;
      }
      case 'react':
        if (ctx.message && block.emoji) {
          messages.react(ctx.message.id, ctx.bot.user_id, v.emoji.slice(0, 80));
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
        await sleep(Math.min(Math.max(Number(v.seconds) || 0, 0), MAX_WAIT) * 1000);
        break;
      case 'set':
        setVar(ctx.bot.id, v.name, v.value);
        break;
      case 'change':
        setVar(ctx.bot.id, v.name, tidyNumber((Number(getVar(ctx.bot.id, v.name)) || 0) + (Number(v.value) || 0)));
        break;
      case 'if':
      case 'if_else':
        await runBlocks(await check(block, ctx) ? block.do || [] : block.else || [], ctx);
        break;
      case 'repeat': {
        const times = Math.min(Math.max(Math.round(Number(v.times)) || 0, 0), MAX_REPEAT);
        for (let i = 0; i < times; i++) {
          stillOn(ctx);
          await runBlocks(block.do || [], ctx);
        }
        break;
      }
      case 'wait_until':
        while (!(await check(block, ctx))) {
          tick(ctx);
          stillOn(ctx);
          await sleep(250);
        }
        break;
      case 'until':
        while (!(await check(block, ctx))) {
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
        const content = v.text.trim();
        if (!channel || !content || !labels.length || ctx.sends >= MAX_SENDS || !canSend(ctx.bot.id)) break;
        ctx.sends += 1;
        post.postMessage(channel, ctx.bot.user_id, content, { components: labels.map((label) => ({ label })) });
        break;
      }
      case 'menu_send': {
        // A message with a drop-down of up to 25 choices; picking one runs "when someone picks from a menu".
        const options = (block.options || []).map((o) => fill(o, ctx).trim().slice(0, 80)).filter(Boolean).slice(0, 25);
        const channel = targetChannel(block, ctx);
        const content = v.text.trim();
        if (!channel || !content || !options.length || ctx.sends >= MAX_SENDS || !canSend(ctx.bot.id)) break;
        ctx.sends += 1;
        post.postMessage(channel, ctx.bot.user_id, content, { components: [{ type: 'menu', placeholder: v.name.slice(0, 80) || 'Pick one', options }] });
        break;
      }
      case 'http': {
        // GET a public web address (never this machine or the local network) and keep the reply in a variable.
        if ((ctx.http = (ctx.http || 0) + 1) > MAX_HTTP) break;
        const url = v.url.trim();
        if (!/^https?:\/\//i.test(url)) break;
        const res = await previews.get(url, { maxBytes: 256 * 1024 });
        let value = res ? res.body.toString('utf8') : '';
        if (value && block.field) {
          try { value = pick(JSON.parse(value), v.field); } catch { value = ''; }
        }
        setVar(ctx.bot.id, block.name || 'response', value.slice(0, MAX_TEXT));
        break;
      }
      case 'math': {
        const a = Number(v.left) || 0;
        const b = Number(v.right) || 0;
        const result = {
          '+': a + b, '-': a - b, '*': a * b, '/': b ? a / b : 0, '%': b ? a % b : 0, min: Math.min(a, b), max: Math.max(a, b), round: Math.round(a),
        }[block.math || '+'];
        setVar(ctx.bot.id, block.name, Number.isFinite(result) ? Math.round(result * 1e6) / 1e6 : 0);
        break;
      }
      case 'random_number': {
        const lo = Math.min(Number(v.min) || 1, Number(v.max) || 10);
        const hi = Math.max(Number(v.min) || 1, Number(v.max) || 10);
        setVar(ctx.bot.id, block.name, Math.floor(Math.random() * (hi - lo + 1)) + lo);
        break;
      }
      case 'list_add': {
        const items = getList(ctx.bot.id, v.name);
        items.push(v.value.slice(0, 200));
        setList(ctx.bot.id, v.name, items);
        break;
      }
      case 'list_delete': {
        // "delete item (n) of [list]"; "all" or nothing empties it.
        const items = getList(ctx.bot.id, v.name);
        const at = listIndex(v.index, items.length);
        if (at < 0) break;
        items.splice(at, 1);
        setList(ctx.bot.id, v.name, items);
        break;
      }
      case 'list_insert': {
        const items = getList(ctx.bot.id, v.name);
        const at = Math.min(Math.max(Math.round(Number(v.index)) || 1, 1), items.length + 1) - 1;
        items.splice(at, 0, v.value.slice(0, 200));
        setList(ctx.bot.id, v.name, items);
        break;
      }
      case 'list_replace': {
        const items = getList(ctx.bot.id, v.name);
        const at = listIndex(v.index, items.length);
        if (at < 0) break;
        items[at] = v.value.slice(0, 200);
        setList(ctx.bot.id, v.name, items);
        break;
      }
      case 'list_remove': {
        const value = v.value.toLowerCase();
        setList(ctx.bot.id, v.name, getList(ctx.bot.id, v.name).filter((item) => item.toLowerCase() !== value));
        break;
      }
      case 'list_clear':
        setList(ctx.bot.id, v.name, []);
        break;
      case 'list_pick': {
        const items = getList(ctx.bot.id, block.name);
        setVar(ctx.bot.id, block.value || 'picked', items.length ? items[Math.floor(Math.random() * items.length)] : '');
        break;
      }
      case 'text_case': {
        const text = v.value;
        const out = { upper: text.toUpperCase(), lower: text.toLowerCase(), length: String(text.length), reverse: [...text].reverse().join(''), trim: text.trim() }[block.textCase || 'upper'];
        setVar(ctx.bot.id, block.name, out);
        break;
      }
      // --- AI ---
      case 'ai_connect':
        ctx.ai = { endpoint: v.url.trim(), key: v.key.trim(), model: v.model.trim() };
        break;
      case 'ai_reply': {
        const answer = await askAi(ctx);
        if (answer) say(ctx, ctx.channel, answer, ctx.message && messages.get(ctx.message.id) ? ctx.message.id : null);
        else if (ctx.aiError) say(ctx, ctx.channel, `⚠️ ${ctx.aiError}`, ctx.message?.id);
        break;
      }
      case 'ai_ask': {
        const prompt = v.text.trim();
        setVar(ctx.bot.id, block.name || 'answer', prompt ? await askAi(ctx, { prompt }) : '');
        break;
      }
      case 'ai_tell':
        (ctx.toolResult ||= []).push(v.text);
        break;
      case 'ai_instructions':
        ctx.aiExtra = [ctx.aiExtra, v.text].filter(Boolean).join('\n');
        break;
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
        const rows = db.prepare('SELECT * FROM messages WHERE channel_id = ? ORDER BY id DESC LIMIT ?').all(channel.id, Math.min(Math.max(Math.round(Number(v.count)) || 10, 1), 100));
        for (const row of rows) {
          messages.remove(row);
          realtime.toChannel(channel, 'message:delete', { id: row.id, channelId: channel.id });
        }
        log(ctx, 'message.delete', `#${channel.name}`, `cleared ${rows.length} messages`);
        break;
      }
      case 'create_channel': {
        const name = channelName(v.name.trim());
        if (!name || channels.forServer(ctx.bot.server_id).length >= 200) break;
        const row = channels.create(ctx.bot.server_id, name, { kind: block.kind === 'voice' ? 'voice' : 'text' });
        realtime.toServer(ctx.bot.server_id, 'channel:create', channels.toChannel(row));
        log(ctx, 'channel.create', `#${name}`, block.kind);
        break;
      }
      case 'delete_channel': {
        const name = channelName(v.name.trim());
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
        const name = channelName(v.name.trim());
        if (!channel || !name) break;
        channelChanged(channels.update(channel.id, { name }));
        log(ctx, 'channel.update', `#${channel.name}`, `renamed to #${name}`);
        break;
      }
      case 'topic': {
        const channel = targetChannel(block, ctx);
        if (!channel) break;
        channelChanged(channels.update(channel.id, { topic: v.text.slice(0, 1024) }));
        log(ctx, 'channel.update', `#${channel.name}`, 'topic');
        break;
      }
      case 'slowmode': {
        const channel = targetChannel(block, ctx);
        if (!channel) break;
        const seconds = Math.min(Math.max(Math.round(Number(v.slow)) || 0, 0), 21600);
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
        const reason = v.reason.slice(0, 500);
        if (block.type === 'ban') servers.ban(ctx.bot.server_id, user.id, reason);
        kickUser(ctx, user);
        log(ctx, block.type === 'ban' ? 'member.ban' : 'member.kick', `@${user.username}`, reason);
        break;
      }
      case 'timeout': {
        const user = targetUser(block, ctx);
        if (!canTouch(ctx, user)) break;
        const minutes = Math.min(Math.max(Math.round(Number(v.minutes)) || 10, 1), 10080);
        servers.setMemberTimeout(ctx.bot.server_id, user.id, Date.now() + minutes * 60_000);
        memberChanged(ctx, user.id);
        log(ctx, 'member.timeout', `@${user.username}`, [`for ${minutes}m`, v.reason].filter(Boolean).join(' · '));
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
        const role = findRole(ctx, v.role);
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
        const name = v.role.trim().slice(0, 40);
        if (!name || findRole(ctx, name) || servers.roles(ctx.bot.server_id).length >= 100) break;
        servers.createRole(ctx.bot.server_id, { name, color: block.color || null });
        rolesChanged(ctx);
        log(ctx, 'role.create', name);
        break;
      }
      case 'delete_role': {
        const role = findRole(ctx, v.role);
        if (!role) break;
        const holders = servers.memberIds(ctx.bot.server_id).filter((id) => servers.memberRoleIds(ctx.bot.server_id, id).includes(role.id));
        servers.removeRole(ctx.bot.server_id, role.id);
        rolesChanged(ctx);
        for (const id of holders) memberChanged(ctx, id);
        log(ctx, 'role.delete', role.name);
        break;
      }
      case 'rename_role': {
        const role = findRole(ctx, v.role);
        const name = v.name.trim().slice(0, 40);
        if (!role || !name) break;
        servers.updateRole(ctx.bot.server_id, role.id, { name });
        rolesChanged(ctx);
        log(ctx, 'role.update', role.name, `renamed to ${name}`);
        break;
      }
      case 'color_role': {
        const role = findRole(ctx, v.role);
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

// Someone talked to the bot (an @mention, a reply to it, or a DM): run its "when someone talks to me" scripts.
function maybeAnswer(bot, channel, message, commanded) {
  if (commanded || !botAi.talksTo(bot, channel, message)) return;
  const scripts = JSON.parse(bot.program).filter((s) => s.trigger?.type === 'ai_message');
  if (!scripts.length) return;
  const prompt = botAi.promptOf(bot, message);
  const ctx = { channel, message, user: message.author, args: prompt.split(/\s+/).filter(Boolean), prompt };
  for (const script of scripts) run(bot, script.blocks, ctx);
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
    if (message.author.bot) return;
    if (channel.type === 'dm') {
      // A DM with a bot: only its AI answers there.
      const ids = channels.dmMemberIds(channel.id);
      const rows = db.prepare('SELECT * FROM bots WHERE enabled = 1 AND user_id IN (SELECT value FROM json_each(?))').all(JSON.stringify(ids));
      for (const bot of rows) maybeAnswer(bot, channel, message, false);
      return;
    }
    if (channel.type !== 'text') return;
    for (const bot of enabledBots(channel.server_id)) {
      let commanded = false;
      for (const script of JSON.parse(bot.program)) {
        const { trigger } = script;
        if (!trigger) continue;
        let args = [];
        if (trigger.type === 'command') {
          // !name or /name
          const m = /^[!/](\S+)\s*([\s\S]*)$/.exec(message.content.trim());
          if (!m || m[1].toLowerCase() !== trigger.name) continue;
          args = m[2].split(/\s+/).filter(Boolean);
          commanded = true;
        } else if (trigger.type !== 'message' || !matches(trigger, message.content)) continue;
        run(bot, script.blocks, { channel, message, user: message.author, args });
      }
      maybeAnswer(bot, channel, message, commanded);
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
