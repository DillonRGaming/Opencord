import { withMenu } from '../contextMenu.js';
import { openEmojiPicker, emojiFace } from '../emojiPicker.js';
import { messageMenu, userMenu } from '../menus.js';
import * as api from '../api.js';
import { h } from '../dom.js';
import { navigate, paths } from '../router.js';
import { icon } from '../icons.js';
import { state, roleColor } from '../store.js';
import { mentionsMe, renderMarkdown, formatDay, formatSize, formatStamp, formatTime, sameDay } from '../format.js';
import { attempt, avatar, button, iconButton } from '../ui.js';
import { voice } from '../voice.js';
import { openLightbox } from './lightbox.js';
import { pollView } from './poll.js';
import { gameView } from './game.js';
import { RICH_TYPES, richView } from './rich.js';
import { isVoiceMessage, voiceMessageView } from '../voiceMessage.js';
import { remote } from '../fun.js';
import { LANGUAGES, languageName, targetLanguage, translate, autoTranslateOn, worthTranslating } from '../translate.js';

const GROUP_MS = 7 * 60 * 1000;
const LONG_MESSAGE = 1500; // characters, or…
const LONG_LINES = 20; // …lines, before a message folds behind Show more

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
  if (isVoiceMessage(attachment)) return voiceMessageView(attachment);
  if (kind === 'audio') {
    return h('div', { class: 'attachment-card audio' }, h('div', { class: 'attachment-card-top' }, info, downloadButton(url, name, 'inline')),
      h('audio', { src: url, controls: true, preload: 'none' }));
  }
  return h('div', { class: 'attachment-card' }, h('span', { class: 'attachment-icon' }, icon('file', 22)), info,
    h('a', { class: 'icon-button', href: url, download: name, title: 'Download', 'aria-label': `Download ${name}` }, icon('download')));
}

// A shared location: a small map made of OpenStreetMap tiles, with a pin and links to open it in a maps app.
function locationView(loc) {
  const zoom = loc.accuracy > 2000 ? 12 : loc.accuracy > 300 ? 14 : 16;
  const n = 2 ** zoom;
  const x = ((loc.lon + 180) / 360) * n;
  const rad = (loc.lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n;
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  // A 3×3 block of 256px tiles, shifted so the spot sits in the middle of the card.
  const tiles = [];
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      const tileX = ((tx + dx) % n + n) % n;
      tiles.push(h('img', { src: `https://tile.openstreetmap.org/${zoom}/${tileX}/${ty + dy}.png`, alt: '', loading: 'lazy', draggable: false, style: { left: `${(dx + 1) * 256}px`, top: `${(dy + 1) * 256}px` } }));
    }
  }
  const offX = (x - tx + 1) * 256;
  const offY = (y - ty + 1) * 256;
  const osm = `https://www.openstreetmap.org/?mlat=${loc.lat}&mlon=${loc.lon}#map=${zoom}/${loc.lat}/${loc.lon}`;
  const google = `https://www.google.com/maps/search/?api=1&query=${loc.lat},${loc.lon}`;
  return h('div', { class: 'location-card' },
    h('a', { class: 'location-map', href: osm, target: '_blank', rel: 'noopener noreferrer', 'aria-label': 'Open the map' },
      h('div', { class: 'location-tiles', style: { left: `calc(50% - ${offX}px)`, top: `calc(50% - ${offY}px)` } }, tiles),
      h('span', { class: 'location-pin' }, icon('mapPin', 30))),
    h('div', { class: 'location-info' },
      h('div', {}, h('strong', {}, loc.label || 'Location'), h('span', { class: 'muted' }, `${loc.lat.toFixed(5)}, ${loc.lon.toFixed(5)}${loc.accuracy ? ` · within ${loc.accuracy < 1000 ? `${loc.accuracy} m` : `${(loc.accuracy / 1000).toFixed(1)} km`}` : ''}`)),
      h('div', { class: 'location-links' },
        h('a', { class: 'button ghost small', href: google, target: '_blank', rel: 'noopener noreferrer' }, 'Google Maps'),
        h('a', { class: 'button ghost small', href: osm, target: '_blank', rel: 'noopener noreferrer' }, 'OpenStreetMap'))),
    h('div', { class: 'location-credit' }, '© OpenStreetMap contributors'));
}

// Under a message that has a thread: how many replies, who's in it, and when the last one was.
function threadSummary(message, onOpen) {
  const { thread } = message;
  return h('button', { type: 'button', class: 'thread-summary', onclick: () => onOpen(message) },
    h('span', { class: 'thread-faces' }, thread.people.map((id) => avatar(state.users.get(id) || { id, displayName: '?' }, { size: 20 }))),
    h('strong', {}, `${thread.count} ${thread.count === 1 ? 'reply' : 'replies'}`),
    h('span', { class: 'muted' }, `Last reply ${formatStamp(thread.lastAt)}`),
    icon('chevronRight', 15));
}

// A message that is only a GIF or Emoji Kitchen link shows just the picture.
const STICKER_LINK = /^https:\/\/(media1?\.tenor\.com|www\.gstatic\.com\/android\/keyboard\/emojikitchen)\/\S+$/;

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
  if (STICKER_LINK.test(message.content.trim())) {
    // Shown straight away as the picture (its link preview is skipped).
    const url = message.content.trim();
    const kitchen = url.includes('emojikitchen');
    return h('div', { class: `sticker${kitchen ? ' kitchen' : ''}` }, h('img', { src: remote(url), alt: kitchen ? 'Emoji Kitchen sticker' : 'GIF', loading: 'lazy' }));
  }
  const edited = () => message.editedAt && h('span', { class: 'message-edited', title: formatStamp(message.editedAt) }, '(edited)');
  const content = h('div', { class: 'message-content' }, renderMarkdown(message.content), edited());
  if (EMOJI_ONLY.test(message.content.trim())) content.classList.add('jumbo');
  // Code blocks fold on their own, so they don't count toward the length here.
  const prose = message.content.replace(/```[\s\S]*?```/g, '');
  if (!message.truncated && prose.length <= LONG_MESSAGE && prose.split('\n').length <= LONG_LINES) return content;

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
    handlers.onThread && !message.threadId && iconButton('thread', 'Reply in thread', () => handlers.onThread(message)),
    iconButton('pin', message.pinned ? 'Unpin' : 'Pin', () => handlers.onPin(message), message.pinned ? 'on' : ''),
    message.content && iconButton('copy', 'Copy text', () => handlers.onCopy(message)),
    message.content && iconButton('languages', 'Translate', () => openTranslate(row)),
    mine && iconButton('pencil', 'Edit', () => handlers.onEdit(message, row)),
    (mine || handlers.canDelete) && iconButton('trash', 'Delete', () => attempt(() => handlers.onDelete(message)), 'danger'));
}

// Buttons a bot put under its message. Clicking one sets off the bot's "when a button is clicked" scripts.
function buttonsView(message) {
  return h('div', { class: 'bot-buttons' }, message.components.map((b, i) => (RICH_TYPES.includes(b.type) ? null : b.type === 'menu' ? menuView(message, b, i) : h('button', {
    type: 'button', class: `button small bot-button ${{ danger: 'danger', primary: 'accent' }[b.style] || 'ghost'}`,
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
function duration(ms) {
  const s = Math.max(1, Math.round(ms / 1000));
  if (s < 60) return `${s} second${s === 1 ? '' : 's'}`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'}${s % 60 ? ` ${s % 60}s` : ''}`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

// A DM call, shown as a line in the chat rather than a normal message.
function callNote(message, call) {
  const { author } = message;
  const ongoing = !call.endedAt;
  const inIt = voice.channelId === message.channelId;
  return h('div', { class: 'message-row', dataset: { id: message.id } },
    h('div', { class: 'message call-note' },
      h('span', { class: `call-note-icon${ongoing ? '' : ' ended'}` }, icon(ongoing ? 'phone' : 'phoneOff', 17)),
      h('div', { class: 'call-note-text' },
        h('span', {}, h('strong', {}, author.displayName), ' started a call',
          ongoing ? '' : ` that lasted ${duration(call.endedAt - call.startedAt)}`),
        h('time', { title: formatStamp(message.createdAt) }, formatTime(message.createdAt)),
        ongoing && !inIt && button('Join', async () => {
          const { joinVoice } = await import('../voice.js');
          const { findChannel } = await import('../store.js');
          const { navigate, paths } = await import('../router.js');
          joinVoice(findChannel(message.channelId));
          navigate(paths.dmCall(message.channelId));
        }, 'accent small'))));
}

// "Sent from another server" tag on a linked-channel copy. Clicking it opens the original message, if you're in that server.
function relayTag(relay) {
  const reachable = relay.serverId && state.servers.has(relay.serverId);
  return h(reachable ? 'button' : 'span', {
    type: reachable ? 'button' : null, class: 'relay-tag',
    title: `Sent in #${relay.channel} on ${relay.server}${reachable ? ' (click to open)' : ''}`,
    onclick: reachable ? () => {
      navigate(paths.channel(relay.serverId, relay.channelId));
      import('./chat.js').then((chat) => chat.jumpToMessage(relay.channelId, relay.messageId));
    } : null,
  }, icon('link', 11), relay.server);
}

export function messageRow(message, previous, mine, handlers) {
  const call = message.components?.[0]?.type === 'call' ? message.components[0] : null;
  if (call) return callNote(message, call);
  const location = message.components?.[0]?.type === 'location' ? message.components[0] : null;
  const newDay = !previous || !sameDay(previous.createdAt, message.createdAt);
  const grouped = !newDay && !message.replyTo && previous.author.id === message.author.id && previous.components?.[0]?.type !== 'call'
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
      message.relay && relayTag(message.relay),
      h('time', { class: 'message-stamp', title: formatStamp(message.createdAt) }, formatTime(message.createdAt)),
      message.pinned && h('span', { class: 'pinned-mark', title: 'Pinned' }, icon('pin', 13))),
    h('div', { class: 'message-main' },
      message.poll ? pollView(message, handlers.onVote) : !location && textBlock(message, mine),
      message.game && gameView(message),
      location && locationView(location),
      message.attachments.length > 0 && h('div', { class: 'attachments' }, message.attachments.map(attachmentView)),
      message.embeds?.length > 0 && !STICKER_LINK.test(message.content.trim()) && h('div', { class: 'embeds' }, message.embeds.map(embedView)),
      message.components?.some((c) => RICH_TYPES.includes(c.type)) && h('div', { class: 'rich' }, message.components.filter((c) => RICH_TYPES.includes(c.type)).map(richView)),
      message.components?.some((c) => !RICH_TYPES.includes(c.type)) && !['call', 'location'].includes(message.components[0].type) && buttonsView(message),
      reactionSlot,
      message.thread && handlers.onThread && threadSummary(message, handlers.onThread)),
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
    // Stickers and GIFs show as the picture; other text as text.
    message.content && (STICKER_LINK.test(message.content.trim())
      ? h('div', { class: 'message-card-media' }, contentView(message))
      : h('div', { class: 'message-card-text' }, renderMarkdown(message.content))),
    // Files show as themselves: images, videos, voice notes and audio play right here.
    message.attachments.length > 0 && h('div', { class: 'attachments message-card-media' }, message.attachments.map(attachmentView)));
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
// On a phone, tapping a video, sound or picture puts the keyboard away instead of keeping the box focused.
document.addEventListener('pointerdown', (event) => {
  if (event.pointerType !== 'touch' || !event.target.closest?.('.message video, .message audio, .message .media, .message .attachment-card, .message .embed')) return;
  if (document.activeElement?.matches?.('textarea, input')) document.activeElement.blur();
}, true);

document.addEventListener('touchmove', (event) => {
  if (event.target.closest?.('.scroller')) closeMessageTools();
}, { passive: true });
document.addEventListener('wheel', closeMessageTools, { passive: true });
