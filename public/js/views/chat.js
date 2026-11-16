import * as api from '../api.js';
import { h } from '../dom.js';
import { showNav, navigate, paths } from '../router.js';
import { icon } from '../icons.js';
import { groupFace } from './sidebar.js';
import { voice, joinVoice } from '../voice.js';
import { ensureMembers } from './members.js';
import { state, on, emit, isUnread, canModerate, can, canPostIn, markRead, dmName, roleColor } from '../store.js';
import { attempt, avatar, confirmButton, copyText, iconButton, toast } from '../ui.js';
import { createComposer } from './composer.js';
import { messageCard, messageRow, fullContent } from './message.js';
import { membersShown, openPanel, toggleMembers, dismissPanel } from './side.js';
import { openProfile } from './profile.js';

const PAGE = 50;
const TYPING_MS = 8000;

// The chat that is open right now (only ever one).
let view = null;

const isMine = (message) => message.author.id === state.me.id;
const nameOf = (userId) => state.users.get(userId)?.displayName || 'Someone';

function header(channel, serverId) {
  const back = iconButton('back', 'Back', () => showNav(), 'back-button');
  const inThisCall = voice.channelId === channel.id;
  const tools = [
    // DM calls open as their own page.
    channel.type === 'dm' && iconButton('phone', inThisCall ? 'Back to the call' : (state.voice.get(channel.id) || []).length ? 'Join call' : 'Start a call', () => {
      if (!inThisCall) joinVoice(channel);
      navigate(paths.dmCall(channel.id));
    }, inThisCall ? 'in-call' : ''),
    searchBox(channel),
    iconButton('pin', 'Pinned messages', () => showPins(channel)),
    serverId && membersButton(),
  ];
  if (channel.kind === 'group') {
    return h('header', { class: 'main-header' }, back,
      h('button', { type: 'button', class: 'main-title', onclick: async () => (await import('./groups.js')).openGroupSettings(channel) },
        groupFace(channel, 28), h('span', {}, dmName(channel))),
      h('div', { class: 'main-topic' }, `${channel.recipients.length + 1} members`), tools);
  }
  if (channel.type === 'dm') {
    const { recipient } = channel;
    return h('header', { class: 'main-header' }, back,
      h('button', { type: 'button', class: 'main-title', onclick: () => openProfile(recipient) },
        avatar(recipient, { size: 28, presence: true }), h('span', {}, recipient.displayName)),
      h('div', { class: 'main-spacer' }), tools);
  }
  if (channel.kind === 'post') {
    // A post: the arrow goes back to the list of posts.
    const parent = state.servers.get(serverId)?.channels.find((c) => c.id === channel.parentId);
    return h('header', { class: 'main-header' },
      iconButton('back', 'Back to posts', () => navigate(paths.channel(serverId, channel.parentId)), 'post-back'),
      h('div', { class: 'main-title' }, h('span', {}, channel.title || channel.name)),
      h('div', { class: 'main-topic' }, parent ? `in ${parent.name}` : ''),
      tools,
      canDeletePost(channel, serverId) && confirmButton({
        label: 'Delete post', confirmLabel: 'Delete?', face: icon('trash'), className: 'icon-button danger',
        onConfirm: () => api.del(`/api/channels/${channel.id}`),
      }));
  }
  return h('header', { class: 'main-header' }, back,
    h('div', { class: 'main-title' }, icon('hash', 18), h('span', {}, channel.name)),
    channel.topic ? h('div', { class: 'main-topic', title: channel.topic }, channel.topic) : h('div', { class: 'main-spacer' }),
    tools);
}

const canDeletePost = (post, serverId) => post.authorId === state.me.id || can(serverId, 'manageMessages');

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

// Scroll to a message and flash it, loading older pages until it's there.
async function jumpTo(id) {
  const v = view;
  if (!v) return;
  // On a phone the panel covers the chat: get it out of the way first.
  if (matchMedia('(max-width: 799px)').matches) dismissPanel();
  let row = findRow(v, id);
  for (let tries = 0; !row && tries < 200 && view === v; tries += 1) {
    if (!v.ready || v.loading) {
      await new Promise((resolve) => { setTimeout(resolve, 60); });
    } else if (v.hasMore && v.messages.length && id < v.messages[0].id) {
      await loadOlder(v);
    } else {
      break;
    }
    row = findRow(v, id);
  }
  if (!row) {
    toast("Couldn't find that message. It may have been deleted.");
    return;
  }
  v.stick = false;
  row.scrollIntoView({ block: 'center' });
  const message = row.querySelector('.message');
  message.classList.remove('flash');
  requestAnimationFrame(() => message.classList.add('flash'));
}

// Used by notifications: open happens elsewhere, this waits for that chat to show and jumps.
export async function jumpToMessage(channelId, id) {
  for (let tries = 0; tries < 100 && view?.channel.id !== channelId; tries += 1) {
    await new Promise((resolve) => { setTimeout(resolve, 50); });
  }
  if (view?.channel.id === channelId) jumpTo(id);
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
  if (channel.kind === 'group') {
    return h('div', { class: 'history-start' }, groupFace(channel, 64),
      h('h2', {}, dmName(channel)), h('p', {}, `The start of this group with ${channel.recipients.length + 1} members.`));
  }
  if (channel.type === 'dm') {
    const { recipient } = channel;
    return h('div', { class: 'history-start' }, avatar(recipient, { size: 64 }),
      h('h2', {}, recipient.displayName), h('p', {}, `@${recipient.username}`));
  }
  if (channel.kind === 'post') {
    const author = state.users.get(channel.authorId);
    return h('div', { class: 'history-start' }, h('span', { class: 'history-hash' }, icon('posts', 30)),
      h('h2', {}, channel.title || channel.name), h('p', {}, `Started by ${author?.displayName || 'someone'}`));
  }
  return h('div', { class: 'history-start' }, h('span', { class: 'history-hash' }, icon('hash', 30)),
    h('h2', {}, channel.name), channel.topic && h('p', {}, channel.topic));
}

// --- threads: replies to one message, in the side panel ---

let thread = null; // { channel, serverId, root, messages, list, composer, panel }

function threadHandlers(t) {
  return {
    canDelete: t.serverId && can(t.serverId, 'manageMessages'),
    serverId: t.serverId,
    onEdit: startEdit,
    onDelete: deleteMessage,
    onProfile: (user) => openProfile(user, { serverId: t.serverId }),
    onReply: (m) => t.composer.replyTo(m),
    onReact: react,
    onPin: (m) => attempt(() => (m.pinned ? api.del : api.put)(`/api/messages/${m.id}/pin`)),
    onVote: (m, option) => api.put(`/api/messages/${m.id}/poll/${option}`),
    onCopy: async (m) => { await copyText(await fullContent(m)); toast('Copied.', 'ok'); },
    onJump: (id) => { if (id === t.root.id) jumpTo(id); else t.list.querySelector(`[data-id="${id}"]`)?.scrollIntoView({ block: 'center' }); },
  };
}

function drawThread(t) {
  const rows = [messageRow({ ...t.root, thread: null }, null, isMine(t.root), threadHandlers(t)),
    h('div', { class: 'thread-divider' }, t.messages.length ? `${t.messages.length} ${t.messages.length === 1 ? 'reply' : 'replies'}` : 'No replies yet. Start the thread!'),
    ...t.messages.map((m, i) => messageRow(m, t.messages[i - 1] || null, isMine(m), threadHandlers(t)))];
  const atBottom = t.scroller.scrollHeight - t.scroller.scrollTop - t.scroller.clientHeight < 60;
  t.list.replaceChildren(...rows);
  if (atBottom || !t.drawn) t.scroller.scrollTop = t.scroller.scrollHeight;
  t.drawn = true;
}

export async function openThread(root, channel = view?.channel, serverId = view?.serverId) {
  if (!channel) return;
  thread?.composer.destroy();
  const t = { channel, serverId, root, messages: [], list: h('div', { class: 'message-list thread-list' }), drawn: false };
  t.scroller = h('div', { class: 'scroller thread-scroller' }, t.list);
  t.composer = createComposer(channel, 'Reply in thread', { threadId: root.id });
  const body = h('div', { class: 'thread-panel' }, t.scroller, t.composer.el);
  thread = t;
  openPanel({
    title: 'Thread', build: () => body,
    onClose: () => { if (thread === t) { t.composer.destroy(); thread = null; } },
  });
  t.list.replaceChildren(h('p', { class: 'loading' }, 'Loading…'));
  try {
    const data = await api.get(`/api/channels/${channel.id}/threads/${root.id}`);
    if (thread !== t) return;
    t.root = data.root;
    t.messages = data.messages;
    drawThread(t);
    t.composer.focus();
  } catch (err) {
    t.list.replaceChildren(h('p', { class: 'loading' }, err.message));
  }
}

function rowFor(v, index) {
  const message = v.messages[index];
  return messageRow(message, v.messages[index - 1], isMine(message), {
    onThread: v.channel.kind === 'post' ? null : (m) => openThread(m, v.channel, v.serverId),
    canDelete: v.serverId && can(v.serverId, 'manageMessages'),
    serverId: v.serverId,
    onEdit: startEdit,
    onDelete: deleteMessage,
    onProfile: (user) => openProfile(user, { serverId: v.serverId }),
    onReply: (m) => v.composer.replyTo(m),
    onReact: react,
    onPin: (m) => attempt(() => (m.pinned ? api.del : api.put)(`/api/messages/${m.id}/pin`)),
    onVote: (m, option) => api.put(`/api/messages/${m.id}/poll/${option}`),
    onCopy: async (m) => { await copyText(await fullContent(m)); toast('Copied.', 'ok'); },
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
  drawSeen(v);
}

// Read receipts (1:1 DMs, only when both people turned them on): a small tick under your last message once they've read it.
function drawSeen(v) {
  v.list.querySelector('.seen-mark')?.remove();
  const dm = state.dms.get(v.channel.id);
  const last = v.messages.at(-1);
  if (!dm?.seenId || dm.kind === 'group' || !last || !isMine(last) || dm.seenId < last.id) return;
  findRow(v, last.id)?.append(h('div', { class: 'seen-mark', title: 'Seen' }, icon('check', 12), 'Seen'));
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
  const behindLists = document.body.dataset.panel === 'nav' && matchMedia('(max-width: 799px)').matches;
  if (document.hidden || !v.root.offsetParent || behindLists || !isUnread(channel)) return;
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
  const main = row?.querySelector('.message-main');
  if (!main || main.querySelector('.message-edit')) return;
  const cancel = () => {
    const index = view?.messages.findIndex((m) => m.id === message.id) ?? -1;
    if (index !== -1) redrawRow(view, index);
    else if (thread) drawThread(thread);
  };
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

// The call button in a DM header changes between "start", "join" and gone (while you're in that call).
on('voice', () => {
  if (view?.channel.type !== 'dm' || !view.root.isConnected) return;
  view.root.querySelector('.main-header')?.replaceWith(header(view.channel, view.serverId));
});

// Turning auto-translate on (or changing the language) redraws the open chat.
const translateKey = () => `${state.me.settings?.translateAuto}|${state.me.settings?.translateTo}`;
on('me', () => {
  if (!view || view.translateKey === translateKey()) return;
  view.translateKey = translateKey();
  drawAll(view);
});

on('message:create', (message) => {
  if (message.threadId) {
    if (thread?.root.id === message.threadId && !thread.messages.some((m) => m.id === message.id)) {
      thread.messages.push(message);
      drawThread(thread);
    }
    return; // thread replies stay out of the main chat
  }
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
  drawSeen(v);
  if (v.stick || isMine(message)) scrollToBottom(v);
  ack(v);
});

on('dm:seen dms', () => {
  if (!view?.ready) return;
  const stick = view.stick;
  drawSeen(view);
  if (stick) scrollToBottom(view);
});

on('message:update', (message) => {
  if (thread) {
    if (thread.root.id === message.id) thread.root = message;
    const i = thread.messages.findIndex((m) => m.id === message.id);
    if (i !== -1) thread.messages[i] = message;
    if (thread.root.id === message.id || i !== -1) drawThread(thread);
  }
  const index = view?.messages.findIndex((m) => m.id === message.id) ?? -1;
  if (index === -1) return;
  view.messages[index] = message;
  redrawRow(view, index);
  drawSeen(view);
  if (pinsFor === message.channelId) showPins(view.channel);
});

on('message:delete', ({ id }) => {
  if (thread) {
    if (thread.root.id === id) dismissPanel();
    else if (thread.messages.some((m) => m.id === id)) {
      thread.messages = thread.messages.filter((m) => m.id !== id);
      drawThread(thread);
    }
  }
  const index = view?.messages.findIndex((m) => m.id === id) ?? -1;
  if (index === -1) return;
  findRow(view, id)?.remove();
  view.messages.splice(index, 1);
  redrawRow(view, index);
  drawSeen(view);
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
on('panel', () => { if (view?.root.isConnected) ack(view); });

// "1m 20s", "3h 5m", "2d 4h": how long a timeout has left.
function timeLeft(ms) {
  const s = Math.max(1, Math.ceil(ms / 1000));
  const parts = [[86400, 'd'], [3600, 'h'], [60, 'm'], [1, 's']].map(([size, unit]) => [Math.floor(s / size) % ({ d: Infinity, h: 24, m: 60, s: 60 }[unit]), unit]);
  const first = parts.findIndex(([n]) => n > 0);
  return parts.slice(first, first + 2).filter(([n]) => n > 0).map(([n, unit]) => `${n}${unit}`).join(' ');
}

// Timed out or a read-only channel: grey the message box out and say why in it. A timeout counts down.
function updateLock(v) {
  clearTimeout(v.lockTimer);
  const { channel, serverId } = v;
  const mod = serverId && canModerate(serverId);
  const me = serverId && state.members.get(serverId)?.find((m) => m.user.id === state.me.id);
  const left = me?.timeoutUntil ? me.timeoutUntil - Date.now() : 0;
  if (left > 0 && !mod) {
    v.composer.setLocked(`You are timed out for ${timeLeft(left)}`);
    v.lockTimer = setTimeout(() => { if (view === v) updateLock(v); }, left > 120000 ? 30000 : 1000);
  } else if (serverId && !canPostIn(serverId, channel.kind === 'post' ? state.servers.get(serverId)?.channels.find((c) => c.id === channel.parentId) || channel : channel) && channel.kind !== 'post') {
    v.composer.setLocked('You can’t post in this channel');
  } else {
    v.composer.setLocked(null);
  }
}

on('members servers', () => {
  if (!view?.root.isConnected) return;
  updateLock(view);
  // Roles changed: recolour names in place rather than redrawing every message.
  if (view.serverId) {
    for (const name of view.list.querySelectorAll('.author-name[data-user-id]')) name.style.color = roleColor(view.serverId, name.dataset.userId) || '';
  }
});

function stopDevLive() {
  if (view?.devTimer) {
    clearInterval(view.devTimer);
    view.devTimer = null;
  }
}

function startDevLive(v) {
  stopDevLive();
  if (v.serverId !== state.hqServerId || state.me?.appRole !== 'owner') return;
  const channelId = v.channel.id;
  v.devTimer = setInterval(() => {
    if (document.hidden) return;
    api.post('/api/admin/hq', { channelId }).catch(() => {});
  }, 5000);
}

export function closeChat() {
  stopDevLive();
  if (view) clearTimeout(view.lockTimer);
  view?.composer.destroy();
  view?.resizeWatcher.disconnect();
  view = null;
}

export function showChat(container, channel, serverId = null) {
  if (view?.channel.id === channel.id && view.root.isConnected) {
    // Same chat (for example a phone coming back from the channel list): keep it, refresh the header.
    view.channel = channel;
    view.root.querySelector('.main-header')?.replaceWith(header(channel, serverId));
    updateLock(view);
    ack(view);
    return;
  }
  closeChat();
  if (serverId) ensureMembers(serverId);

  const placeholder = channel.type === 'dm' ? `Message ${channel.kind === 'group' ? dmName(channel) : `@${channel.recipient.displayName}`}`
    : channel.kind === 'post' ? 'Reply to this post' : `Message #${channel.name}`;
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
  startDevLive(v);
  v.translateKey = translateKey();
  updateLock(v);
  drawTop(v);
  loadLatest(v);
  if (matchMedia('(min-width: 800px)').matches) v.composer.focus();
}
