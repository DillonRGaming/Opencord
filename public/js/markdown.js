// Message markdown, close to Discord's. Everything is built as DOM nodes; user text only ever lands in
// text nodes, so nothing a user types can become HTML.
//
// Blocks:  # / ## / ### headers, -# subtext, > quotes, >>> quote-the-rest, - / * / 1. lists (nested by
//          indent), ``` fenced code ``` with highlighting.
// Inline:  **bold** *italic* _italic_ __underline__ ~~strike~~ ||spoiler|| `code` [masked](links)
//          <https://no-embed> https://auto.links \escapes @user @everyone #channel :emoji: <:custom:id>
//          <t:unix:style> timestamps.
import { h } from './dom.js';
import { state } from './store.js';
import { highlight } from './highlight.js';
import { emojiByName } from './emojiData.js';

// --- who and what the text can refer to ---

// True when the text mentions me: @<my username>, @everyone or @here.
export function mentionsMe(text) {
  const me = state.me?.username.replaceAll('.', '\\.');
  if (new RegExp(`(?<![\\w@])@(${me}|everyone|here)(?![a-z0-9_.])`, 'i').test(text)) return true;
  // A role I have.
  for (const [, id] of text.matchAll(/<@&([\w-]{6,40})>/g)) {
    const found = findRole(id);
    if (found && myRoleIds(found.server.id).includes(id)) return true;
  }
  return false;
}

function userByName(name) {
  const lower = name.toLowerCase();
  for (const user of state.users?.values?.() || []) if (user.username === lower) return user;
  return null;
}

function channelByName(name) {
  const server = state.servers.get(state.route?.serverId);
  return server?.channels.find((c) => c.name === name.toLowerCase()) || null;
}

// The open server's emoji win; otherwise any server you're in.
function customEmoji(name) {
  const here = state.servers.get(state.route?.serverId);
  const found = here?.emojis?.find((e) => e.name === name);
  if (found) return found;
  for (const server of state.servers.values()) {
    const match = server.emojis?.find((e) => e.name === name);
    if (match) return match;
  }
  return null;
}

// --- blocks ---

const FENCE = /^```([a-z0-9+#.-]*)\s*$/i;

export function renderMarkdown(text) {
  const fragment = document.createDocumentFragment();
  renderBlocks(fragment, text.split('\n'));
  return fragment;
}

function renderBlocks(parent, lines) {
  let paragraph = [];
  const flush = () => {
    if (!paragraph.length) return;
    const p = h('div', { class: 'md-p' });
    appendInline(p, paragraph.join('\n'));
    parent.append(p);
    paragraph = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Fenced code: ```lang … ``` (also ```code``` on one line).
    const oneLine = /^```(.+?)```\s*$/.exec(line);
    if (oneLine) { flush(); parent.append(codeBlock('', oneLine[1])); continue; }
    const fence = FENCE.exec(line) || /^```(.*)$/.exec(line);
    if (fence) {
      const body = [];
      let j = i + 1;
      // A bare ```text (no language word) keeps the text as the first code line.
      const lang = FENCE.test(line) ? fence[1] : '';
      if (!FENCE.test(line) && fence[1]) body.push(fence[1]);
      while (j < lines.length && !/^\s*```\s*$/.test(lines[j]) && !/```\s*$/.test(lines[j])) body.push(lines[j++]);
      if (j < lines.length) {
        const end = lines[j].replace(/```\s*$/, '');
        if (end.trim()) body.push(end);
        flush();
        parent.append(codeBlock(lang, body.join('\n')));
        i = j;
        continue;
      }
    }

    // >>> quotes everything after it.
    const quoteRest = /^>>> ?(.*)$/.exec(line);
    if (quoteRest) {
      flush();
      const quote = h('blockquote', { class: 'md-quote' });
      renderBlocks(quote, [quoteRest[1], ...lines.slice(i + 1)]);
      parent.append(quote);
      return;
    }

    // > quote, consecutive lines join.
    if (/^> ?/.test(line)) {
      flush();
      const quoted = [];
      while (i < lines.length && /^> ?/.test(lines[i])) quoted.push(lines[i++].replace(/^> ?/, ''));
      i--;
      const quote = h('blockquote', { class: 'md-quote' });
      renderBlocks(quote, quoted);
      parent.append(quote);
      continue;
    }

    const header = /^(#{1,3}) (.+)$/.exec(line);
    if (header) {
      flush();
      const el = h(`h${header[1].length + 2}`, { class: `md-h md-h${header[1].length}` });
      appendInline(el, header[2]);
      parent.append(el);
      continue;
    }

    const subtext = /^-# (.+)$/.exec(line);
    if (subtext) {
      flush();
      const el = h('div', { class: 'md-subtext' });
      appendInline(el, subtext[1]);
      parent.append(el);
      continue;
    }

    if (/^\s*([-*]|\d{1,9}\.) /.test(line)) {
      flush();
      const items = [];
      while (i < lines.length && /^\s*([-*]|\d{1,9}\.) /.test(lines[i])) items.push(lines[i++]);
      i--;
      parent.append(...list(items));
      continue;
    }

    paragraph.push(line);
  }
  flush();
}

// Lists nest by indentation (2+ spaces deeper than the item above). Switching between - and 1. starts a new list.
function list(lines) {
  const indent = (line) => /^\s*/.exec(line)[0].length;
  const isOrdered = (line) => /^\s*\d/.test(line);
  const build = (start, end, base) => {
    const lists = [];
    let el = null;
    for (let i = start; i < end;) {
      let j = i + 1;
      while (j < end && indent(lines[j]) > base) j++;
      if (!el || isOrdered(lines[i]) !== (el.tagName === 'OL')) {
        el = h(isOrdered(lines[i]) ? 'ol' : 'ul', { class: 'md-list' });
        if (isOrdered(lines[i])) el.start = Number.parseInt(lines[i].trim(), 10);
        lists.push(el);
      }
      const li = h('li');
      appendInline(li, lines[i].replace(/^\s*([-*]|\d{1,9}\.) /, ''));
      if (j > i + 1) li.append(...build(i + 1, j, indent(lines[i + 1])));
      el.append(li);
      i = j;
    }
    return lists;
  };
  return build(0, lines.length, indent(lines[0]));
}

// A code block: highlighted, with line numbers once it's more than a couple of lines, and a copy button.
function codeBlock(lang, code) {
  const lines = code.replace(/\n$/, '').split('\n');
  const pre = h('pre', { class: `md-code${lines.length > 2 ? ' numbered' : ''}` });
  const gutter = lines.length > 2 && h('span', { class: 'md-code-lines', 'aria-hidden': 'true' }, lines.map((_, i) => `${i + 1}\n`).join(''));
  const copy = h('button', {
    type: 'button', class: 'md-code-copy', title: 'Copy code', 'aria-label': 'Copy code',
    onclick: async (event) => {
      event.stopPropagation();
      try {
        await navigator.clipboard.writeText(code);
        copy.textContent = 'Copied';
      } catch {
        copy.textContent = 'Couldn’t copy';
      }
      setTimeout(() => { copy.textContent = 'Copy'; }, 1500);
    },
  }, 'Copy');
  pre.append(h('div', { class: 'md-code-head' }, h('span', { class: 'md-code-lang' }, lang || 'code'), copy),
    h('div', { class: 'md-code-body' }, gutter || '', h('code', {}, highlight(code, lang))));
  return pre;
}

// --- inline ---

// Order matters: earlier alternatives win at the same position.
const INLINE = new RegExp([
  /\\([\\*_~|`>#\-[\]():<@])/.source, // 1 escaped char
  /(`+)([^`]|[^`][\s\S]*?[^`])\2(?!`)/.source, // 2,3 code
  /<t:(-?\d{1,13})(?::([tTdDfFR]))?>/.source, // 4,5 timestamp
  /<a?:([a-z0-9_]{2,32}):([\w-]{6,40})>/.source, // 6,7 custom emoji
  /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/.source, // 8,9 masked link
  /<(https?:\/\/[^\s>]+)>/.source, // 10 link without embed
  /(https?:\/\/[^\s<>]+)/.source, // 11 link
  /\*\*\*([\s\S]+?)\*\*\*/.source, // 12 bold italic
  /\*\*([\s\S]+?)\*\*/.source, // 13 bold
  /__([\s\S]+?)__/.source, // 14 underline
  /~~([\s\S]+?)~~/.source, // 15 strike
  /\|\|([\s\S]+?)\|\|/.source, // 16 spoiler
  /\*(?!\s)([\s\S]+?)(?<!\s)\*/.source, // 17 italic
  /(?<![\w])_(?!\s)([\s\S]+?)(?<!\s)_(?![\w])/.source, // 18 italic
  /(?<![\w@])@(everyone|here|[a-z0-9_.]{2,32})/.source, // 19 mention
  /(?<![\w&#])#([a-z0-9_-]{1,100})/.source, // 20 channel
  /(?<![\w:]):([a-z0-9_]{2,32}):/.source, // 21 :emoji:
  /<@&([\w-]{6,40})>/.source, // 22 role mention
].join('|'), 'gi');

export function appendInline(parent, text) {
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    parent.append(text.slice(last, m.index));
    last = m.index + m[0].length;
    const node = inlineNode(m);
    if (node == null) parent.append(m[0]);
    else parent.append(...[node].flat());
  }
  parent.append(text.slice(last));
}

function wrap(tag, text, props = {}) {
  const el = h(tag, props);
  appendInline(el, text);
  return el;
}

function inlineNode(m) {
  if (m[1] !== undefined) return m[1];
  if (m[3] !== undefined) return h('code', { class: 'md-inline-code' }, m[3].replace(/^ (.*) $/, '$1'));
  if (m[4] !== undefined) return timestamp(Number(m[4]), m[5] || 'f');
  if (m[6] !== undefined) return h('img', { class: 'md-emoji', src: `/media/emojis/${m[7]}`, alt: `:${m[6]}:`, title: `:${m[6]}:`, draggable: false });
  if (m[8] !== undefined) return h('a', { href: m[9], target: '_blank', rel: 'noopener noreferrer', title: m[9] }, m[8]);
  if (m[10] !== undefined) return h('a', { href: m[10], target: '_blank', rel: 'noopener noreferrer' }, m[10]);
  if (m[11] !== undefined) return link(m[11]);
  if (m[12] !== undefined) return h('strong', {}, wrap('em', m[12]));
  if (m[13] !== undefined) return wrap('strong', m[13]);
  if (m[14] !== undefined) return wrap('u', m[14]);
  if (m[15] !== undefined) return wrap('s', m[15]);
  if (m[16] !== undefined) return spoiler(m[16]);
  if (m[17] !== undefined) return wrap('em', m[17]);
  if (m[18] !== undefined) return wrap('em', m[18]);
  if (m[19] !== undefined) return mention(m[19], m[0]);
  if (m[20] !== undefined) return channelMention(m[20], m[0]);
  if (m[21] !== undefined) return emoji(m[21], m[0]);
  if (m[22] !== undefined) return roleMention(m[22]);
  return null;
}

function mention(name, whole) {
  const lower = name.toLowerCase();
  if (lower === 'everyone' || lower === 'here') return h('span', { class: 'mention everyone' }, whole);
  const user = userByName(lower);
  if (!user) return null;
  const me = user.id === state.me?.id;
  return h('button', {
    type: 'button', class: `mention${me ? ' me' : ''}`, dataset: { userId: user.id }, title: `@${user.username}`,
  }, `@${user.displayName}`);
}

// <@&roleId>: the role's name in its colour. Lit up when I have the role.
function findRole(id) {
  for (const server of state.servers.values()) {
    const role = server.roles?.find((r) => r.id === id);
    if (role) return { role, server };
  }
  return null;
}

function myRoleIds(serverId) {
  return state.members.get(serverId)?.find((m) => m.user.id === state.me?.id)?.roleIds || [];
}

function roleMention(id) {
  const found = findRole(id);
  if (!found) return h('span', { class: 'mention' }, '@deleted-role');
  const { role, server } = found;
  const mine = myRoleIds(server.id).includes(role.id);
  return h('span', { class: `mention role${mine ? ' me' : ''}`, style: role.color ? { '--role': role.color } : null }, `@${role.name}`);
}

function channelMention(name, whole) {
  const channel = channelByName(name);
  if (!channel) return null;
  return h('a', { class: 'mention channel', href: `/channels/${channel.serverId}/${channel.id}`, dataset: { route: '' } }, `# ${channel.name}`);
}

function emoji(name, whole) {
  const custom = customEmoji(name);
  if (custom) return h('img', { class: 'md-emoji', src: custom.url, alt: whole, title: whole, draggable: false });
  return emojiByName(name);
}

function spoiler(text) {
  const el = h('button', {
    type: 'button', class: 'spoiler', title: 'Spoiler: click to show',
    onclick: (event) => { event.stopPropagation(); el.classList.add('shown'); },
  });
  appendInline(el, text);
  return el;
}

// Punctuation right after a link belongs to the sentence, not the link.
function link(url) {
  const trailing = /[.,!?;:)\]'"]+$/.exec(url)?.[0] || '';
  const href = url.slice(0, url.length - trailing.length);
  const card = messageLinkCard(href);
  if (card) return [card, trailing];
  return [h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, href), trailing];
}

// A link to a message here (…/channels/<server>/<channel>?m=<id>) shows as a small quote of it.
const linkedMessages = new Map(); // id → Promise<message | null>
function messageLinkCard(href) {
  let url;
  try { url = new URL(href); } catch { return null; }
  // /channels/<server>/<channel> or, for a post, /channels/<server>/<channel>/<post>: the chat is the last part.
  const m = /^\/channels\/[^/]+\/[^/]+(?:\/([^/]+))?$/.exec(url.pathname);
  const id = url.searchParams.get('m');
  if (url.origin !== location.origin || !m || !id) return null;
  const channelId = url.pathname.split('/').pop();
  const card = h('button', {
    type: 'button', class: 'message-link-card',
    onclick: async () => {
      const { navigate } = await import('./router.js');
      const { jumpToMessage } = await import('./views/chat.js');
      navigate(url.pathname);
      jumpToMessage(channelId, id);
    },
  }, h('span', { class: 'message-link-loading' }, 'Linked message…'));
  if (!linkedMessages.has(id)) linkedMessages.set(id, fetch(`/api/messages/${encodeURIComponent(id)}`).then((r) => (r.ok ? r.json() : null)).catch(() => null));
  linkedMessages.get(id).then((msg) => {
    if (!msg) {
      card.replaceChildren(h('span', { class: 'message-link-loading' }, 'A message you can’t see, or that was deleted'));
      return;
    }
    const plain = msg.content.replace(/\s+/g, ' ').slice(0, 220);
    card.replaceChildren(
      h('span', { class: 'message-link-head' },
        msg.author.avatar ? h('img', { class: 'message-link-avatar', src: msg.author.avatar, alt: '' }) : null,
        h('strong', {}, msg.author.displayName),
        h('span', {}, msg.channelName ? `in #${msg.channelName}` : 'in a DM')),
      h('span', { class: 'message-link-text' }, plain || (msg.attachments.length ? `📎 ${msg.attachments.map((a) => a.name).join(', ')}` : '…')));
  });
  return card;
}

const STAMP_FORMATS = {
  t: { hour: 'numeric', minute: '2-digit' },
  T: { hour: 'numeric', minute: '2-digit', second: '2-digit' },
  d: { day: '2-digit', month: '2-digit', year: 'numeric' },
  D: { day: 'numeric', month: 'long', year: 'numeric' },
  f: { day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit' },
  F: { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit' },
};

function relative(ms) {
  const diff = (ms - Date.now()) / 1000;
  const units = [['year', 31536000], ['month', 2592000], ['day', 86400], ['hour', 3600], ['minute', 60], ['second', 1]];
  const [unit, size] = units.find(([, s]) => Math.abs(diff) >= s) || units.at(-1);
  return new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(Math.round(diff / size), unit);
}

function timestamp(seconds, style) {
  const ms = seconds * 1000;
  if (!Number.isFinite(ms) || Math.abs(ms) > 8.64e15) return null;
  const text = style === 'R' ? relative(ms) : new Intl.DateTimeFormat(undefined, STAMP_FORMATS[style]).format(ms);
  return h('time', { class: 'md-time', dateTime: new Date(ms).toISOString(), title: new Date(ms).toLocaleString(), dataset: style === 'R' ? { relative: String(ms) } : null }, text);
}

// "in 5 minutes" / "2 hours ago" times count along on their own.
setInterval(() => {
  for (const el of document.querySelectorAll('.md-time[data-relative]')) el.textContent = relative(Number(el.dataset.relative));
}, 30_000);

// --- making timestamps ---


// Reads "now", "in 2h", "in 30 minutes", "tomorrow 8pm", "20:30", "2026-11-20 19:00". Returns ms or null.
export function parseWhen(text) {
  const t = text.trim().toLowerCase();
  if (!t || t === 'now') return Date.now();
  const rel = /^in\s+(\d+(?:\.\d+)?)\s*(s|sec|seconds?|m|mins?|minutes?|h|hrs?|hours?|d|days?|w|weeks?)$/.exec(t);
  if (rel) {
    const unit = { s: 1, m: 60, h: 3600, d: 86400, w: 604800 }[rel[2][0]];
    return Date.now() + Number(rel[1]) * unit * 1000;
  }
  const clock = /^(today|tomorrow)?\s*(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/.exec(t);
  if (clock && (clock[1] || clock[3] || clock[4])) {
    let hour = Number(clock[2]) % (clock[4] ? 12 : 24);
    if (clock[4] === 'pm') hour += 12;
    const d = new Date();
    d.setHours(hour, Number(clock[3] || 0), 0, 0);
    if (clock[1] === 'tomorrow' || (!clock[1] && d.getTime() < Date.now())) d.setDate(d.getDate() + 1);
    return d.getTime();
  }
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ t](\d{1,2}):(\d{2}))?$/.exec(t);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]), Number(iso[4] || 0), Number(iso[5] || 0)).getTime();
  return null;
}

export const stampCode = (ms, style = 'F') => `<t:${Math.floor(ms / 1000)}:${style}>`;
