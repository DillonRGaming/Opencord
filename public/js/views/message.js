import { withMenu } from '../contextMenu.js';
import { openEmojiPicker, emojiFace } from '../emojiPicker.js';
import { messageMenu, userMenu } from '../menus.js';
import * as api from '../api.js';
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { state, roleColor } from '../store.js';
import { mentionsMe, renderMarkdown, formatDay, formatSize, formatStamp, formatTime, sameDay } from '../format.js';
import { attempt, avatar, iconButton } from '../ui.js';
import { openLightbox } from './lightbox.js';
import { pollView } from './poll.js';
import { LANGUAGES, languageName, targetLanguage, translate, autoTranslateOn, worthTranslating } from '../translate.js';

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
          referrerPolicy: 'strict-origin-when-cross-origin', // YouTube won't play (error 153) without knowing the site
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

// The full text of messages that were sent cut short, once someone has asked for it.
const fullTexts = new Map();

export async function fullContent(message) {
  if (!message.truncated) return message.content;
  if (!fullTexts.has(message.id)) fullTexts.set(message.id, (await api.get(`/api/messages/${message.id}/content`)).content);
  return fullTexts.get(message.id);
}

// Very long messages arrive cut short (`truncated`); "Show more" fetches the rest and only then draws it,
// and "Show less" throws the big version away again, so walls of text don't slow the chat down.
function contentView(message) {
  if (!message.content) return null;
  const edited = () => message.editedAt && h('span', { class: 'message-edited', title: formatStamp(message.editedAt) }, '(edited)');
  const content = h('div', { class: 'message-content' }, renderMarkdown(message.content), edited());
  if (EMOJI_ONLY.test(message.content.trim())) content.classList.add('jumbo');
  if (!message.truncated && message.content.length <= LONG_MESSAGE) return content;

  content.classList.add('collapsed');
  let open = false;
  const toggle = h('button', {
    type: 'button', class: 'show-more',
    onclick: async () => {
      open = !open;
      if (message.truncated) {
        toggle.disabled = true;
        toggle.textContent = open ? 'Loading…' : 'Show more';
        try {
          content.replaceChildren(renderMarkdown(open ? await fullContent(message) : message.content), edited() || '');
        } catch {
          open = false;
        }
        toggle.disabled = false;
      }
      content.classList.toggle('collapsed', !open);
      toggle.textContent = open ? 'Show less' : `Show more${message.length ? ` (${Math.round(message.length / 1000)}k characters)` : ''}`;
    },
  }, message.length ? `Show more (${Math.round(message.length / 1000)}k characters)` : 'Show more');
  return [content, toggle];
}

// --- translation ---

const translations = new Map(); // messageId → { text, detected, to } shown in place of the original
const showingOriginal = new Set(); // messages someone switched back to the original (auto-translate leaves them alone)

// The message text, or its translation with a note saying so. Auto-translate fills it in once it arrives.
function textBlock(message, mine) {
  const holder = h('div', { class: 'message-text' });
  const draw = () => {
    const t = translations.get(message.id);
    if (t && !showingOriginal.has(message.id)) {
      holder.replaceChildren(
        h('div', { class: 'message-content translated' }, renderMarkdown(t.text)),
        h('div', { class: 'translation-note' }, icon('languages', 13),
          h('span', {}, `Translated from ${languageName(t.detected)}`),
          h('button', { type: 'button', onclick: () => { showingOriginal.add(message.id); draw(); } }, 'Show original')));
      return;
    }
    holder.replaceChildren(...[contentView(message), t && h('div', { class: 'translation-note' }, icon('languages', 13),
      h('button', { type: 'button', onclick: () => { showingOriginal.delete(message.id); draw(); } }, `Show the ${languageName(t.to)} translation`))].flat().filter(Boolean));
  };
  // The bar with From / To, opened from the message's tools.
  holder.openTranslate = () => {
    if (holder.querySelector('.translate-bar')) return;
    const from = h('select', { class: 'input', 'aria-label': 'From' }, h('option', { value: 'auto' }, 'Detect language'),
      LANGUAGES.map(([code, name]) => h('option', { value: code }, name)));
    const to = h('select', { class: 'input', 'aria-label': 'To' }, LANGUAGES.map(([code, name]) => h('option', { value: code, selected: code === targetLanguage() }, name)));
    const go = h('button', { type: 'button', class: 'button accent small' }, 'Translate');
    const bar = h('div', { class: 'translate-bar' }, icon('languages', 15), from, h('span', { class: 'muted' }, '→'), to, go,
      iconButton('x', 'Close', () => bar.remove()));
    go.addEventListener('click', () => attempt(async () => {
      go.disabled = true;
      go.textContent = 'Translating…';
      try {
        const text = await fullContent(message);
        const result = await translate(text, to.value, from.value);
        translations.set(message.id, { text: result.text, detected: from.value === 'auto' ? result.detected : from.value, to: to.value });
        showingOriginal.delete(message.id);
        draw();
      } finally {
        go.disabled = false;
        go.textContent = 'Translate';
      }
    }));
    holder.append(bar);
  };
  draw();
  // Automatic: anything not already in my language (and not mine) gets translated.
  const to = targetLanguage();
  if (autoTranslateOn() && !mine && !message.truncated && message.content && !translations.has(message.id) && worthTranslating(message.content)) {
    translate(message.content, to).then((result) => {
      if (result.detected?.split('-')[0] === to.split('-')[0] || result.text.trim() === message.content.trim()) return;
      translations.set(message.id, { text: result.text, detected: result.detected, to });
      if (holder.isConnected) draw();
    }).catch(() => {});
  }
  return holder;
}

export function openTranslate(row) {
  row.querySelector('.message-text')?.openTranslate();
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
    message.content && iconButton('languages', 'Translate', () => openTranslate(row)),
    mine && iconButton('pencil', 'Edit', () => handlers.onEdit(message, row)),
    (mine || handlers.canDelete) && iconButton('trash', 'Delete', () => attempt(() => handlers.onDelete(message)), 'danger'));
}

// Buttons a bot put under its message. Clicking one sets off the bot's "when a button is clicked" scripts.
function buttonsView(message) {
  return h('div', { class: 'bot-buttons' }, message.components.map((b, i) => (b.type === 'menu' ? menuView(message, b, i) : h('button', {
    type: 'button', class: 'button ghost small bot-button',
    onclick: (event) => {
      const el = event.currentTarget;
      el.disabled = true;
      attempt(() => api.post(`/api/messages/${message.id}/buttons/${i}`)).finally(() => setTimeout(() => { el.disabled = false; }, 1000));
    },
  }, b.label))));
}

// A drop-down a bot put under its message.
function menuView(message, menu, index) {
  const select = h('select', {
    class: 'input bot-menu', 'aria-label': menu.placeholder,
    onchange: () => {
      const value = select.value;
      if (!value) return;
      select.disabled = true;
      attempt(() => api.post(`/api/messages/${message.id}/menus/${index}`, { value }))
        .finally(() => setTimeout(() => { select.disabled = false; select.value = ''; }, 800));
    },
  }, h('option', { value: '' }, menu.placeholder || 'Pick one'), menu.options.map((o) => h('option', { value: o }, o)));
  return select;
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

  const classes = ['message', mine && 'mine', grouped && 'grouped', message.pinned && 'pinned', mentionsMe(message.content) && 'mentioned'];
  const body = h('div', {
    class: classes.filter(Boolean).join(' '),
    onclick: (event) => {
      if (event.target.closest('button, a, video, audio, textarea, input, .message-actions')) return;
      // A tap shows the tools. With another message's tools open, the tap just closes those.
      const open = document.querySelector('.message.selected');
      if (open && open !== event.currentTarget) open.classList.remove('selected');
      else event.currentTarget.classList.toggle('selected');
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
      message.relay && h('span', { class: 'relay-tag', title: `Sent in #${message.relay.channel} on ${message.relay.server}` }, icon('link', 11), message.relay.server),
      h('time', { class: 'message-stamp', title: formatStamp(message.createdAt) }, formatTime(message.createdAt)),
      message.pinned && h('span', { class: 'pinned-mark', title: 'Pinned' }, icon('pin', 13))),
    h('div', { class: 'message-main' },
      message.poll ? pollView(message, handlers.onVote) : textBlock(message, mine),
      message.attachments.length > 0 && h('div', { class: 'attachments' }, message.attachments.map(attachmentView)),
      message.embeds?.length > 0 && h('div', { class: 'embeds' }, message.embeds.map(embedView)),
      message.components?.length > 0 && buttonsView(message),
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

// Tapping anywhere outside the open tools closes them, and so does using one of them or scrolling.
export function closeMessageTools() {
  document.querySelector('.message.selected')?.classList.remove('selected');
}
document.addEventListener('click', (event) => {
  const open = document.querySelector('.message.selected');
  if (!open) return;
  if (event.target.closest('.message-actions button')) setTimeout(closeMessageTools, 0);
  else if (!open.contains(event.target) && !event.target.closest('.emoji-picker, .menu')) closeMessageTools();
});
document.addEventListener('touchmove', (event) => {
  if (event.target.closest?.('.scroller')) closeMessageTools();
}, { passive: true });
document.addEventListener('wheel', closeMessageTools, { passive: true });
