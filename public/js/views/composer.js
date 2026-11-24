import * as api from '../api.js';
import { h } from '../dom.js';
import { formatSize } from '../format.js';
import { sendTyping, sendTypingText } from '../realtime.js';
import { startUpload } from '../upload.js';
import { icon } from '../icons.js';
import { avatar, iconButton, pickFiles, toast } from '../ui.js';
import { state, dmPeople, canModerate, can, setting } from '../store.js';
import { openPoll } from './poll.js';
import { openEmojiPicker, customEmojis, customCode } from '../emojiPicker.js';
import { searchEmoji } from '../emojiData.js';
import { availableCommands, runCommand } from '../commands.js';
import { openGifPicker, openKitchen } from '../fun.js';
import { recordVoice } from '../voiceMessage.js';

const TYPING_EVERY_MS = 3000;
const SUGGEST_MAX = 8;

// What can follow @, # or : in this channel.
function suggestions(channel, trigger, query) {
  const q = query.toLowerCase();
  if (trigger === '@') {
    const people = channel.serverId
      ? (state.members.get(channel.serverId) || []).map((m) => m.user)
      : [state.me, ...dmPeople(channel)];
    const specials = channel.serverId && can(channel.serverId, 'mentionEveryone') ? [{ special: 'everyone', label: '@everyone', sub: 'Notify everyone in this server' }, { special: 'here', label: '@here', sub: 'Notify everyone' }] : [];
    // Roles: the mentionable ones, or all of them for admins. Inserted as <@&id>, shown as @Name.
    const server = channel.serverId && state.servers.get(channel.serverId);
    const roles = (server?.roles || []).filter((r) => (r.mentionable || canModerate(server.id)) && r.name.toLowerCase().includes(q));
    return [
      ...people.filter((u) => u.username.startsWith(q) || u.displayName.toLowerCase().includes(q))
        .map((u) => ({ insert: `@${u.username} `, face: avatar(u, { size: 24 }), label: u.displayName, sub: `@${u.username}` })),
      ...roles.map((r) => ({ insert: `<@&${r.id}> `, face: h('span', { class: 'role-dot', style: { background: r.color || 'var(--text-faint)' } }), label: `@${r.name}`, sub: 'Role' })),
      ...specials.filter((s) => s.special.startsWith(q)).map((s) => ({ insert: `@${s.special} `, face: '@', label: s.label, sub: s.sub })),
    ].slice(0, SUGGEST_MAX);
  }
  if (trigger === '#') {
    const server = state.servers.get(channel.serverId);
    return (server?.channels || []).filter((c) => c.kind === 'text' && c.name.includes(q))
      .map((c) => ({ insert: `#${c.name} `, face: '#', label: c.name })).slice(0, SUGGEST_MAX);
  }
  if (q.length < 2) return [];
  const custom = customEmojis().filter((e) => e.name.includes(q))
    .map((e) => ({ insert: `${customCode(e)} `, face: h('img', { class: 'emoji-img', src: e.url, alt: '' }), label: `:${e.name}:`, sub: e.serverName }));
  const standard = searchEmoji(q, SUGGEST_MAX).map((e) => ({ insert: `${e.char} `, face: e.char, label: `:${e.name}:` }));
  return [...custom, ...standard].slice(0, SUGGEST_MAX);
}

export const MESSAGE_MAX = 1000;

function autoGrow(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = `${textarea.scrollHeight}px`;
  // A counter shows up near the limit.
  const counter = textarea.closest('.composer')?.querySelector('.char-count');
  if (counter) {
    const left = MESSAGE_MAX - textarea.value.length;
    counter.textContent = left <= 200 ? String(left) : '';
    counter.classList.toggle('low', left <= 50);
  }
  // The send button lights up once there is something to send.
  textarea.closest('.composer')?.classList.toggle('ready', Boolean(textarea.value.trim()) || textarea.closest('.composer').querySelector('.upload') !== null);
}

// Unsent text survives switching channels and reloading: one draft per channel (and per thread).
const draftKey = (channelId, threadId) => `oc:draft:${channelId}${threadId ? `:${threadId}` : ''}`;
function readDraft(key) {
  try { return localStorage.getItem(key) || ''; } catch { return ''; }
}
function writeDraft(key, value) {
  try {
    if (value.trim()) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch { /* storage off: drafts just don't stick */ }
}

// The message box. Files start uploading as soon as they are added; sending waits for them to finish.
// options.onEditLast: called on Up arrow in an empty box. options.threadId: the box posts into that thread.
export function createComposer(channel, placeholder, { onEditLast, threadId = null } = {}) {
  const draft = draftKey(channel.id, threadId);
  let draftTimer = null;
  let uploads = [];
  let replying = null; // the message being answered
  let queue = Promise.resolve();
  let lastTyping = 0;
  // Opt-in live draft: the text goes out at most every 300ms, with the latest text always sent last.
  let draftShareTimer = null;
  let lastDraftShare = 0;
  let sharedText = '';
  const flushDraft = () => {
    draftShareTimer = null;
    const text = textarea.value.trim();
    if (text === sharedText) return;
    sharedText = text;
    lastDraftShare = Date.now();
    sendTypingText(channel.id, text);
  };
  const shareDraft = () => {
    if (draftShareTimer) return;
    draftShareTimer = setTimeout(flushDraft, Math.max(0, 300 - (Date.now() - lastDraftShare)));
  };

  const tray = h('div', { class: 'uploads' });
  const suggestBox = h('div', { class: 'suggest', role: 'listbox' });
  let suggest = { items: [], index: 0, start: 0 };

  function closeSuggest() {
    suggest = { items: [], index: 0, start: 0 };
    suggestBox.replaceChildren();
  }

  function drawSuggest() {
    suggestBox.replaceChildren(...suggest.items.map((item, i) => h('button', {
      type: 'button', class: `suggest-item${i === suggest.index ? ' active' : ''}`, role: 'option',
      onmousedown: (event) => { event.preventDefault(); suggest.index = i; acceptSuggest(); },
    }, item.face && h('span', { class: 'suggest-face' }, item.face), h('span', { class: 'suggest-label' }, item.label),
    item.tag && h('span', { class: 'suggest-tag' }, item.tag), item.sub && h('span', { class: 'suggest-sub' }, item.sub))));
    suggestBox.classList.toggle('hint', suggest.items.length === 1 && Boolean(suggest.items[0].hint));
    suggestBox.children[suggest.index]?.scrollIntoView({ block: 'nearest' });
  }

  function updateSuggest() {
    const before = textarea.value.slice(0, textarea.selectionStart);
    // "/" at the very start: the commands, then a usage hint once one is picked.
    const slash = /^\/(\w*)$/.exec(before);
    if (slash) {
      const q = slash[1].toLowerCase();
      const builtIn = availableCommands(channel);
      // The server's bot commands are in the list too (sent as a message, which sets the bot off).
      const botCommands = (state.servers.get(channel.serverId)?.commands || []).filter((c) => !builtIn.some((b) => b.name === c.name));
      const items = [
        ...builtIn.filter((c) => c.name.startsWith(q)).map((c) => ({
          insert: `/${c.name} `, label: `/${c.name}`, sub: c.about, tag: c.mod ? 'Admin' : null,
        })),
        ...botCommands.filter((c) => c.name.startsWith(q)).map((c) => ({
          insert: `/${c.name} `, label: `/${c.name}`, sub: c.description || `A command from ${c.bot}`, tag: c.bot,
        })),
      ];
      if (!items.length) return closeSuggest();
      suggest = { items, index: Math.min(suggest.index, items.length - 1), start: 0 };
      return drawSuggest();
    }
    const typed = /^\/(\w+)\s/.exec(textarea.value);
    const command = typed && availableCommands(channel).find((c) => c.name === typed[1].toLowerCase());
    const hint = command && command.usage && !/[@#:][\w.-]*$/.test(before)
      ? [{ hint: true, label: `/${command.name} ${command.usage}`, sub: command.about }] : null;
    const match = /(^|[\s(])([@#:])([\w.-]{0,32})$/.exec(before);
    if (!match) {
      if (!hint) return closeSuggest();
      suggest = { items: hint, index: 0, start: 0 };
      return drawSuggest();
    }
    const items = suggestions(channel, match[2], match[3]);
    if (!items.length) return closeSuggest();
    suggest = { items, index: Math.min(suggest.index, items.length - 1), start: before.length - match[2].length - match[3].length };
    drawSuggest();
  }

  function acceptSuggest() {
    const item = suggest.items[suggest.index];
    if (!item || item.hint) return;
    const end = textarea.selectionStart;
    insertText(item.insert, suggest.start, end);
    closeSuggest();
    updateSuggest();
  }

  function insertText(text, start = textarea.selectionStart, end = textarea.selectionEnd) {
    textarea.setRangeText(text, start, end, 'end');
    autoGrow(textarea);
    textarea.focus();
  }
  const textarea = h('textarea', {
    rows: 1, placeholder, 'aria-label': placeholder, maxLength: MESSAGE_MAX,
    oninput: () => {
      autoGrow(textarea);
      updateSuggest();
      clearTimeout(draftTimer);
      draftTimer = setTimeout(() => writeDraft(draft, textarea.value), 300);
      if (setting('sendTyping', true) !== false && setting('sendTypingText', false) === true) {
        shareDraft();
      } else if (textarea.value && Date.now() - lastTyping > TYPING_EVERY_MS) {
        lastTyping = Date.now();
        if (setting('sendTyping', true) !== false) sendTyping(channel.id);
      }
    },
    onblur: () => setTimeout(closeSuggest, 150),
    onkeydown: (event) => {
      if (suggest.items.length && !suggest.items[0].hint) {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          suggest.index = (suggest.index + (event.key === 'ArrowDown' ? 1 : -1) + suggest.items.length) % suggest.items.length;
          return drawSuggest();
        }
        if ((event.key === 'Enter' || event.key === 'Tab') && !event.shiftKey) {
          event.preventDefault();
          return acceptSuggest();
        }
        if (event.key === 'Escape') {
          event.stopPropagation();
          return closeSuggest();
        }
      }
      if (event.key === 'ArrowUp' && !textarea.value && onEditLast) {
        event.preventDefault();
        onEditLast();
      }
      if (event.key === 'Escape' && replying) {
        event.stopPropagation();
        replyTo(null);
      }
      // Enter sends (Shift+Enter is a new line), or, with "Send with Ctrl+Enter" on, Enter is a new line.
      const ctrlSends = setting('sendKey', 'enter') === 'ctrlEnter';
      const sends = ctrlSends ? (event.ctrlKey || event.metaKey) : !event.shiftKey;
      if (event.key === 'Enter' && sends && !event.isComposing) {
        event.preventDefault();
        send();
      }
    },
    onpaste: (event) => {
      const files = [...event.clipboardData.files];
      if (!files.length) return;
      event.preventDefault();
      addFiles(files);
    },
  });
  const replyBar = h('div', { class: 'reply-bar' });
  const emojiButton = iconButton('smile', 'Emoji', () => openEmojiPicker(emojiButton, (value) => insertText(`${value} `), { keepOpen: true }));

  // Pressing send never takes the focus from the box, so a phone keyboard stays up.
  const sendButton = iconButton('send', 'Send', () => send(), 'send');
  sendButton.addEventListener('pointerdown', (event) => event.preventDefault());
  sendButton.addEventListener('mousedown', (event) => event.preventDefault());
  // Feedback about the chat (a command's result, an error) shows here, inside the box, not as a pop-up.
  const notice = h('div', { class: 'composer-notice', role: 'status' });
  let noticeTimer = null;
  function clearNotice() {
    clearTimeout(noticeTimer);
    notice.replaceChildren();
    notice.className = 'composer-notice';
  }
  // GIFs and Emoji Kitchen stickers are sent straight away as a link (the link shows as the picture).
  const sendLink = (url) => {
    if (locked) return;
    queue = queue.then(() => deliver(url, [], replying?.id || null));
    replyTo(null);
  };
  const gifButton = iconButton('gif', 'GIFs', () => openGifPicker(gifButton, sendLink));
  const kitchenButton = iconButton('sparkles', 'Emoji Kitchen', () => openKitchen(kitchenButton, sendLink));
  const micButton = iconButton('mic', 'Record a voice message', () => {
    if (locked) return;
    recordVoice(el, (file) => {
      addFiles([file]);
      send();
    });
  }, 'mic-button');
  const el = h('div', { class: 'composer' }, suggestBox, notice, replyBar, tray,
    h('div', { class: 'composer-row' },
      iconButton('plus', 'Attach files', async () => addFiles(await pickFiles({ multiple: true }))),
      textarea,
      h('div', { class: 'composer-tools' }, gifButton, kitchenButton, emojiButton),
      h('span', { class: 'char-count', 'aria-live': 'polite' }),
      micButton,
      sendButton));
  textarea.value = readDraft(draft);
  if (textarea.value) requestAnimationFrame(() => autoGrow(textarea));

  el.addEventListener('notice', (event) => {
    const { message, kind } = event.detail;
    clearNotice();
    notice.className = `composer-notice ${kind}`;
    notice.append(h('span', {}, message), iconButton('x', 'Dismiss', clearNotice));
    noticeTimer = setTimeout(clearNotice, kind === 'error' ? 8000 : 4000);
  });

  // Locked (timed out, or a read-only channel): the box stays where it is, greyed out, and says why.
  let locked = null;
  function setLocked(reason) {
    if (reason === locked) return;
    const wasLocked = locked !== null;
    locked = reason;
    el.classList.toggle('locked', Boolean(reason));
    textarea.disabled = Boolean(reason);
    textarea.placeholder = reason || placeholder;
    textarea.setAttribute('aria-label', reason || placeholder);
    for (const button of el.querySelectorAll('.composer-row .icon-button')) button.disabled = Boolean(reason);
    if (reason) closeSuggest();
    if (wasLocked && !reason) textarea.placeholder = placeholder;
  }

  function replyTo(message) {
    replying = message;
    replyBar.replaceChildren(...(message ? [
      icon('reply', 15),
      h('span', {}, 'Replying to ', h('strong', {}, message.author.displayName)),
      h('span', { class: 'reply-bar-text' }, message.content),
      iconButton('x', 'Cancel reply', () => replyTo(null)),
    ] : []));
    if (message && !locked) textarea.focus();
  }

  function addFiles(files) {
    if (locked) return;
    for (const file of files) {
      const status = h('span', { class: 'upload-status' }, `0% of ${formatSize(file.size)}`);
      const bar = h('span');
      const upload = { attachment: null, failed: false, removed: false };
      upload.el = h('div', { class: 'upload' },
        h('span', { class: 'upload-name', title: file.name }, file.name),
        h('div', { class: 'upload-bar' }, bar), status,
        iconButton('x', 'Remove', () => removeUpload(upload)));
      upload.handle = startUpload(file, (fraction) => {
        bar.style.width = `${fraction * 100}%`;
        status.textContent = `${Math.floor(fraction * 100)}% of ${formatSize(file.size)}`;
      });
      upload.done = upload.handle.promise.then((attachment) => {
        upload.attachment = attachment;
        upload.el.classList.add('done');
        bar.style.width = '100%';
        status.textContent = formatSize(file.size);
      }, (err) => {
        upload.failed = true;
        upload.el.classList.add('failed');
        status.textContent = err.message;
      });
      uploads.push(upload);
      tray.append(upload.el);
    }
    autoGrow(textarea);
    textarea.focus();
  }

  function removeUpload(upload) {
    upload.removed = true;
    if (!upload.attachment) upload.handle.cancel();
    upload.el.remove();
    uploads = uploads.filter((other) => other !== upload);
    autoGrow(textarea);
  }

  // Sends go out one after another, so typing the next message never waits on the last one.
  async function send() {
    let content = textarea.value.trim();
    const batch = uploads;
    if (locked || (!content && !batch.length)) return;
    closeSuggest();
    clearNotice();
    if (content.startsWith('/') && !batch.length) {
      try {
        const result = await runCommand(channel, content, { openPoll: () => openPoll(channel) });
        if (result?.done) {
          writeDraft(draft, '');
          textarea.value = '';
          autoGrow(textarea);
          closeSuggest();
          return;
        }
        if (result?.send) content = result.send;
      } catch (err) {
        toast(err.message);
        return;
      }
    }
    const replyToId = replying?.id || null;
    replyTo(null);
    clearTimeout(draftTimer);
    writeDraft(draft, '');
    textarea.value = '';
    autoGrow(textarea);
    uploads = [];
    lastTyping = 0;
    if (sharedText) { clearTimeout(draftShareTimer); draftShareTimer = null; sharedText = ''; sendTypingText(channel.id, ''); }
    queue = queue.then(() => deliver(content, batch, replyToId));
  }

  async function deliver(content, batch, replyToId) {
    try {
      await Promise.all(batch.map((upload) => upload.done));
      const files = batch.filter((upload) => !upload.removed);
      if (files.some((upload) => upload.failed)) throw new Error("A file didn't upload. Remove it or add it again, then send.");
      if (!content && !files.length) return;
      await api.post(`/api/channels/${channel.id}/messages`, {
        content, replyToId, threadId, attachmentIds: files.map((upload) => upload.attachment.id),
      });
      for (const upload of files) upload.el.remove();
      autoGrow(textarea);
    } catch (err) {
      // Put everything back so nothing typed or uploaded is lost.
      toast(err.message);
      if (!textarea.value && !/^https:\/\/(media\.tenor\.com|www\.gstatic\.com)\//.test(content)) textarea.value = content;
      autoGrow(textarea);
      uploads = [...batch.filter((upload) => !upload.removed), ...uploads];
    }
  }

  // Leaving the channel: stop anything still uploading.
  function destroy() {
    clearTimeout(draftTimer);
    if (!locked) writeDraft(draft, textarea.value);
    for (const upload of uploads) if (!upload.attachment) upload.handle.cancel();
  }

  return { el, addFiles, destroy, replyTo, setLocked, focus: () => { if (!locked) textarea.focus(); } };
}
