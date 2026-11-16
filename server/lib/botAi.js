// AI for bots. Each bot can have a model behind it: any OpenAI-compatible endpoint (OpenAI, OpenRouter, Groq,
// Gemini, Mistral, DeepSeek, Together, a self-hosted server…) or Anthropic's own API. People talk to it by
// @mentioning it, replying to it, DMing it, or in channels set to "answer everything".
//
// Tools come from the block editor: a "the AI can use the tool …" hat with its parameters is offered to the
// model, and when the model calls it the blocks under that hat run (with {param.name} filled in) and whatever
// they "tell the AI" goes back to it. So anything a bot can do with blocks, the AI can do too.
//
// The API key is stored apart from the settings and never leaves the server.
const db = require('../db');
const platform = require('../platform');
const users = require('../models/users');
const servers = require('../models/servers');
const channels = require('../models/channels');

const MAX_ROUNDS = 8; // model calls per answer (each round may run several tools)
const MAX_TOOL_CALLS = 16; // tool runs per answer
const CALLS_PER_MINUTE = 30; // model calls per bot per minute
const MAX_BUSY = 3; // answers being written at once per bot
const MAX_REPLY = 4000;
const MAX_MEMORY = 40; // remembered facts
const TIMEOUT_MS = 120_000;

const PROVIDERS = ['openai', 'anthropic'];
const DEFAULTS = {
  enabled: false,
  provider: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  model: '',
  modelName: '',
  system: 'You are a friendly, helpful member of this chat server. Keep answers short and conversational, like a chat message.',
  temperature: 0.7,
  maxTokens: 1024,
  history: 20, // earlier messages it reads for context
  mention: true, // answer when @mentioned
  reply: true, // answer replies to its messages
  dm: true, // answer direct messages
  channels: [], // channels where it answers every message
  memory: true, // the built-in "remember" tools
  headers: '', // extra request headers, one "Name: value" per line
};

// --- settings ---

function settingsOf(row) {
  let saved = {};
  try { saved = row.ai ? JSON.parse(row.ai) : {}; } catch { /* broken JSON: start again */ }
  return { ...DEFAULTS, ...saved };
}

// What the browser sees: everything except the key, plus whether one is saved.
function publicSettings(row) {
  return { ...settingsOf(row), hasKey: Boolean(row.ai_key) };
}

const num = (value, lo, hi, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(Math.max(n, lo), hi) : fallback;
};
const str = (value, max) => String(value ?? '').slice(0, max);

function cleanSettings(input, current, serverId) {
  const out = { ...current };
  if (input.enabled !== undefined) out.enabled = Boolean(input.enabled);
  if (input.provider !== undefined) out.provider = PROVIDERS.includes(input.provider) ? input.provider : 'openai';
  if (input.baseUrl !== undefined) {
    const url = str(input.baseUrl, 300).trim().replace(/\/+$/, '');
    if (url && !/^https?:\/\/[^\s/]+/i.test(url)) throw new Error('The endpoint must start with https://');
    out.baseUrl = url;
  }
  if (input.model !== undefined) out.model = str(input.model, 120).trim();
  if (input.modelName !== undefined) out.modelName = str(input.modelName, 60).trim();
  if (input.system !== undefined) out.system = str(input.system, 8000);
  if (input.temperature !== undefined) out.temperature = input.temperature === null || input.temperature === '' ? null : num(input.temperature, 0, 2, 0.7);
  if (input.maxTokens !== undefined) out.maxTokens = Math.round(num(input.maxTokens, 16, 32000, 1024));
  if (input.history !== undefined) out.history = Math.round(num(input.history, 0, 50, 20));
  for (const key of ['mention', 'reply', 'dm', 'memory']) if (input[key] !== undefined) out[key] = Boolean(input[key]);
  if (input.channels !== undefined) {
    out.channels = (Array.isArray(input.channels) ? input.channels : []).map(String).filter((id) => {
      const channel = channels.get(id);
      return channel && channel.server_id === serverId && channel.kind === 'text';
    }).slice(0, 50);
  }
  if (input.headers !== undefined) out.headers = str(input.headers, 2000);
  return out;
}

function saveSettings(bot, input) {
  const settings = cleanSettings(input, settingsOf(bot), bot.server_id);
  db.prepare('UPDATE bots SET ai = ? WHERE id = ?').run(JSON.stringify(settings), bot.id);
  // An empty key leaves the saved one alone; `null` removes it.
  if (input.apiKey === null) db.prepare('UPDATE bots SET ai_key = NULL WHERE id = ?').run(bot.id);
  else if (typeof input.apiKey === 'string' && input.apiKey.trim()) db.prepare('UPDATE bots SET ai_key = ? WHERE id = ?').run(input.apiKey.trim().slice(0, 500), bot.id);
}

// --- memory: facts the bot keeps between conversations ---

function memory(botId) {
  try {
    const value = JSON.parse(db.prepare("SELECT value FROM bot_vars WHERE bot_id = ? AND key = 'ai:memory'").get(botId)?.value || '[]');
    return Array.isArray(value) ? value.map(String) : [];
  } catch {
    return [];
  }
}

function setMemory(botId, items) {
  db.prepare("INSERT OR REPLACE INTO bot_vars (bot_id, key, value) VALUES (?, 'ai:memory', ?)").run(botId, JSON.stringify(items.slice(-MAX_MEMORY)));
}

function remember(botId, fact) {
  const text = str(fact, 300).trim();
  if (!text) return false;
  const items = memory(botId).filter((item) => item.toLowerCase() !== text.toLowerCase());
  items.push(text);
  setMemory(botId, items);
  return true;
}

function forgetFact(botId, fact) {
  const wanted = str(fact, 300).trim().toLowerCase();
  const items = memory(botId);
  const kept = items.filter((item) => !item.toLowerCase().includes(wanted));
  setMemory(botId, kept);
  return items.length - kept.length;
}

// "Forget this conversation": earlier messages in that channel are no longer read.
function forgetChat(botId, channelId) {
  db.prepare('INSERT OR REPLACE INTO bot_vars (bot_id, key, value) VALUES (?, ?, ?)').run(botId, `ai:since:${channelId}`, String(Date.now()));
}

function forgetMemory(botId) {
  setMemory(botId, []);
}

// --- tools from the block editor ---

// One parameter per line: "city: the city to look up", "count (number): how many", "note?: optional".
function parseParams(lines) {
  const out = [];
  for (const line of lines || []) {
    const m = /^\s*([A-Za-z_]\w{0,39})\s*(\?)?\s*(?:\(\s*(string|text|number|integer|whole number|boolean|yes\/no)\s*\))?\s*(\?)?\s*(?::\s*(.*))?$/i.exec(line);
    if (!m) continue;
    const kind = (m[3] || 'string').toLowerCase();
    const type = { text: 'string', 'whole number': 'integer', 'yes/no': 'boolean' }[kind] || kind;
    out.push({ name: m[1], type, optional: Boolean(m[2] || m[4]), description: (m[5] || '').trim() });
  }
  return out.slice(0, 15);
}

function toolsOf(program) {
  const seen = new Set();
  const out = [];
  for (const script of program) {
    const t = script.trigger;
    if (t?.type !== 'tool' || !t.name || seen.has(t.name)) continue;
    seen.add(t.name);
    const params = parseParams(t.options);
    out.push({
      name: t.name,
      description: t.description || t.name.replace(/_/g, ' '),
      schema: {
        type: 'object',
        properties: Object.fromEntries(params.map((p) => [p.name, { type: p.type, ...(p.description ? { description: p.description } : {}) }])),
        required: params.filter((p) => !p.optional).map((p) => p.name),
      },
      script,
    });
  }
  return out;
}

const BUILT_IN = [
  {
    name: 'remember',
    description: 'Save a fact to your long-term memory so you still know it in later conversations (for example a preference someone told you).',
    schema: { type: 'object', properties: { fact: { type: 'string', description: 'The fact, as one short sentence.' } }, required: ['fact'] },
  },
  {
    name: 'forget',
    description: 'Remove facts from your long-term memory that contain the given words.',
    schema: { type: 'object', properties: { words: { type: 'string' } }, required: ['words'] },
  },
];

// --- the conversation so far ---

function nameOf(user) {
  return user ? `${user.display_name} (@${user.username})` : 'Someone';
}

// The last `limit` messages in the channel (or thread) up to and including `upTo`, oldest first.
function historyFor(bot, channel, upTo, limit) {
  if (!channel || !limit) return [];
  const since = Number(db.prepare('SELECT value FROM bot_vars WHERE bot_id = ? AND key = ?').get(bot.id, `ai:since:${channel.id}`)?.value) || 0;
  const thread = upTo?.threadId || null;
  const rows = db.prepare(`SELECT * FROM messages WHERE channel_id = ? AND created_at > ? ${upTo ? 'AND id <= ?' : ''}
    AND ${thread ? '(thread_id = ? OR id = ?)' : 'thread_id IS NULL'} ORDER BY id DESC LIMIT ?`)
    .all(...[channel.id, since, ...(upTo ? [upTo.id] : []), ...(thread ? [thread, thread] : []), limit]);
  const authors = new Map();
  const author = (id) => {
    if (!authors.has(id)) authors.set(id, users.get(id));
    return authors.get(id);
  };
  return rows.reverse().map((row) => {
    const files = db.prepare('SELECT COUNT(*) AS n FROM attachments WHERE message_id = ?').get(row.id)?.n || 0;
    const content = `${row.content}${files ? ` [${files} file${files === 1 ? '' : 's'} attached]` : ''}`.slice(0, 4000);
    if (row.author_id === bot.user_id) return { role: 'assistant', content };
    return { role: 'user', content: `${nameOf(author(row.author_id))}: ${content}` };
  });
}

// Most APIs want user and assistant turns to alternate, starting with the user.
function tidyTurns(turns) {
  const out = [];
  for (const turn of turns) {
    if (!turn.content.trim()) continue;
    const last = out.at(-1);
    if (last && last.role === turn.role) last.content += `\n${turn.content}`;
    else out.push({ ...turn });
  }
  while (out[0]?.role === 'assistant') out.shift();
  if (!out.length) out.push({ role: 'user', content: '(no message)' });
  return out;
}

function systemPrompt(bot, settings, { channel, extra }) {
  const me = users.get(bot.user_id);
  const server = servers.get(bot.server_id);
  let where = 'You are being tested in the bot builder.';
  if (channel?.type === 'dm') where = 'You are in a direct message conversation.';
  else if (channel) where = `You are talking in the channel #${channel.name}${channel.topic ? ` (topic: ${channel.topic})` : ''}.`;
  const facts = settings.memory ? memory(bot.id) : [];
  return [
    settings.system.trim(),
    '',
    `You are ${me.display_name} (@${me.username}), a bot in the chat server "${server?.name || ''}". ${where}`,
    'Messages from people start with their name and @username; mention someone by writing @username. Reply with only your message text; Markdown works.',
    `The time now is ${new Date().toISOString()}.`,
    facts.length ? `\nThings you remember:\n${facts.map((f) => `- ${f}`).join('\n')}` : '',
    extra ? `\n${extra}` : '',
  ].filter((line) => line !== null).join('\n').trim();
}

// --- talking to the model ---

const callsAt = new Map(); // botId → times of recent model calls

function allowCall(botId) {
  const now = Date.now();
  const recent = (callsAt.get(botId) || []).filter((t) => now - t < 60_000);
  callsAt.set(botId, recent);
  if (recent.length >= CALLS_PER_MINUTE) return false;
  recent.push(now);
  return true;
}

function extraHeaders(settings) {
  const out = {};
  for (const line of String(settings.headers || '').split('\n')) {
    const m = /^\s*([\w-]+)\s*:\s*(.+?)\s*$/.exec(line);
    if (m && !/^(host|content-length)$/i.test(m[1])) out[m[1]] = m[2];
  }
  return out;
}

class AiError extends Error {}

// The guarded fetcher, except that on a computer with AI_ALLOW_LOCAL=1 the AI may also reach this machine or
// the home network (a self-hosted model like Ollama or LM Studio). Never on Cloudflare.
async function aiFetch(url, options) {
  const local = typeof process !== 'undefined' && process.env?.AI_ALLOW_LOCAL === '1' && typeof globalThis.WebSocketPair === 'undefined';
  if (!local) return platform.get('fetchUrl')(url, options);
  try {
    const res = await fetch(url, {
      method: options.method || 'GET', body: options.body ?? undefined, headers: options.headers, signal: AbortSignal.timeout(options.timeout || TIMEOUT_MS),
    });
    return { url, status: res.status, type: res.headers.get('content-type') || '', body: Buffer.from(await res.arrayBuffer()) };
  } catch {
    return null;
  }
}

async function postJson(url, headers, body) {
  const res = await aiFetch(url, {
    method: 'POST', body: JSON.stringify(body), anyStatus: true, timeout: TIMEOUT_MS, redirects: 0, maxBytes: 4 * 1024 * 1024,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
  });
  if (!res) throw new AiError(`Couldn't reach ${url}. Check the endpoint (it must be a public https address).`);
  let data = null;
  try { data = JSON.parse(res.body.toString('utf8')); } catch { /* not JSON */ }
  if (res.status !== 200) {
    const message = data?.error?.message || data?.error?.type || data?.message || (typeof data?.error === 'string' ? data.error : '') || res.body.toString('utf8').slice(0, 300);
    throw Object.assign(new AiError(`The AI service said ${res.status}: ${message}`), { status: res.status, detail: message });
  }
  if (!data) throw new AiError('The AI service sent something that is not JSON. Check the endpoint.');
  return data;
}

// Some models refuse settings others need (a temperature, max_tokens vs max_completion_tokens). When the
// service says so, drop or rename that setting and try once more.
async function postAdapting(url, headers, body) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await postJson(url, headers, body);
    } catch (err) {
      const detail = String(err.detail || '').toLowerCase();
      // OpenRouter answers 404 "No endpoints found that support tool use" for models without tools.
      if (err.status === 404 && detail.includes('tool') && body.tools && attempt < 3) { delete body.tools; delete body.tool_choice; continue; }
      if (err.status !== 400 || attempt >= 3) throw err;
      if (detail.includes('temperature') && 'temperature' in body) delete body.temperature;
      else if (detail.includes('max_tokens') && 'max_tokens' in body) { body.max_completion_tokens = body.max_tokens; delete body.max_tokens; }
      else if (detail.includes('max_completion_tokens') && 'max_completion_tokens' in body) { body.max_tokens = body.max_completion_tokens; delete body.max_completion_tokens; }
      else if (detail.includes('tool') && body.tools) { delete body.tools; delete body.tool_choice; }
      else throw err;
    }
  }
}

function defaultBase(provider) {
  return provider === 'anthropic' ? 'https://api.anthropic.com/v1' : 'https://api.openai.com/v1';
}

// One reply from the model, as { text, calls: [{ id, name, args }] }; `state` carries the provider's own
// message list between rounds.
async function openaiRound(settings, key, state, tools) {
  const base = settings.baseUrl || defaultBase('openai');
  const body = { model: settings.model, messages: state.messages };
  if (settings.temperature != null) body.temperature = settings.temperature;
  body[/api\.openai\.com/.test(base) ? 'max_completion_tokens' : 'max_tokens'] = settings.maxTokens;
  if (tools.length) body.tools = tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.schema } }));
  const data = await postAdapting(`${base}/chat/completions`, { ...(key ? { Authorization: `Bearer ${key}` } : {}), ...extraHeaders(settings) }, body);
  const message = data.choices?.[0]?.message;
  if (!message) throw new AiError('The AI service sent no answer.');
  state.messages.push({ role: 'assistant', content: message.content ?? '', ...(message.tool_calls?.length ? { tool_calls: message.tool_calls } : {}) });
  const content = Array.isArray(message.content) ? message.content.map((p) => p.text || '').join('') : message.content || '';
  return {
    text: content,
    calls: (message.tool_calls || []).map((call) => {
      let args = {};
      try { args = JSON.parse(call.function?.arguments || '{}') || {}; } catch { /* bad JSON from the model */ }
      return { id: call.id, name: call.function?.name, args };
    }),
  };
}

function openaiResults(state, results) {
  for (const r of results) state.messages.push({ role: 'tool', tool_call_id: r.id, content: r.output });
}

async function anthropicRound(settings, key, state, tools) {
  const base = settings.baseUrl || defaultBase('anthropic');
  const body = { model: settings.model, max_tokens: settings.maxTokens, system: state.system, messages: state.messages };
  if (settings.temperature != null) body.temperature = Math.min(settings.temperature, 1);
  if (tools.length) body.tools = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.schema }));
  const data = await postAdapting(`${base}/messages`, {
    ...(key ? { 'x-api-key': key } : {}), 'anthropic-version': '2023-06-01', ...extraHeaders(settings),
  }, body);
  const content = Array.isArray(data.content) ? data.content : [];
  state.messages.push({ role: 'assistant', content });
  return {
    text: content.filter((b) => b.type === 'text').map((b) => b.text).join(''),
    calls: content.filter((b) => b.type === 'tool_use').map((b) => ({ id: b.id, name: b.name, args: b.input || {} })),
  };
}

function anthropicResults(state, results) {
  state.messages.push({ role: 'user', content: results.map((r) => ({ type: 'tool_result', tool_use_id: r.id, content: r.output })) });
}

const busy = new Map(); // botId → answers being written

// Runs a whole conversation turn: the model may call tools (blocks run for each) until it gives an answer.
//   bot        the bot row
//   channel    where it's talking (null in the builder's test chat)
//   message    the message it's answering (serialized), if any
//   turns      [{ role, content }] to send instead of the channel's history (test chat, "ask the AI")
//   extra      more instructions for this answer only
//   useTools   offer tools (default yes)
//   runTool    (script, params) → Promise<string>, from the block runner
//   trace      an array to push { tool, args, output } into (for the test chat)
// Resolves the answer text ('' if the model said nothing). Throws AiError with a readable message.
async function converse(bot, { channel = null, message = null, turns = null, extra = '', useTools = true, model = '', runTool, trace = null, onRound = null }) {
  const settings = settingsOf(bot);
  if (model) settings.model = model;
  const key = bot.ai_key || '';
  if (!settings.model) throw new AiError('Pick a model in the bot’s AI settings first.');
  if ((busy.get(bot.id) || 0) >= MAX_BUSY) throw new AiError('The bot is already busy answering. Try again in a moment.');
  busy.set(bot.id, (busy.get(bot.id) || 0) + 1);
  try {
    const program = JSON.parse(bot.program || '[]');
    const own = useTools ? toolsOf(program) : [];
    const tools = [...own, ...(useTools && settings.memory ? BUILT_IN.filter((b) => !own.some((t) => t.name === b.name)) : [])];
    const system = systemPrompt(bot, settings, { channel, extra });
    const history = tidyTurns(turns || historyFor(bot, channel, message, Math.max(settings.history, 1)));
    const anthropic = settings.provider === 'anthropic';
    const state = anthropic ? { system, messages: history } : { messages: [{ role: 'system', content: system }, ...history] };
    let toolRuns = 0;
    let text = '';
    for (let round = 0; round < MAX_ROUNDS; round++) {
      if (!allowCall(bot.id)) throw new AiError('The bot has asked its AI too often this minute. Try again shortly.');
      onRound?.();
      const reply = anthropic ? await anthropicRound(settings, key, state, tools) : await openaiRound(settings, key, state, tools);
      text = reply.text || text;
      if (!reply.calls.length) break;
      const results = [];
      for (const call of reply.calls) {
        let output;
        const tool = tools.find((t) => t.name === call.name);
        if (!tool) output = `There is no tool called "${call.name}".`;
        else if (++toolRuns > MAX_TOOL_CALLS) output = 'Too many tool calls for one answer; answer with what you have.';
        else if (tool.name === 'remember' && !tool.script) output = remember(bot.id, call.args.fact) ? 'Saved.' : 'Nothing to save.';
        else if (tool.name === 'forget' && !tool.script) output = `Removed ${forgetFact(bot.id, call.args.words)} fact(s).`;
        else {
          try {
            output = await runTool(tool.script, call.args || {});
          } catch (err) {
            output = `The tool failed: ${err.message}`;
          }
        }
        output = str(output || 'Done.', 8000);
        trace?.push({ tool: call.name, args: call.args, output });
        results.push({ id: call.id, output });
      }
      if (anthropic) anthropicResults(state, results);
      else openaiResults(state, results);
      if (round === MAX_ROUNDS - 1) text = text || 'I ran out of steps before finishing.';
    }
    return text.trim().slice(0, MAX_REPLY);
  } finally {
    busy.set(bot.id, busy.get(bot.id) - 1);
  }
}

// The models the endpoint offers (GET {base}/models), as ids. Used to fill the model picker.
async function listModels(bot) {
  const settings = settingsOf(bot);
  const key = bot.ai_key || '';
  const anthropic = settings.provider === 'anthropic';
  const base = settings.baseUrl || defaultBase(settings.provider);
  const headers = anthropic
    ? { ...(key ? { 'x-api-key': key } : {}), 'anthropic-version': '2023-06-01' }
    : (key ? { Authorization: `Bearer ${key}` } : {});
  const res = await aiFetch(`${base}/models${anthropic ? '?limit=100' : ''}`, {
    anyStatus: true, timeout: 15_000, maxBytes: 2 * 1024 * 1024, headers: { Accept: 'application/json', ...headers, ...extraHeaders(settings) },
  });
  if (!res) throw new AiError(`Couldn't reach ${base}. Check the endpoint.`);
  let data = null;
  try { data = JSON.parse(res.body.toString('utf8')); } catch { /* not JSON */ }
  if (res.status !== 200) throw new AiError(`The AI service said ${res.status}: ${data?.error?.message || data?.message || 'no models list'}`);
  const list = Array.isArray(data?.data) ? data.data : Array.isArray(data?.models) ? data.models : Array.isArray(data) ? data : [];
  return list.map((m) => ({ id: String(m.id || m.name || ''), name: String(m.display_name || m.name || '') })).filter((m) => m.id).slice(0, 500);
}

// Should this message wake the bot's AI? Returns why, or null.
function shouldAnswer(bot, settings, channel, message) {
  if (!settings.enabled || !settings.model || message.author.id === bot.user_id) return null;
  if (channel.type === 'dm') return settings.dm && channels.dmMemberIds(channel.id).includes(bot.user_id) ? 'dm' : null;
  if (channel.server_id !== bot.server_id) return null;
  const me = users.get(bot.user_id);
  if (settings.mention && new RegExp(`(?<![\\w@])@${me.username.replace(/[.]/g, '\\.')}(?![a-z0-9_.])`, 'i').test(message.content)) return 'mention';
  if (settings.reply && message.replyTo?.author?.id === bot.user_id) return 'reply';
  if (settings.channels.includes(channel.id)) return 'channel';
  return null;
}

// What the person said, without the @mention of the bot.
function promptOf(bot, message) {
  const me = users.get(bot.user_id);
  return String(message?.content || '').replace(new RegExp(`@${me.username.replace(/[.]/g, '\\.')}\\b`, 'gi'), '').trim();
}

module.exports = {
  DEFAULTS, settingsOf, publicSettings, saveSettings, converse, shouldAnswer, promptOf, toolsOf, parseParams,
  remember, forgetChat, forgetMemory, memory, listModels, AiError,
};
