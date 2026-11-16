// The AI drawer in the bot builder: where the bot's model lives (endpoint, key, model, instructions, when it
// answers) and a test chat that shows every tool the AI used. The key is write-only: the server only says
// whether one is saved.
import * as api from '../api.js';
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { attempt, button, switchControl, toast } from '../ui.js';
import { renderMarkdown } from '../markdown.js';

// Ready-made endpoints. Everything except Anthropic speaks the OpenAI chat-completions format.
const PRESETS = [
  { id: 'openai', label: 'OpenAI', provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1-mini' },
  { id: 'anthropic', label: 'Anthropic (Claude)', provider: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', model: 'claude-sonnet-5-5' },
  { id: 'openrouter', label: 'OpenRouter', provider: 'openai', baseUrl: 'https://openrouter.ai/api/v1', model: 'openrouter/auto' },
  { id: 'gemini', label: 'Google Gemini', provider: 'openai', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.5-flash' },
  { id: 'groq', label: 'Groq', provider: 'openai', baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile' },
  { id: 'mistral', label: 'Mistral', provider: 'openai', baseUrl: 'https://api.mistral.ai/v1', model: 'mistral-small-latest' },
  { id: 'deepseek', label: 'DeepSeek', provider: 'openai', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { id: 'xai', label: 'xAI (Grok)', provider: 'openai', baseUrl: 'https://api.x.ai/v1', model: 'grok-3-mini' },
  { id: 'together', label: 'Together', provider: 'openai', baseUrl: 'https://api.together.xyz/v1', model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo' },
  { id: 'custom', label: 'Custom endpoint', provider: 'openai', baseUrl: '', model: '' },
];

const presetFor = (s) => PRESETS.find((p) => p.id !== 'custom' && p.baseUrl === s.baseUrl && p.provider === s.provider) || PRESETS.at(-1);

function row(label, control, hint) {
  return h('label', { class: 'bb-ai-field' }, h('span', { class: 'bb-ai-label' }, label), control, hint && h('span', { class: 'bb-ai-hint' }, hint));
}

function check(label, on, onChange) {
  const input = h('input', { type: 'checkbox', checked: on, onchange: () => onChange(input.checked) });
  return h('label', { class: 'bb-ai-check' }, input, h('span', {}, label));
}

export function aiPanel({ server, bot, program, saveFirst }) {
  let s = { ...bot.ai };
  let apiKey = ''; // typed, not yet saved
  let open = false;
  let tab = 'settings';
  const chat = []; // { role, content, trace?, error? }
  let chatChannel = '';
  let models = [];

  const textChannels = server.channels.filter((c) => c.kind === 'text').sort((a, b) => a.position - b.position);

  const el = h('aside', { class: 'bb-ai', hidden: true });
  const dot = h('span', { class: 'bb-ai-dot' });
  const aiButton = h('button', {
    type: 'button', class: 'bb-admin-toggle bb-ai-button', title: 'The bot’s AI: model, key, instructions, test chat',
    onclick: () => toggle(),
  }, icon('sparkles', 16), 'AI', dot);
  const markButton = () => {
    dot.classList.toggle('on', Boolean(s.enabled && s.model));
    aiButton.setAttribute('aria-pressed', String(open));
  };

  function toggle(force = !open) {
    open = force;
    el.hidden = !open;
    markButton();
    if (open) draw();
  }

  // --- settings ---
  const tools = () => program().filter((sc) => sc.trigger?.type === 'tool');
  const talkScripts = () => program().filter((sc) => sc.trigger?.type === 'ai_message').length;

  async function saveSettings(extra = {}) {
    const body = { ...s, ...extra };
    delete body.hasKey;
    if (apiKey.trim()) body.apiKey = apiKey.trim();
    const updated = await api.put(`/api/servers/${server.id}/bots/${bot.id}/ai`, body);
    bot.ai = updated.ai;
    s = { ...updated.ai };
    apiKey = '';
    markButton();
  }

  function settingsView() {
    const set = (key) => (value) => { s[key] = value; };
    const input = (key, props = {}) => h('input', {
      class: 'input', value: s[key] ?? '', ...props,
      oninput: (e) => { s[key] = props.type === 'number' ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value; },
    });

    const baseUrl = input('baseUrl', { placeholder: 'https://api.example.com/v1', spellcheck: false });
    const modelList = h('datalist', { id: `bb-ai-models-${bot.id}` }, models.map((m) => h('option', { value: m.id }, m.name && m.name !== m.id ? m.name : null)));
    const model = input('model', { placeholder: presetFor(s).model || 'model id', list: modelList.id, spellcheck: false });
    const preset = h('select', {
      class: 'input',
      onchange: () => {
        const p = PRESETS.find((x) => x.id === preset.value);
        s.provider = p.provider;
        if (p.id !== 'custom') s.baseUrl = p.baseUrl;
        if (p.model && !s.model) s.model = p.model;
        models = [];
        draw();
      },
    }, PRESETS.map((p) => h('option', { value: p.id, selected: p.id === presetFor(s).id }, p.label)));
    const format = h('select', { class: 'input', onchange: () => { s.provider = format.value; } },
      h('option', { value: 'openai', selected: s.provider !== 'anthropic' }, 'OpenAI-compatible (chat/completions)'),
      h('option', { value: 'anthropic', selected: s.provider === 'anthropic' }, 'Anthropic (messages)'));

    const key = h('input', {
      class: 'input', type: 'password', autocomplete: 'new-password', spellcheck: false, value: apiKey,
      placeholder: s.hasKey ? '•••••••• saved — type to replace' : 'paste your API key',
      oninput: () => { apiKey = key.value; },
    });
    const removeKey = s.hasKey && h('button', {
      type: 'button', class: 'link-button', onclick: () => attempt(async () => { await saveSettings({ apiKey: null }); draw(); toast('Key removed.', 'ok'); }),
    }, 'Remove saved key');

    const loadModels = button('Load models', () => attempt(async () => {
      await saveSettings();
      models = await api.get(`/api/servers/${server.id}/bots/${bot.id}/ai/models`);
      toast(models.length ? `${models.length} models found. Pick one from the model box.` : 'The endpoint listed no models; type the id instead.', 'ok');
      draw();
      el.querySelector('input[list]')?.focus();
    }), 'ghost small');

    const channelsBox = h('div', { class: 'bb-ai-channels' }, textChannels.map((c) => check(`#${c.name}`, s.channels.includes(c.id), (on) => {
      s.channels = on ? [...s.channels, c.id] : s.channels.filter((id) => id !== c.id);
    })));

    const toolList = tools();
    const saveButton = button('Save AI settings', () => attempt(async () => { await saveSettings(); draw(); toast('AI settings saved.', 'ok'); }), 'primary small');

    return h('div', { class: 'bb-ai-body' },
      h('div', { class: 'bb-ai-on' },
        h('div', {}, h('strong', {}, 'AI replies'), h('span', { class: 'bb-ai-hint' }, s.enabled ? 'On: the bot answers with its model.' : 'Off: the bot only runs its blocks.')),
        switchControl(Boolean(s.enabled), (on) => { s.enabled = on; }, 'AI replies')),

      h('h3', {}, 'Model'),
      row('Service', preset),
      row('Base endpoint', baseUrl, 'Any OpenAI-compatible URL ending before /chat/completions, or Anthropic’s.'),
      row('API format', format),
      row('API key', key, removeKey || 'Stored on the server only; never shown again.'),
      h('div', { class: 'bb-ai-pair' },
        row('Model id', h('div', { class: 'bb-ai-inline' }, model, modelList, loadModels)),
      ),
      row('Model name', input('modelName', { placeholder: 'shown as {ai.model}, e.g. “GPT” or “Claude”', maxLength: 60 })),

      h('h3', {}, 'Personality'),
      row('Instructions', h('textarea', { class: 'input bb-ai-system', rows: 6, value: s.system, oninput: (e) => { s.system = e.target.value; } }),
        'The system prompt. The bot is also told its name, the server, the channel and the time.'),
      h('div', { class: 'bb-ai-grid' },
        row('Temperature', input('temperature', { type: 'number', min: 0, max: 2, step: 0.1, placeholder: 'default' })),
        row('Max reply tokens', input('maxTokens', { type: 'number', min: 16, max: 32000, step: 1 })),
        row('Messages it reads', input('history', { type: 'number', min: 0, max: 50, step: 1 }))),

      h('h3', {}, 'When it answers'),
      talkScripts() > 0 && h('p', { class: 'bb-ai-note' }, `You have ${talkScripts()} “when someone talks to me” script${talkScripts() === 1 ? '' : 's'}: they run instead of the automatic answer, so use “answer them with AI” inside to reply.`),
      check('When someone @mentions it', s.mention, set('mention')),
      check('When someone replies to it', s.reply, set('reply')),
      check('In direct messages', s.dm, set('dm')),
      h('span', { class: 'bb-ai-label' }, 'Every message in these channels'),
      textChannels.length ? channelsBox : h('p', { class: 'bb-ai-hint' }, 'No text channels yet.'),

      h('h3', {}, 'Tools'),
      check('Long-term memory (built-in “remember” and “forget” tools)', s.memory, set('memory')),
      toolList.length
        ? h('ul', { class: 'bb-ai-tools' }, toolList.map((t) => h('li', {}, h('code', {}, t.trigger.name || 'tool'), ' ', t.trigger.description || '')))
        : h('p', { class: 'bb-ai-note' }, 'Give the AI tools with the “the AI can use the tool …” block in the AI category. The blocks under it run when the AI uses it; {param.name} holds what it passed, and “tell the AI” sends a result back.'),

      h('details', { class: 'bb-ai-advanced' }, h('summary', {}, 'Advanced'),
        row('Extra headers', h('textarea', { class: 'input', rows: 3, value: s.headers || '', placeholder: 'HTTP-Referer: https://example.com\nX-Title: My bot', oninput: (e) => { s.headers = e.target.value; } }),
          'One “Name: value” per line, sent with every request.')),

      h('div', { class: 'bb-ai-actions' }, saveButton));
  }

  // --- test chat ---
  function traceView(trace) {
    return h('div', { class: 'bb-ai-trace' }, trace.map((t) => h('details', { class: 'bb-ai-call' },
      h('summary', {}, icon('settings', 13), h('code', {}, t.tool), ' ', h('span', { class: 'bb-ai-args' }, JSON.stringify(t.args))),
      h('pre', {}, t.output))));
  }

  function chatView() {
    const log = h('div', { class: 'bb-ai-log' }, chat.length ? chat.map((m) => h('div', { class: `bb-ai-msg ${m.role}${m.error ? ' error' : ''}` },
      m.trace?.length ? traceView(m.trace) : null,
      m.content && h('div', { class: 'bb-ai-bubble markdown' }, m.role === 'assistant' && !m.error ? renderMarkdown(m.content) : m.content)))
      : h('p', { class: 'bb-ai-empty' }, 'Talk to your bot here. Nothing is posted, but tools really run (in the channel picked below).'));
    const box = h('textarea', {
      class: 'input bb-ai-input', rows: 2, placeholder: `Message ${bot.user.displayName}…`,
      onkeydown: (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } },
    });
    const sendButton = h('button', { type: 'button', class: 'button primary small', onclick: () => send() }, icon('send', 16));
    const where = h('select', { class: 'input bb-ai-where', onchange: () => { chatChannel = where.value; } },
      h('option', { value: '' }, 'No channel (tools can’t post)'),
      textChannels.map((c) => h('option', { value: c.id, selected: c.id === chatChannel }, `Tools act in #${c.name}`)));

    async function send() {
      const content = box.value.trim();
      if (!content || box.disabled) return;
      box.value = '';
      chat.push({ role: 'user', content });
      const thinking = { role: 'assistant', content: 'Thinking…', pending: true };
      chat.push(thinking);
      draw();
      try {
        await saveFirst();
        const turns = chat.filter((m) => !m.pending && !m.error && m.content).map((m) => ({ role: m.role, content: m.content }));
        const res = await api.post(`/api/servers/${server.id}/bots/${bot.id}/ai/chat`, { messages: turns, channelId: chatChannel || null });
        Object.assign(thinking, { content: res.reply || '(no answer)', trace: res.trace, pending: false });
      } catch (err) {
        Object.assign(thinking, { content: err.message, error: true, pending: false });
      }
      draw();
      el.querySelector('.bb-ai-input')?.focus();
    }

    queueMicrotask(() => { log.scrollTop = log.scrollHeight; });
    const busy = chat.some((m) => m.pending);
    box.disabled = busy;
    return h('div', { class: 'bb-ai-chat' }, log,
      h('div', { class: 'bb-ai-compose' }, box, sendButton),
      h('div', { class: 'bb-ai-chatbar' }, where, chat.length > 0 && h('button', { type: 'button', class: 'link-button', onclick: () => { chat.length = 0; draw(); } }, 'Clear')));
  }

  function draw() {
    if (!open) return;
    const tabs = h('div', { class: 'bb-ai-tabs', role: 'tablist' },
      [['settings', 'Settings'], ['chat', 'Test chat']].map(([id, label]) => h('button', {
        type: 'button', role: 'tab', 'aria-selected': String(tab === id), onclick: () => { tab = id; draw(); },
      }, label)));
    el.replaceChildren(
      h('header', { class: 'bb-ai-head' }, icon('sparkles', 18), h('strong', {}, 'AI'), tabs,
        h('button', { type: 'button', class: 'icon-button', title: 'Close', onclick: () => toggle(false) }, icon('x', 18))),
      tab === 'settings' ? settingsView() : chatView());
  }

  markButton();
  return { el, button: aiButton, toggle };
}
