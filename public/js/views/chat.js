import * as api from '../api.js';
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { state, on, emit, isUnread, isOwner, markRead } from '../store.js';
import { attempt, avatar, copyText, iconButton, toast } from '../ui.js';
import { createComposer } from './composer.js';
import { messageCard, messageRow } from './message.js';
import { membersShown, openPanel, toggleMembers } from './side.js';
import { openProfile } from './profile.js';

const PAGE = 50;
const TYPING_MS = 8000;

// The chat that is open right now (only ever one).
let view = null;

const isMine = (message) => message.author.id === state.me.id;
const nameOf = (userId) => state.users.get(userId)?.displayName || 'Someone';

function header(channel, serverId) {
  const back = iconButton('back', 'Back', () => { document.body.dataset.panel = 'nav'; }, 'back-button');
  const tools = [
    searchBox(channel),
    iconButton('pin', 'Pinned messages', () => showPins(channel)),
    serverId && membersButton(),
  ];
  if (channel.type === 'dm') {
    const { recipient } = channel;
    return h('header', { class: 'main-header' }, back,
      h('button', { type: 'button', class: 'main-title', onclick: () => openProfile(recipient) },
        avatar(recipient, { size: 28, presence: true }), h('span', {}, recipient.displayName)),
      h('div', { class: 'main-spacer' }), tools);
  }
  return h('header', { class: 'main-header' }, back,
    h('div', { class: 'main-title' }, icon('hash', 18), h('span', {}, channel.name)),
    channel.topic ? h('div', { class: 'main-topic', title: channel.topic }, channel.topic) : h('div', { class: 'main-spacer' }),
    tools);
}

function searchBox(channel) {
  const input = h('input', {
    type: 'search', placeholder: 'Search', 'aria-label': `Search ${channel.type === 'dm' ? 'this conversation' : `#${channel.name}`}`,
    onkeydown: (event) => {
      if (event.key === 'Enter' && input.value.trim()) showSearch(channel, input.value.trim());
    },
  });
  return h('label', { class: 'header-search' }, icon('search', 16), input);
}

// Pinned messages and search results open in the side panel as compact cards with a Jump button.
let pinsFor = null;

function resultsPanel(title, load, onClose) {
  const list = h('div', { class: 'card-list' }, h('p', { class: 'loading' }, 'Loading…'));
  load().then((messages) => {
    list.replaceChildren(...messages.map((m) => messageCard(m, jumpTo)));
    if (!messages.length) list.replaceChildren(h('p', { class: 'loading' }, 'Nothing found.'));
  }, (err) => list.replaceChildren(h('p', { class: 'loading' }, err.message)));
  return openPanel({ title, build: () => list, onClose });
}

function showPins(channel) {
  pinsFor = channel.id;
  resultsPanel('Pinned messages', () => api.get(`/api/channels/${channel.id}/pins`), () => { pinsFor = null; });
}

function showSearch(channel, query) {
  resultsPanel(`“${query}”`, () => api.get(`/api/channels/${channel.id}/search?q=${encodeURIComponent(query)}`));
}

// Scroll to a message if it's loaded and flash it.
function jumpTo(id) {
  const row = view && findRow(view, id);
  if (!row) return toast('That message is further back. Scroll up to load it.');
  row.scrollIntoView({ block: 'center', behavior: 'smooth' });
  const message = row.querySelector('.message');
  message.classList.remove('flash');
  requestAnimationFrame(() => message.classList.add('flash'));
  return undefined;
}

function membersButton() {
  const el = iconButton('users', 'Members', () => {
    toggleMembers();
    el.setAttribute('aria-pressed', String(membersShown()));
  });
  el.setAttribute('aria-pressed', String(membersShown()));
  return el;
}

function historyStart(channel) {
  if (channel.type === 'dm') {
    const { recipient } = channel;
    return h('div', { class: 'history-start' }, avatar(recipient, { size: 64 }),
      h('h2', {}, recipient.displayName), h('p', {}, `@${recipient.username}`));
  }
  return h('div', { class: 'history-start' }, h('span', { class: 'history-hash' }, icon('hash', 30)),
    h('h2', {}, channel.name), channel.topic && h('p', {}, channel.topic));
}

function rowFor(v, index) {
  const message = v.messages[index];
  return messageRow(message, v.messages[index - 1], isMine(message), {
    canDelete: v.serverId && isOwner(v.serverId),
    onEdit: startEdit,
    onDelete: deleteMessage,
    onProfile: (user) => openProfile(user, { serverId: v.serverId }),
    onReply: (m) => v.composer.replyTo(m),
    onReact: react,
    onPin: (m) => attempt(() => (m.pinned ? api.del : api.put)(`/api/messages/${m.id}/pin`)),
    onCopy: async (m) => { await copyText(m.content); toast('Copied.', 'ok'); },
    onJump: jumpTo,
  });
}

function findRow(v, id) {
  return [...v.list.children].find((row) => row.dataset.id === id);
}

function redrawRow(v, index) {
  if (index < 0 || index >= v.messages.length) return;
  findRow(v, v.messages[index].id)?.replaceWith(rowFor(v, index));
}

function drawAll(v) {
  v.list.replaceChildren(...v.messages.map((_, index) => rowFor(v, index)));
  drawTop(v);
}

function drawTop(v) {
  v.top.replaceChildren(v.hasMore ? h('div', { class: 'history-loading' }, 'Loading older messages…') : historyStart(v.channel));
}

function scrollToBottom(v) {
  v.scroller.scrollTop = v.scroller.scrollHeight;
  v.stick = true;
}

// Mark the channel read, but only if the person can actually see it.
function ack(v) {
  const { channel } = v;
  if (document.hidden || !v.root.offsetParent || !isUnread(channel)) return;
  const messageId = channel.lastMessageId;
  markRead(channel.id, messageId);
  emit('unread');
  api.post(`/api/channels/${channel.id}/ack`, { messageId }).catch(() => {});
}

async function loadLatest(v) {
  v.loading = true;
  try {
    const messages = await api.get(`/api/channels/${v.channel.id}/messages?limit=${PAGE}`);
    if (view !== v) return;
    // Anything that arrived over the socket while the request was in flight goes on the end.
    const known = new Set(messages.map((m) => m.id));
    v.messages = [...messages, ...v.early.filter((m) => !known.has(m.id))];
    v.early = [];
    v.hasMore = messages.length === PAGE;
    v.ready = true;
    drawAll(v);
    scrollToBottom(v);
    ack(v);
    setTimeout(() => fillScreen(v));
  } catch (err) {
    if (view === v) toast(err.message);
  } finally {
    v.loading = false;
  }
}

async function loadOlder(v) {
  if (v.loading || !v.hasMore || !v.ready) return;
  v.loading = true;
  try {
    const older = await api.get(`/api/channels/${v.channel.id}/messages?limit=${PAGE}&before=${v.messages[0].id}`);
    if (view !== v) return;
    v.hasMore = older.length === PAGE;
    if (older.length) {
      const heightBefore = v.scroller.scrollHeight;
      v.messages = [...older, ...v.messages];
      v.list.prepend(...older.map((_, index) => rowFor(v, index)));
      redrawRow(v, older.length);
      v.scroller.scrollTop += v.scroller.scrollHeight - heightBefore;
    }
    drawTop(v);
    setTimeout(() => fillScreen(v));
  } catch (err) {
    if (view === v) toast(err.message);
  } finally {
    v.loading = false;
  }
}

// A tall window can show a whole page without a scrollbar; keep loading until it scrolls.
function fillScreen(v) {
  if (view === v && v.scroller.scrollTop < 300) loadOlder(v);
}

function startEdit(message, row) {
  const main = row.querySelector('.message-main');
  if (main.querySelector('.message-edit')) return;
  const cancel = () => redrawRow(view, view.messages.findIndex((m) => m.id === message.id));
  const save = async () => {
    const content = textarea.value.trim();
    if (content === message.content) return cancel();
    return attempt(() => api.patch(`/api/messages/${message.id}`, { content }));
  };
  const textarea = h('textarea', {
    class: 'textarea', value: message.content, rows: Math.min(12, message.content.split('\n').length + 1),
    onkeydown: (event) => {
      if (event.key === 'Escape') { event.stopPropagation(); cancel(); }
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); save(); }
    },
  });
  const editor = h('div', { class: 'message-edit' }, textarea, h('small', {}, 'Enter to save · Escape to cancel'));
  const content = main.querySelector('.message-content');
  main.querySelector('.show-more')?.remove();
  if (content) content.replaceWith(editor);
  else main.prepend(editor);
  textarea.focus();
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);
}

function react(message, emoji, add) {
  const url = `/api/messages/${message.id}/reactions/${encodeURIComponent(emoji)}`;
  attempt(() => (add ? api.put(url) : api.del(url)));
}

// Up arrow in an empty message box edits your last message.
function editLast(v) {
  const index = v.messages.findLastIndex(isMine);
  if (index === -1) return;
  const row = findRow(v, v.messages[index].id);
  row.scrollIntoView({ block: 'nearest' });
  startEdit(v.messages[index], row);
}

function deleteMessage(message) {
  return api.del(`/api/messages/${message.id}`);
}

function drawTyping(v) {
  const names = [...v.typing.keys()].map(nameOf);
  if (!names.length) return v.typingEl.replaceChildren();
  if (names.length > 3) return v.typingEl.replaceChildren('Several people are typing…');
  const parts = names.flatMap((name, index) => [index > 0 && (index === names.length - 1 ? ' and ' : ', '), h('strong', {}, name)]);
  return v.typingEl.replaceChildren(...parts.filter(Boolean), names.length === 1 ? ' is typing…' : ' are typing…');
}

function stopTyping(v, userId) {
  clearTimeout(v.typing.get(userId));
  if (v.typing.delete(userId)) drawTyping(v);
}

// --- live events ---

on('message:create', (message) => {
  const v = view;
  if (!v || message.channelId !== v.channel.id) return;
  if (!v.ready) {
    v.early.push(message);
    return;
  }
  if (v.messages.some((m) => m.id === message.id)) return;
  stopTyping(v, message.author.id);
  v.messages.push(message);
  v.list.append(rowFor(v, v.messages.length - 1));
  if (v.stick || isMine(message)) scrollToBottom(v);
  ack(v);
});

on('message:update', (message) => {
  const index = view?.messages.findIndex((m) => m.id === message.id) ?? -1;
  if (index === -1) return;
  view.messages[index] = message;
  redrawRow(view, index);
  if (pinsFor === message.channelId) showPins(view.channel);
});

on('message:delete', ({ id }) => {
  const index = view?.messages.findIndex((m) => m.id === id) ?? -1;
  if (index === -1) return;
  findRow(view, id)?.remove();
  view.messages.splice(index, 1);
  redrawRow(view, index);
});

on('typing', ({ channelId, userId }) => {
  const v = view;
  if (!v || channelId !== v.channel.id) return;
  clearTimeout(v.typing.get(userId));
  v.typing.set(userId, setTimeout(() => stopTyping(v, userId), TYPING_MS));
  drawTyping(v);
});

// Someone changed their name or avatar: update the messages they wrote.
on('users', (user) => {
  if (!view || !user) return;
  view.messages.forEach((message, index) => {
    if (message.author.id !== user.id) return;
    message.author = state.users.get(user.id);
    redrawRow(view, index);
  });
});

on('reload', () => {
  if (!view?.root.isConnected) return;
  view.ready = false;
  loadLatest(view);
});

document.addEventListener('visibilitychange', () => { if (view?.root.isConnected) ack(view); });

export function closeChat() {
  view?.composer.destroy();
  view?.resizeWatcher.disconnect();
  view = null;
}

export function showChat(container, channel, serverId = null) {
  if (view?.channel.id === channel.id && view.root.isConnected) {
    // Same chat (for example a phone coming back from the channel list): keep it, refresh the header.
    view.channel = channel;
    view.root.querySelector('.main-header').replaceWith(header(channel, serverId));
    ack(view);
    return;
  }
  closeChat();

  const placeholder = channel.type === 'dm' ? `Message @${channel.recipient.displayName}` : `Message #${channel.name}`;
  const v = {
    channel, serverId, root: container,
    messages: [], early: [], hasMore: true, ready: false, loading: false, stick: true, height: 0,
    typing: new Map(),
    top: h('div'),
    list: h('div', { class: 'message-list' }),
    typingEl: h('div', { class: 'typing', role: 'status' }),
  };
  v.composer = createComposer(channel, placeholder, { onEditLast: () => editLast(v) });
  v.scroller = h('div', {
    class: 'scroller',
    onscroll: () => {
      // Only a real scroll changes "stick": when the content just grew, the watcher below handles it.
      if (v.scroller.scrollHeight === v.height) v.stick = v.height - v.scroller.scrollTop - v.scroller.clientHeight < 80;
      if (v.scroller.scrollTop < 300) loadOlder(v);
    },
  }, v.top, v.list);
  // Images and videos change height once they load; stay at the bottom if we were there.
  v.resizeWatcher = new ResizeObserver(() => {
    v.height = v.scroller.scrollHeight;
    if (v.stick) v.scroller.scrollTop = v.height;
  });
  v.resizeWatcher.observe(v.top);
  v.resizeWatcher.observe(v.list);

  let dragDepth = 0;
  const chat = h('section', {
    class: 'chat',
    ondragenter: (event) => {
      if (!event.dataTransfer.types.includes('Files')) return;
      dragDepth += 1;
      chat.classList.add('dragging');
    },
    ondragover: (event) => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); },
    ondragleave: () => {
      dragDepth = Math.max(0, dragDepth - 1);
      if (!dragDepth) chat.classList.remove('dragging');
    },
    ondrop: (event) => {
      if (!event.dataTransfer.files.length) return;
      event.preventDefault();
      dragDepth = 0;
      chat.classList.remove('dragging');
      v.composer.addFiles([...event.dataTransfer.files]);
    },
  }, v.scroller, v.typingEl, v.composer.el);

  container.replaceChildren(header(channel, serverId), chat);

  view = v;
  drawTop(v);
  loadLatest(v);
  if (matchMedia('(min-width: 800px)').matches) v.composer.focus();
}
