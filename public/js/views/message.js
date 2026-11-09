import { h } from '../dom.js';
import { icon } from '../icons.js';
import { state } from '../store.js';
import { mentionsMe, renderMarkdown, formatDay, formatSize, formatStamp, formatTime, sameDay } from '../format.js';
import { avatar, confirmButton, iconButton } from '../ui.js';
import { openLightbox } from './lightbox.js';

const GROUP_MS = 7 * 60 * 1000;
const LONG_MESSAGE = 3000;

// One click away in the hover bar, then the full set in the reaction tray.
const QUICK = ['👍', '❤️', '😂'];
const EMOJI = ['👍', '👎', '❤️', '😂', '😮', '😢', '😡', '🔥', '🎉', '👀', '💯', '🙏', '👏', '😎', '🤔', '😅',
  '🥲', '🫡', '💀', '✅', '❌', '⭐', '🌮', '🍕', '🎮', '🏆', '💤', '🤝'];

function attachmentView(attachment) {
  const { kind, name, url, size } = attachment;
  if (kind === 'image') {
    return h('button', { type: 'button', class: 'attachment-image', title: name, onclick: () => openLightbox(attachment) },
      h('img', { src: url, alt: name, loading: 'lazy' }));
  }
  if (kind === 'video') return h('video', { class: 'attachment-video', src: url, controls: true, preload: 'metadata', playsInline: true });

  const info = h('div', { class: 'attachment-info' }, h('a', { href: url, download: name, title: name }, name), h('span', {}, formatSize(size)));
  if (kind === 'audio') {
    return h('div', { class: 'attachment-card audio' }, info, h('audio', { src: url, controls: true, preload: 'none' }));
  }
  return h('div', { class: 'attachment-card' }, h('span', { class: 'attachment-icon' }, icon('file', 22)), info,
    h('a', { class: 'icon-button', href: url, download: name, title: 'Download', 'aria-label': `Download ${name}` }, icon('download')));
}

function contentView(message) {
  if (!message.content) return null;
  const content = h('div', { class: 'message-content' }, renderMarkdown(message.content),
    message.editedAt && h('span', { class: 'message-edited', title: formatStamp(message.editedAt) }, '(edited)'));
  if (message.content.length <= LONG_MESSAGE) return content;

  content.classList.add('collapsed');
  const toggle = h('button', {
    type: 'button', class: 'show-more',
    onclick: () => { toggle.textContent = content.classList.toggle('collapsed') ? 'Show more' : 'Show less'; },
  }, 'Show more');
  return [content, toggle];
}

// The line above a reply: who it answers and the start of what they said. Click to jump there.
function replyView(replyTo, onJump) {
  if (replyTo.deleted) return h('div', { class: 'reply-ref deleted' }, icon('reply', 14), 'Original message was deleted');
  return h('button', { type: 'button', class: 'reply-ref', onclick: () => onJump(replyTo.id) },
    icon('reply', 14), avatar(replyTo.author, { size: 16 }),
    h('strong', {}, replyTo.author.displayName),
    h('span', { class: 'reply-text' }, replyTo.content || 'Sent a file'));
}

function nameList(userIds) {
  const names = userIds.map((id) => (id === state.me.id ? 'You' : state.users.get(id)?.displayName || 'Someone'));
  return names.length > 6 ? `${names.slice(0, 6).join(', ')} and ${names.length - 6} more` : names.join(', ');
}

function reactionsView(message, onReact, openTray) {
  if (!message.reactions.length) return null;
  return h('div', { class: 'reactions' },
    message.reactions.map(({ emoji, userIds }) => {
      const mine = userIds.includes(state.me.id);
      return h('button', {
        type: 'button', class: `reaction${mine ? ' mine' : ''}`, title: `${nameList(userIds)} reacted with ${emoji}`,
        'aria-pressed': String(mine), onclick: () => onReact(message, emoji, !mine),
      }, h('span', { class: 'reaction-emoji' }, emoji), h('span', { class: 'reaction-count' }, userIds.length));
    }),
    h('button', { type: 'button', class: 'reaction add', title: 'Add reaction', 'aria-label': 'Add reaction', onclick: openTray }, icon('smilePlus', 16)));
}

// A row of emoji that opens under the message (no floating picker). Any short text works too.
function reactionTray(message, onReact, close) {
  const custom = h('input', {
    class: 'input', maxLength: 32, placeholder: 'Or type any emoji or word', 'aria-label': 'Custom reaction',
    onkeydown: (event) => {
      if (event.key === 'Escape') { event.stopPropagation(); close(); }
      if (event.key === 'Enter' && custom.value.trim()) {
        event.preventDefault();
        onReact(message, custom.value.trim(), true);
        close();
      }
    },
  });
  const tray = h('div', { class: 'reaction-tray' },
    h('div', { class: 'reaction-grid' }, EMOJI.map((emoji) => h('button', {
      type: 'button', class: 'tray-emoji', 'aria-label': `React with ${emoji}`,
      onclick: () => { onReact(message, emoji, true); close(); },
    }, emoji))),
    h('div', { class: 'reaction-tray-row' }, custom, iconButton('x', 'Close', close)));
  setTimeout(() => custom.focus());
  return tray;
}

function toolbar(message, row, mine, handlers, openTray) {
  const has = (emoji) => message.reactions.some((r) => r.emoji === emoji && r.userIds.includes(state.me.id));
  return h('div', { class: 'message-actions' },
    QUICK.map((emoji) => h('button', {
      type: 'button', class: `quick-react${has(emoji) ? ' mine' : ''}`, title: `React with ${emoji}`, 'aria-label': `React with ${emoji}`,
      onclick: () => handlers.onReact(message, emoji, !has(emoji)),
    }, emoji)),
    h('span', { class: 'actions-divider' }),
    iconButton('smilePlus', 'Add reaction', openTray),
    iconButton('reply', 'Reply', () => handlers.onReply(message)),
    iconButton('pin', message.pinned ? 'Unpin' : 'Pin', () => handlers.onPin(message), message.pinned ? 'on' : ''),
    message.content && iconButton('copy', 'Copy text', () => handlers.onCopy(message)),
    mine && iconButton('pencil', 'Edit', () => handlers.onEdit(message, row)),
    (mine || handlers.canDelete) && confirmButton({
      label: 'Delete', confirmLabel: 'Delete', face: icon('trash'), className: 'icon-button danger',
      onConfirm: () => handlers.onDelete(message),
    }));
}

// One message. `previous` is the message above it (decides the day divider and whether the header repeats).
// handlers: { canDelete, onEdit, onDelete, onProfile, onReply, onReact, onPin, onCopy, onJump }
export function messageRow(message, previous, mine, handlers) {
  const newDay = !previous || !sameDay(previous.createdAt, message.createdAt);
  const grouped = !newDay && !message.replyTo && previous.author.id === message.author.id
    && message.createdAt - previous.createdAt < GROUP_MS;
  const { author } = message;
  const profile = () => handlers.onProfile(author);

  let tray = null;
  const reactionSlot = h('div', {}, reactionsView(message, handlers.onReact, () => openTray()));
  function closeTray() {
    tray?.remove();
    tray = null;
  }
  function openTray() {
    if (tray) return closeTray();
    tray = reactionTray(message, handlers.onReact, closeTray);
    reactionSlot.after(tray);
  }

  const classes = ['message', grouped && 'grouped', message.pinned && 'pinned', mentionsMe(message.content) && 'mentioned'];
  const body = h('div', {
    class: classes.filter(Boolean).join(' '),
    onclick: (event) => {
      if (!event.target.closest('button, a, video, audio, textarea, input')) event.currentTarget.classList.toggle('selected');
    },
  });
  const row = h('div', { class: 'message-row', dataset: { id: message.id } },
    newDay && h('div', { class: 'day-divider' }, formatDay(message.createdAt)), body);
  body.append(...[
    message.replyTo && replyView(message.replyTo, handlers.onJump),
    h('button', { type: 'button', class: 'message-avatar', onclick: profile, 'aria-label': `${author.displayName}'s profile` },
      avatar(author, { size: 36 })),
    grouped && h('time', { class: 'gutter-time', title: formatStamp(message.createdAt) }, formatTime(message.createdAt)),
    h('div', { class: 'message-header' },
      h('button', { type: 'button', class: 'author-name', onclick: profile }, author.displayName),
      h('time', { class: 'message-stamp', title: formatStamp(message.createdAt) }, formatTime(message.createdAt)),
      message.pinned && h('span', { class: 'pinned-mark', title: 'Pinned' }, icon('pin', 13))),
    h('div', { class: 'message-main' },
      contentView(message),
      message.attachments.length > 0 && h('div', { class: 'attachments' }, message.attachments.map(attachmentView)),
      reactionSlot),
    toolbar(message, row, mine, handlers, () => openTray()),
  ].filter(Boolean));
  return row;
}

// A compact, read-only copy of a message for the pinned list and search results.
export function messageCard(message, onJump) {
  return h('article', { class: 'message-card' },
    h('div', { class: 'message-card-head' }, avatar(message.author, { size: 22 }),
      h('strong', {}, message.author.displayName),
      h('time', { class: 'message-stamp' }, formatStamp(message.createdAt)),
      h('button', { type: 'button', class: 'jump', onclick: () => onJump(message.id) }, 'Jump')),
    message.content && h('div', { class: 'message-card-text' }, renderMarkdown(message.content)),
    message.attachments.length > 0 && h('div', { class: 'message-card-files' }, icon('paperclip', 14),
      h('span', {}, message.attachments.map((a) => a.name).join(', '))));
}
