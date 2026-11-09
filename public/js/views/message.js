import { h } from '../dom.js';
import { icon } from '../icons.js';
import { renderMarkdown, formatDay, formatSize, formatStamp, formatTime, sameDay } from '../format.js';
import { avatar, iconButton } from '../ui.js';
import { openLightbox } from './modals.js';

const GROUP_MS = 7 * 60 * 1000;
const LONG_MESSAGE = 3000;

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
  return h('div', { class: 'attachment-card' }, icon('file', 28), info,
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

// One message. `previous` is the message above it (decides the day divider and whether the header repeats).
// handlers: { canDelete, onEdit(message, row), onDelete(message), onProfile(user, anchor) }
export function messageRow(message, previous, mine, handlers) {
  const newDay = !previous || !sameDay(previous.createdAt, message.createdAt);
  const grouped = !newDay && previous.author.id === message.author.id && message.createdAt - previous.createdAt < GROUP_MS;
  const { author } = message;
  const profile = (event) => handlers.onProfile(author, event.currentTarget);

  const actions = [
    mine && iconButton('pencil', 'Edit', () => handlers.onEdit(message, row)),
    (mine || handlers.canDelete) && iconButton('trash', 'Delete', () => handlers.onDelete(message), 'danger'),
  ].filter(Boolean);

  const row = h('div', { class: 'message-row', dataset: { id: message.id } },
    newDay && h('div', { class: 'day-divider' }, formatDay(message.createdAt)),
    h('div', {
      class: `message${grouped ? ' grouped' : ''}`,
      onclick: (event) => {
        if (!event.target.closest('button, a, video, audio, textarea')) event.currentTarget.classList.toggle('selected');
      },
    },
    h('div', { class: 'message-header' },
      h('button', { type: 'button', class: 'message-avatar', onclick: profile, 'aria-label': `${author.displayName}'s profile` },
        avatar(author, { size: 30 })),
      h('button', { type: 'button', class: 'author-name', onclick: profile }, author.displayName),
      h('time', { class: 'message-stamp', title: formatStamp(message.createdAt) }, formatTime(message.createdAt))),
    h('div', { class: 'message-main' },
      contentView(message),
      message.attachments.length > 0 && h('div', { class: 'attachments' }, message.attachments.map(attachmentView))),
    actions.length > 0 && h('div', { class: 'message-actions' }, actions)));
  return row;
}
