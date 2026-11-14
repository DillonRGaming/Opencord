import * as api from '../api.js';
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { state, on, emit, dmName, quietNow, setting } from '../store.js';
import { navigate, paths } from '../router.js';
import { formatStamp, renderMarkdown, mentionsMe } from '../format.js';
import { attempt, avatar, confirmButton, iconButton, segmented } from '../ui.js';
import { openPage } from './page.js';

const KIND = { mention: 'mentioned you', everyone: 'mentioned everyone', reply: 'replied to you', role: 'mentioned your role' };
let filter = 'all';

function where(channel) {
  if (channel.type === 'dm') return channel.kind === 'group' ? dmName(channel) : 'Direct message';
  const server = state.servers.get(channel.serverId);
  return `#${channel.name}${server ? ` · ${server.name}` : ''}`;
}

function open(note) {
  const { channel, message } = note;
  const path = channel.type === 'dm' ? paths.dm(channel.id) : paths.channel(channel.serverId, channel.id);
  navigate(path);
  import('./chat.js').then((chat) => chat.jumpToMessage(channel.id, message.id));
}

function row(note, refresh) {
  const { message } = note;
  return h('div', { class: `notification${note.readAt ? '' : ' unread'}` },
    h('button', { type: 'button', class: 'notification-main', onclick: () => open(note) },
      avatar(message.author, { size: 40 }),
      h('span', { class: 'notification-body' },
        h('span', { class: 'notification-head' },
          h('strong', {}, message.author.displayName), ` ${KIND[note.kind] || 'notified you'}`,
          h('span', { class: 'notification-where' }, ` in ${where(note.channel)}`)),
        h('span', { class: 'notification-text' }, renderMarkdown(message.content.slice(0, 400))),
        h('time', { class: 'notification-time' }, formatStamp(note.createdAt)))),
    iconButton('x', 'Dismiss', () => attempt(async () => { await api.del(`/api/notifications/${note.id}`); refresh(); })));
}

// Every mention, @everyone and reply, newest first. Opening the page marks them read.
export async function openNotifications() {
  const list = h('div', { class: 'notification-list' }, h('p', { class: 'loading' }, 'Loading…'));
  let notes = [];
  const draw = () => {
    const shown = notes.filter((n) => filter === 'all' || (filter === 'mentions' ? n.kind !== 'reply' : n.kind === 'reply'));
    list.replaceChildren(...(shown.length ? shown.map((n) => row(n, load)) : [h('div', { class: 'empty-state' },
      h('span', { class: 'empty-icon' }, icon('bell', 26)), h('strong', {}, 'You’re all caught up'),
      h('span', {}, 'Mentions and replies show up here.'))]));
  };
  const load = async () => {
    notes = await api.get('/api/notifications').catch(() => []);
    draw();
    if (notes.some((n) => !n.readAt)) {
      await api.post('/api/notifications/read', {}).catch(() => {});
      state.unreadNotifications = 0;
      emit('notifications');
    }
  };
  openPage({
    title: 'Notifications',
    content: h('div', { class: 'settings-content notifications-page' },
      h('div', { class: 'notifications-tools' },
        segmented([['all', 'All'], ['mentions', 'Mentions'], ['replies', 'Replies']], filter, (value) => { filter = value; draw(); }),
        confirmButton({
          label: 'Clear all', confirmLabel: 'Clear them all?', className: 'button ghost small',
          onConfirm: async () => {
            await Promise.all(notes.map((n) => api.del(`/api/notifications/${n.id}`).catch(() => {})));
            load();
          },
        })),
      list),
  });
  load();
  const stop = on('notification', () => (list.isConnected ? load() : stop()));
}

// --- desktop notifications and the tab title ---

function wantsDesktop() {
  return state.me?.settings?.desktopNotifications !== false;
}

export async function askForDesktopNotifications() {
  if (!('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'default') return Notification.requestPermission();
  return Notification.permission;
}

on('notification', (note) => {
  const here = note.channel && state.route.channelId === note.channel.id && document.hasFocus();
  if (state.me?.presence === 'dnd' || quietNow()) return;
  if (here || !wantsDesktop() || !('Notification' in window) || Notification.permission !== 'granted') return;
  const { message } = note;
  const shown = new Notification(`${message.author.displayName} ${KIND[note.kind] || ''}`.trim(), {
    body: message.content.slice(0, 200), tag: note.id, icon: message.author.avatar || '/favicon.svg',
  });
  shown.onclick = () => { window.focus(); open(note); shown.close(); };
  if (state.me?.settings?.notificationSound !== false) ping();
});

let audio = null;
function ping() {
  try {
    audio ??= new AudioContext();
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.08, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.25);
    osc.connect(gain).connect(audio.destination);
    osc.start();
    osc.stop(audio.currentTime + 0.25);
  } catch { /* no audio */ }
}

on('notifications notification', () => {
  const n = state.unreadNotifications;
  document.title = n ? `(${n}) Opencord` : 'Opencord';
});

// A new DM (that isn't a mention, which is handled above) gets a desktop notification too, if wanted.
on('message:create', (message) => {
  const dm = state.dms.get(message.channelId);
  if (!dm || message.author.id === state.me.id || setting('dmNotifications', true) === false) return;
  if (state.me?.presence === 'dnd' || quietNow() || mentionsMe(message.content)) return;
  if ((state.route.channelId === dm.id && document.hasFocus()) || !wantsDesktop() || !('Notification' in window) || Notification.permission !== 'granted') return;
  const shown = new Notification(dm.kind === 'group' ? `${message.author.displayName} in ${dmName(dm)}` : message.author.displayName, {
    body: message.content.slice(0, 200) || 'Sent a file', tag: message.id, icon: message.author.avatar || '/favicon.svg',
  });
  shown.onclick = () => { window.focus(); navigate(paths.dm(dm.id)); shown.close(); };
  if (setting('notificationSound', true) !== false) ping();
});
