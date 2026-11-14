import { withMenu } from '../contextMenu.js';
import { openEmojiPicker, emojiFace } from '../emojiPicker.js';
import { messageMenu, userMenu } from '../menus.js';
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { state, roleColor } from '../store.js';
import { mentionsMe, renderMarkdown, formatDay, formatSize, formatStamp, formatTime, sameDay } from '../format.js';
import { attempt, avatar, iconButton } from '../ui.js';
import { openLightbox } from './lightbox.js';
import { pollView } from './poll.js';

const GROUP_MS = 7 * 60 * 1000;
const LONG_MESSAGE = 3000;

// One click away in the hover bar, then the full set in the reaction tray.
const QUICK = ['👍', '❤️', '😂'];
const EMOJI = ['👍', '👎', '❤️', '😂', '😮', '😢', '😡', '🔥', '🎉', '👀', '💯', '🙏', '👏', '😎', '🤔', '😅',
  '🥲', '🫡', '💀', '✅', '❌', '⭐', '🌮', '🍕', '🎮', '🏆', '💤', '🤝'];

const proxied = (url) => `/media/preview-image?url=${encodeURIComponent(url)}`;

// A link preview card. YouTube cards play in place when clicked.
function embedView(embed) {
  if (embed.type === 'image') {
    return withDownload(h('button', { type: 'button', class: 'attachment-image embed-image', onclick: () => openLightbox({ url: proxied(embed.image), name: embed.url, kind: 'image' }) },
      h('img', { src: proxied(embed.image), alt: '', loading: 'lazy' })), proxied(embed.image), embed.url.split('/').pop().split('?')[0] || 'image');
  }
  const media = embed.youtube
    ? h('button', {
      type: 'button', class: 'embed-video', 'aria-label': `Play ${embed.title || 'video'}`,
      onclick: (event) => {
        event.stopPropagation();
        event.currentTarget.replaceWith(h('iframe', {
          class: 'embed-player', src: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(embed.youtube)}?autoplay=1`,
          allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen', allowFullscreen: true, title: embed.title || 'YouTube video',
        }));
      },
    }, h('img', { src: proxied(embed.image), alt: '', loading: 'lazy' }), h('span', { class: 'embed-play' }, icon('play', 26)))
    : embed.image && h('img', { class: 'embed-thumb', src: proxied(embed.image), alt: '', loading: 'lazy' });
  return h('div', { class: `embed${embed.youtube ? ' video' : ''}`, style: embed.color ? { '--embed': embed.color } : null },
    embed.site && h('div', { class: 'embed-site' }, embed.site),
    embed.title && h('a', { class: 'embed-title', href: embed.url, target: '_blank', rel: 'noopener noreferrer' }, embed.title),
    embed.description && h('div', { class: 'embed-description' }, embed.description),
    media);
}

const downloadButton = (url, name, extra = '') => h('a', {
  class: `icon-button media-download ${extra}`, href: url, download: name || '', title: 'Download', 'aria-label': `Download ${name || 'file'}`,
  onclick: (event) => event.stopPropagation(),
}, icon('download', 18));

// A picture or video with a download button in its corner.
const withDownload = (media, url, name) => h('div', { class: 'media' }, media, downloadButton(url, name));

function attachmentView(attachment) {
  const { kind, name, url, size } = attachment;
  if (kind === 'image') {
    return withDownload(h('button', { type: 'button', class: 'attachment-image', title: name, onclick: () => openLightbox(attachment) },
      h('img', { src: url, alt: name, loading: 'lazy' })), url, name);
  }
  if (kind === 'video') return withDownload(h('video', { class: 'attachment-video', src: url, controls: true, preload: 'metadata', playsInline: true }), url, name);

  const info = h('div', { class: 'attachment-info' }, h('a', { href: url, download: name, title: name }, name), h('span', {}, formatSize(size)));
  if (kind === 'audio') {
    return h('div', { class: 'attachment-card audio' }, h('div', { class: 'attachment-card-top' }, info, downloadButton(url, name, 'inline')),
      h('audio', { src: url, controls: true, preload: 'none' }));
  }
  return h('div', { class: 'attachment-card' }, h('span', { class: 'attachment-icon' }, icon('file', 22)), info,
    h('a', { class: 'icon-button', href: url, download: name, title: 'Download', 'aria-label': `Download ${name}` }, icon('download')));
}

// Up to 10 emoji and nothing else: shown large, like a sticker.
const EMOJI_ONLY = /^(?:(?:\p{Extended_Pictographic}|\p{Regional_Indicator})(?:\uFE0F|\u200D|\p{Emoji_Modifier}|\p{Extended_Pictographic}|\p{Regional_Indicator})*\s*){1,10}$/u;

function contentView(message) {
  if (!message.content) return null;
  const content = h('div', { class: 'message-content' }, renderMarkdown(message.content),
    message.editedAt && h('span', { class: 'message-edited', title: formatStamp(message.editedAt) }, '(edited)'));
  if (EMOJI_ONLY.test(message.content.trim())) content.classList.add('jumbo');
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
        type: 'button', class: `reaction${mine ? ' mine' : ''}`, title: `${nameList(userIds)} reacted with ${emoji.startsWith('<') ? `:${emoji.split(':')[1]}:` : emoji}`,
        'aria-pressed': String(mine), onclick: () => onReact(message, emoji, !mine),
      }, h('span', { class: 'reaction-emoji' }, emojiFace(emoji)), h('span', { class: 'reaction-count' }, userIds.length));
    }),
    h('span', { class: 'actions-divider' }),
    h('button', { type: 'button', class: 'reaction add', title: 'Add reaction', 'aria-label': 'Add reaction', onclick: openTray }, icon('smilePlus', 16)));
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
    (mine || handlers.canDelete) && iconButton('trash', 'Delete', () => attempt(() => handlers.onDelete(message)), 'danger'));
}

// One message. `previous` is the message above it (decides the day divider and whether the header repeats).
// handlers: { canDelete, onEdit, onDelete, onProfile, onReply, onReact, onPin, onCopy, onJump }
export function messageRow(message, previous, mine, handlers) {
  const newDay = !previous || !sameDay(previous.createdAt, message.createdAt);
  const grouped = !newDay && !message.replyTo && previous.author.id === message.author.id
    && message.createdAt - previous.createdAt < GROUP_MS;
  const { author } = message;
  const profile = () => handlers.onProfile(author);

  const reactionSlot = h('div', {}, reactionsView(message, handlers.onReact, (event) => openTray(event)));
  function openTray(event) {
    openEmojiPicker(event.currentTarget, (emoji) => handlers.onReact(message, emoji, true));
  }

  const classes = ['message', grouped && 'grouped', message.pinned && 'pinned', mentionsMe(message.content) && 'mentioned'];
  const body = h('div', {
    class: classes.filter(Boolean).join(' '),
    onclick: (event) => {
      if (!event.target.closest('button, a, video, audio, textarea, input')) event.currentTarget.classList.toggle('selected');
    },
  });
  withMenu(body, (event) => (event.target.closest('.message-avatar, .author-name')
    ? userMenu(author, { serverId: handlers.serverId })
    : messageMenu(message, mine, handlers, row, EMOJI.slice(0, 6))));
  const row = h('div', { class: 'message-row', dataset: { id: message.id } },
    newDay && h('div', { class: 'day-divider' }, formatDay(message.createdAt)), body);
  body.append(...[
    message.replyTo && replyView(message.replyTo, handlers.onJump),
    h('button', { type: 'button', class: 'message-avatar', onclick: profile, 'aria-label': `${author.displayName}'s profile` },
      avatar(author, { size: 36 })),
    grouped && h('time', { class: 'gutter-time', title: formatStamp(message.createdAt) }, formatTime(message.createdAt)),
    h('div', { class: 'message-header' },
      h('button', {
        type: 'button', class: 'author-name', onclick: profile, dataset: { userId: author.id },
        style: roleColor(handlers.serverId, author.id) ? { color: roleColor(handlers.serverId, author.id) } : null,
      }, author.displayName),
      author.bot && h('span', { class: 'bot-tag' }, 'Bot'),
      h('time', { class: 'message-stamp', title: formatStamp(message.createdAt) }, formatTime(message.createdAt)),
      message.pinned && h('span', { class: 'pinned-mark', title: 'Pinned' }, icon('pin', 13))),
    h('div', { class: 'message-main' },
      message.poll ? pollView(message, handlers.onVote) : contentView(message),
      message.attachments.length > 0 && h('div', { class: 'attachments' }, message.attachments.map(attachmentView)),
      message.embeds?.length > 0 && h('div', { class: 'embeds' }, message.embeds.map(embedView)),
      reactionSlot),
    toolbar(message, row, mine, handlers, (event) => openTray(event)),
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
