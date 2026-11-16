// AI for bots, driven entirely by blocks. A "use AI at … key … model …" block says which model to talk to:
// any OpenAI-compatible endpoint (OpenRouter, OpenAI, Groq, Gemini, a self-hosted server…) or Anthropic's.
// "answer them with AI" and "ask the AI" call it. "the AI can use the tool …" hats are offered to the model as
// tools: when it calls one, the blocks under that hat run and whatever they "tell the AI" goes back to it.
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
const HISTORY = 20; // earlier messages it reads
const MAX_TOKENS = 1024;
const TIMEOUT_MS = 120_000;

class AiError extends Error {}

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

// --- the conversation so far ---

// The last messages in the channel (or thread) up to and including `upTo`, oldest first.
function historyFor(bot, channel, upTo) {
  if (!channel) return [];
  const thread = upTo?.threadId || null;
  const rows = db.prepare(`SELECT * FROM messages WHERE channel_id = ? ${upTo ? 'AND id <= ?' : ''}
    AND ${thread ? '(thread_id = ? OR id = ?)' : 'thread_id IS NULL'} ORDER BY id DESC LIMIT ?`)
    .all(...[channel.id, ...(upTo ? [upTo.id] : []), ...(thread ? [thread, thread] : []), HISTORY]);
  return rows.reverse().map((row) => {
    const content = row.content.slice(0, 4000);
    if (row.author_id === bot.user_id) return { role: 'assistant', content };
    const author = users.get(row.author_id);
    return { role: 'user', content: `${author ? `${author.display_name} (@${author.username})` : 'Someone'}: ${content}` };
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

function systemPrompt(bot, channel, instructions) {
  const me = users.get(bot.user_id);
  const server = servers.get(bot.server_id);
  let where = '';
  if (channel?.type === 'dm') where = 'You are in a direct message conversation.';
  else if (channel) where = `You are talking in the channel #${channel.name}${channel.topic ? ` (topic: ${channel.topic})` : ''}.`;
  return [
    instructions.trim(),
    `You are ${me.display_name} (@${me.username}), a bot in the chat server "${server?.name || ''}". ${where}`,
    'Messages from people start with their name and @username; mention someone by writing @username. Reply with only your message text; Markdown works.',
    `The time now is ${new Date().toISOString()}.`,
  ].filter(Boolean).join('\n\n');
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

// The guarded fetcher, except that on a computer with AI_ALLOW_LOCAL=1 the AI may also reach this machine or
// the home network (a self-hosted model like Ollama or LM Studio). Never on Cloudflare.
async function aiFetch(url, options) {
  const local = typeof process !== 'undefined' && process.env?.AI_ALLOW_LOCAL === '1' && typeof globalThis.WebSocketPair === 'undefined';
  if (!local) return platform.get('fetchUrl')(url, options);
  try {
    const res = await fetch(url, { method: 'POST', body: options.body, headers: options.headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
    return { url, status: res.status, body: Buffer.from(await res.arrayBuffer()) };
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

// Some models refuse settings others need (max_tokens vs max_completion_tokens, tools). When the service
// says so, rename or drop that setting and try again.
async function postAdapting(url, headers, body) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await postJson(url, headers, body);
    } catch (err) {
      const detail = String(err.detail || '').toLowerCase();
      if (attempt >= 3 || ![400, 404].includes(err.status)) throw err;
      // OpenRouter answers 404 "No endpoints found that support tool use" for models without tools.
      if (detail.includes('tool') && body.tools) { delete body.tools; continue; }
      if (err.status !== 400) throw err;
      if (detail.includes('max_tokens') && 'max_tokens' in body) { body.max_completion_tokens = body.max_tokens; delete body.max_tokens; }
      else if (detail.includes('max_completion_tokens') && 'max_completion_tokens' in body) { body.max_tokens = body.max_completion_tokens; delete body.max_completion_tokens; }
      else throw err;
    }
  }
}

const isAnthropic = (endpoint) => /(^|\.)anthropic\.com/i.test(new URL(endpoint).hostname) || /\/anthropic\//.test(endpoint);

// One reply from the model, as { text, calls: [{ id, name, args }] }; `state` carries the provider's own
// message list between rounds.
async function openaiRound(ai, state, tools) {
  const body = { model: ai.model, messages: state.messages };
  body[/api\.openai\.com/.test(ai.endpoint) ? 'max_completion_tokens' : 'max_tokens'] = MAX_TOKENS;
  if (tools.length) body.tools = tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.schema } }));
  const data = await postAdapting(`${ai.endpoint}/chat/completions`, ai.key ? { Authorization: `Bearer ${ai.key}` } : {}, body);
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

async function anthropicRound(ai, state, tools) {
  const body = { model: ai.model, max_tokens: MAX_TOKENS, system: state.system, messages: state.messages };
  if (tools.length) body.tools = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.schema }));
  const data = await postAdapting(`${ai.endpoint}/messages`, { ...(ai.key ? { 'x-api-key': ai.key } : {}), 'anthropic-version': '2023-06-01' }, body);
  const content = Array.isArray(data.content) ? data.content : [];
  state.messages.push({ role: 'assistant', content });
  return {
    text: content.filter((b) => b.type === 'text').map((b) => b.text).join(''),
    calls: content.filter((b) => b.type === 'tool_use').map((b) => ({ id: b.id, name: b.name, args: b.input || {} })),
  };
}

const busy = new Map(); // botId → answers being written

// Runs a whole turn: the model may call tools (their blocks run) until it gives an answer.
//   ai         { endpoint, key, model } from the "use AI" block
//   channel    where it's talking; message: the message it's answering (serialized), if any
//   prompt     a single question instead of the channel's history ("ask the AI")
//   instructions  from "add AI instructions" blocks
//   runTool    (script, params) → Promise<string>, from the block runner
// Resolves the answer text. Throws AiError with a readable message.
async function converse(bot, { ai, channel = null, message = null, prompt = null, instructions = '', runTool }) {
  if (!ai?.endpoint || !ai?.model) throw new AiError('Put a “use AI at … key … model …” block before this one.');
  let endpoint;
  try { endpoint = new URL(ai.endpoint.trim()).href.replace(/\/+$/, ''); } catch { throw new AiError('The AI endpoint is not a web address.'); }
  ai = { ...ai, endpoint };
  if ((busy.get(bot.id) || 0) >= MAX_BUSY) throw new AiError('The bot is already busy answering. Try again in a moment.');
  busy.set(bot.id, (busy.get(bot.id) || 0) + 1);
  try {
    const tools = toolsOf(JSON.parse(bot.program || '[]'));
    const system = systemPrompt(bot, channel, instructions);
    const turns = tidyTurns(prompt != null ? [{ role: 'user', content: prompt }] : historyFor(bot, channel, message));
    const anthropic = isAnthropic(endpoint);
    const state = anthropic ? { system, messages: turns } : { messages: [{ role: 'system', content: system }, ...turns] };
    let toolRuns = 0;
    let text = '';
    for (let round = 0; round < MAX_ROUNDS; round++) {
      if (!allowCall(bot.id)) throw new AiError('The bot has asked its AI too often this minute. Try again shortly.');
      const reply = anthropic ? await anthropicRound(ai, state, tools) : await openaiRound(ai, state, tools);
      text = reply.text || text;
      if (!reply.calls.length) break;
      const results = [];
      for (const call of reply.calls) {
        const tool = tools.find((t) => t.name === call.name);
        let output;
        if (!tool) output = `There is no tool called "${call.name}".`;
        else if (++toolRuns > MAX_TOOL_CALLS) output = 'Too many tool calls for one answer; answer with what you have.';
        else {
          try { output = await runTool(tool.script, call.args || {}); } catch (err) { output = `The tool failed: ${err.message}`; }
        }
        results.push({ id: call.id, output: String(output || 'Done.').slice(0, 8000) });
      }
      if (anthropic) state.messages.push({ role: 'user', content: results.map((r) => ({ type: 'tool_result', tool_use_id: r.id, content: r.output })) });
      else for (const r of results) state.messages.push({ role: 'tool', tool_call_id: r.id, content: r.output });
    }
    return text.trim().slice(0, MAX_REPLY);
  } finally {
    busy.set(bot.id, busy.get(bot.id) - 1);
  }
}

// Is this message talking to the bot? (@mentions it, replies to it, or is in a DM with it.)
function talksTo(bot, channel, message) {
  if (message.author.id === bot.user_id) return false;
  if (channel.type === 'dm') return channels.dmMemberIds(channel.id).includes(bot.user_id);
  if (channel.server_id !== bot.server_id) return false;
  const me = users.get(bot.user_id);
  if (new RegExp(`(?<![\\w@])@${me.username.replace(/[.]/g, '\\.')}(?![a-z0-9_.])`, 'i').test(message.content)) return true;
  return message.replyTo?.author?.id === bot.user_id;
}

// What the person said, without the @mention of the bot.
function promptOf(bot, message) {
  const me = users.get(bot.user_id);
  return String(message?.content || '').replace(new RegExp(`@${me.username.replace(/[.]/g, '\\.')}\\b`, 'gi'), '').trim();
}

module.exports = { converse, talksTo, promptOf, toolsOf, parseParams, AiError };
