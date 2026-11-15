// A music channel: a shared queue of YouTube videos and uploaded audio files. Everyone hears the same thing
// at the same point: the server only stores what's playing and when it started (or was paused), and each
// listener's player seeks to match. Browsers don't let sound start by itself, so you press "Listen" first.
import * as api from '../api.js';
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { state, on, can, canPostIn } from '../store.js';
import { showNav } from '../router.js';
import { attempt, avatar, emptyList, iconButton, toast } from '../ui.js';
import { ensureMembers } from './members.js';

let view = null; // { root, channel, serverId, music, offset, listening, player, playerFor, progress, timer }

const clock = () => Date.now() + (view?.offset || 0); // the server's clock, roughly
const fmt = (s) => (Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '–:––');

export function closeMusic() {
  if (!view) return;
  clearInterval(view.timer);
  window.removeEventListener('message', onPlayerMessage);
  view = null;
}

const current = () => view.music?.playing && view.music.queue.find((q) => q.id === view.music.playing.itemId);

// Where the track should be right now, in seconds of the track (the shared speed is part of it).
function position() {
  const p = view.music?.playing;
  if (!p) return 0;
  return Math.max(0, (((p.pausedAt || clock()) - p.startedAt) / 1000) * (p.rate || 1));
}

const rate = () => view.music?.playing?.rate || 1;

// Volume is each listener's own, remembered in this browser.
function savedVolume() {
  try { const v = Number(localStorage.getItem('oc:musicVolume')); return Number.isFinite(v) && localStorage.getItem('oc:musicVolume') !== null ? v : 0.8; } catch { return 0.8; }
}
function applyVolume() {
  if (!view?.player) return;
  if (view.player.tagName === 'AUDIO') view.player.volume = view.volume;
  else ytCommand('setVolume', [Math.round(view.volume * 100)]);
}

function control(action, extra = {}) {
  const item = current();
  return attempt(() => api.post(`/api/channels/${view.channel.id}/music/control`, { action, itemId: item?.id, ...extra }));
}

// --- the player (a YouTube embed driven by postMessage, or an <audio> element) ---

function ytCommand(func, args = []) {
  view?.player?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args }), '*');
}

function onPlayerMessage(event) {
  if (!view?.player || event.source !== view.player.contentWindow) return;
  let data;
  try { data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data; } catch { return; }
  if (data?.event === 'onReady' || data?.event === 'initialDelivery') sync(true);
  const info = data?.info;
  if (!info || typeof info !== 'object') return;
  if (typeof info.currentTime === 'number') view.progress.time = info.currentTime;
  if (typeof info.duration === 'number' && info.duration > 0) view.progress.duration = info.duration;
  if (info.playerState === 0) ended();
}

let endedFor = null;
function ended() {
  const item = current();
  if (!item || endedFor === item.id) return;
  endedFor = item.id;
  control('ended');
}

function buildPlayer(item) {
  view.progress = { time: 0, duration: NaN };
  if (item.kind === 'youtube') {
    const start = Math.floor(position());
    const src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(item.source)}?enablejsapi=1&autoplay=1&controls=0&disablekb=1&modestbranding=1&rel=0&playsinline=1&start=${start}&origin=${encodeURIComponent(location.origin)}`;
    // YouTube refuses to play (error 153) unless it's told which site the player is on.
    const frame = h('iframe', { class: 'music-frame', src, allow: 'autoplay; encrypted-media', title: item.title, referrerPolicy: 'strict-origin-when-cross-origin' });
    frame.addEventListener('load', () => {
      // Ask the player to report its time and state.
      frame.contentWindow.postMessage(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), '*');
      setTimeout(() => sync(true), 400);
    });
    return frame;
  }
  const audio = h('audio', { class: 'music-audio', src: item.source, preload: 'auto' });
  audio.addEventListener('timeupdate', () => { view.progress.time = audio.currentTime; });
  audio.addEventListener('loadedmetadata', () => { view.progress.duration = audio.duration; sync(true); });
  audio.addEventListener('ended', ended);
  return audio;
}

// Bring my player in line with the shared state: right track, playing or paused, within a couple of seconds.
function sync(force = false) {
  if (!view?.listening) return;
  const item = current();
  const { slot } = view;
  if (!item) {
    view.player?.remove();
    view.player = null;
    view.playerFor = null;
    return;
  }
  if (view.playerFor !== item.id || !view.player?.isConnected) {
    view.player?.remove();
    view.player = buildPlayer(item);
    view.playerFor = item.id;
    endedFor = null;
    slot.replaceChildren(view.player);
    slot.hidden = item.kind !== 'youtube';
    if (item.kind === 'audio') view.player.play().catch(() => {});
    return;
  }
  const paused = Boolean(view.music.playing.pausedAt);
  const want = position();
  if (item.kind === 'youtube') {
    if (force || Math.abs(view.progress.time - want) > 2.5) ytCommand('seekTo', [want, true]);
    ytCommand('setPlaybackRate', [rate()]);
    if (force) applyVolume();
    ytCommand(paused ? 'pauseVideo' : 'playVideo');
  } else {
    const audio = view.player;
    if (audio.playbackRate !== rate()) audio.playbackRate = rate();
    if (force) applyVolume();
    if (force || Math.abs(audio.currentTime - want) > 1.5) {
      try { audio.currentTime = want; } catch { /* not loaded yet */ }
    }
    if (paused) audio.pause();
    else audio.play().catch(() => {});
  }
}

// --- drawing ---

function nowPlaying() {
  const item = current();
  if (!item) {
    return h('section', { class: 'music-now empty' }, emptyList('music', 'Nothing playing', 'Add a YouTube link below to start the music.'));
  }
  const paused = Boolean(view.music.playing.pausedAt);
  const adder = state.users.get(item.addedBy);
  const bar = h('div', { class: 'music-bar', role: 'slider', 'aria-label': 'Position', tabIndex: 0 }, h('span', { class: 'music-fill' }));
  bar.addEventListener('click', (event) => {
    const box = bar.getBoundingClientRect();
    const duration = view.progress?.duration;
    if (Number.isFinite(duration)) control('seek', { position: ((event.clientX - box.left) / box.width) * duration });
  });
  const art = item.kind === 'youtube'
    ? h('img', { class: 'music-art', src: `/media/preview-image?url=${encodeURIComponent(`https://i.ytimg.com/vi/${item.source}/hqdefault.jpg`)}`, alt: '' })
    : h('span', { class: 'music-art audio' }, icon('music', 34));
  return h('section', { class: 'music-now' },
    h('div', { class: 'music-info' }, art,
      h('div', { class: 'music-text' },
        h('strong', {}, item.title),
        h('span', {}, adder ? `Added by ${adder.displayName}` : ''),
        h('div', { class: 'music-time' }, h('span', { class: 'music-at' }, fmt(position())), bar, h('span', { class: 'music-length' }, fmt(view.progress?.duration))))),
    h('div', { class: 'music-controls' },
      speedPicker(),
      volumeSlider(),
      iconButton('lyrics', view.lyricsOpen ? 'Hide lyrics' : 'Lyrics', toggleLyrics, view.lyricsOpen ? 'on' : ''),
      view.listening
        ? iconButton('volume', 'Stop listening', () => { view.listening = false; view.player?.remove(); view.player = null; view.playerFor = null; render(); }, 'listening')
        : h('button', { type: 'button', class: 'button accent small', onclick: () => { view.listening = true; render(); sync(true); } }, icon('headphones', 16), 'Listen'),
      iconButton(paused ? 'play' : 'pause', paused ? 'Play' : 'Pause', () => control(paused ? 'play' : 'pause'), 'music-main'),
      iconButton('skip', 'Skip', () => control('skip'))));
}

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

// The speed is shared: everyone listening hears the same speed.
function speedPicker() {
  const select = h('select', {
    class: 'input music-speed', 'aria-label': 'Speed', title: 'Speed (for everyone)',
    onchange: () => control('rate', { rate: Number(select.value) }),
  }, SPEEDS.map((sp) => h('option', { value: sp, selected: sp === rate() }, `${sp}×`)));
  return h('label', { class: 'music-speed-wrap' }, icon('gauge', 16), select);
}

// Volume only changes your own player.
function volumeSlider() {
  const slider = h('input', {
    type: 'range', min: 0, max: 1, step: 0.01, value: view.volume, class: 'music-volume', 'aria-label': 'Volume', title: 'Volume (just for you)',
    oninput: () => {
      view.volume = Number(slider.value);
      try { localStorage.setItem('oc:musicVolume', String(view.volume)); } catch { /* fine */ }
      slider.style.setProperty('--fill', `${view.volume * 100}%`);
      applyVolume();
    },
  });
  slider.style.setProperty('--fill', `${view.volume * 100}%`);
  return h('label', { class: 'music-volume-wrap' }, icon('volume', 16), slider);
}

// --- lyrics (from lrclib.net, through the server) ---

const lyricsCache = new Map(); // itemId → Promise<lyrics|null>

function parseLrc(text) {
  const lines = [];
  for (const raw of text.split('\n')) {
    const stamps = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    const words = raw.replace(/\[[^\]]*\]/g, '').trim();
    for (const m of stamps) lines.push({ at: Number(m[1]) * 60 + Number(m[2]), text: words });
  }
  return lines.sort((a, b) => a.at - b.at);
}

function toggleLyrics() {
  view.lyricsOpen = !view.lyricsOpen;
  render();
}

function lyricsFor(item) {
  if (!lyricsCache.has(item.id)) {
    const duration = Number.isFinite(view.progress?.duration) ? Math.round(view.progress.duration) : 0;
    lyricsCache.set(item.id, api.get(`/api/fun/lyrics?title=${encodeURIComponent(item.title)}${duration ? `&duration=${duration}` : ''}`).catch((err) => ({ error: err.message })));
  }
  return lyricsCache.get(item.id);
}

function lyricsPanel() {
  const item = current();
  const box = h('section', { class: 'music-lyrics' }, h('h3', {}, icon('lyrics', 16), 'Lyrics'), h('p', { class: 'muted' }, 'Looking for the lyrics…'));
  if (!item) { box.lastChild.textContent = 'Nothing is playing.'; return box; }
  lyricsFor(item).then((found) => {
    if (!box.isConnected && !view) return;
    box.lastChild.remove();
    if (!found || found.error) {
      box.append(h('p', { class: 'muted' }, found?.error || 'No lyrics found for this one.'));
      return;
    }
    box.querySelector('h3').append(h('span', { class: 'muted music-lyrics-of' }, `${found.track} · ${found.artist}`));
    if (found.instrumental) { box.append(h('p', { class: 'muted' }, '♪ Instrumental ♪')); return; }
    const synced = found.synced ? parseLrc(found.synced) : [];
    if (synced.length) {
      box.classList.add('synced');
      box.append(h('div', { class: 'lyrics-lines' }, synced.map((line) => h('button', {
        type: 'button', class: 'lyrics-line', dataset: { at: line.at },
        onclick: () => control('seek', { position: line.at }),
        title: 'Jump here',
      }, line.text || '♪'))));
    } else {
      box.append(h('div', { class: 'lyrics-plain' }, found.plain));
    }
  });
  return box;
}

// Light up the line being sung and keep it in view.
function followLyrics(pos) {
  const lines = view.root.querySelectorAll('.lyrics-line');
  if (!lines.length) return;
  let active = null;
  for (const line of lines) if (Number(line.dataset.at) <= pos + 0.25) active = line;
  for (const line of lines) line.classList.toggle('active', line === active);
  if (active && active !== view.activeLine) {
    view.activeLine = active;
    const list = active.parentElement;
    list.scrollTo({ top: active.offsetTop - list.clientHeight / 2 + active.clientHeight / 2, behavior: 'smooth' });
  }
}

function queueList() {
  const playingId = view.music?.playing?.itemId;
  const upNext = (view.music?.queue || []).filter((q) => q.id !== playingId);
  const input = h('input', { class: 'input', placeholder: 'Paste a YouTube link (or an audio file link from chat)', 'aria-label': 'Song link' });
  const canAdd = canPostIn(view.serverId, view.channel);
  const add = h('form', {
    class: 'music-add',
    onsubmit: (event) => {
      event.preventDefault();
      if (!input.value.trim()) return;
      const url = input.value.trim();
      input.value = '';
      attempt(async () => {
        try {
          await api.post(`/api/channels/${view.channel.id}/music`, { url });
        } catch (err) {
          input.value = url;
          throw err;
        }
      });
    },
  }, input, h('button', { type: 'submit', class: 'button primary small' }, icon('plus', 16), 'Add'));
  return h('section', { class: 'music-queue' },
    canAdd ? add : h('p', { class: 'muted' }, 'Only admins can add songs here.'),
    h('h3', {}, upNext.length ? `Up next · ${upNext.length}` : 'Up next'),
    upNext.length ? upNext.map((item, i) => {
      const adder = state.users.get(item.addedBy);
      return h('div', { class: 'music-item' },
        h('span', { class: 'music-n' }, i + 1),
        h('div', { class: 'music-item-text' }, h('strong', {}, item.title), h('span', {}, adder?.displayName || '')),
        adder && avatar(adder, { size: 22 }),
        (item.addedBy === state.me.id || can(view.serverId, 'manageMessages')) && iconButton('x', `Remove ${item.title}`, () => attempt(() => api.del(`/api/channels/${view.channel.id}/music/${item.id}`))));
    }) : emptyList('music', 'Nothing up next'));
}

// The player lives in its own slot that redraws never touch: moving an embed in the page reloads it,
// which would restart the song.
function render() {
  if (!view?.root.isConnected) return;
  const { channel } = view;
  if (!view.shell) {
    view.head = h('div');
    view.slot = h('div', { class: 'music-player-slot' });
    view.body = h('div', { class: 'page-scroll' });
    view.shell = true;
    view.root.replaceChildren(view.head, view.slot, view.body);
  }
  view.slot.hidden = !(view.listening && current()?.kind === 'youtube');
  view.head.replaceChildren(h('header', { class: 'main-header' },
    iconButton('back', 'Back', () => showNav(), 'back-button'),
    h('div', { class: 'main-title' }, icon('music', 18), h('span', {}, channel.name)),
    channel.topic ? h('div', { class: 'main-topic', title: channel.topic }, channel.topic) : h('div', { class: 'main-spacer' })));
  const scroll = view.body.scrollTop;
  // The lyrics box only redraws when the song changes, so it doesn't jump back to the top.
  const item = current();
  if (!view.lyricsOpen) view.lyricsBox = null;
  else if (!view.lyricsBox || view.lyricsFor !== item?.id) {
    view.lyricsBox = lyricsPanel();
    view.lyricsFor = item?.id;
    view.activeLine = null;
  }
  view.body.replaceChildren(h('div', { class: 'music-page' }, nowPlaying(), view.lyricsBox || '', queueList()));
  view.body.scrollTop = scroll;
}

// The time and bar move on their own between updates.
function tick() {
  if (!view?.root.isConnected) return;
  const at = view.root.querySelector('.music-at');
  if (!at) return;
  const pos = view.listening && Number.isFinite(view.progress?.time) && view.progress.time > 0 ? view.progress.time : position();
  at.textContent = fmt(pos);
  if (view.lyricsOpen) followLyrics(pos);
  view.root.querySelector('.music-length').textContent = fmt(view.progress?.duration);
  const fill = view.root.querySelector('.music-fill');
  if (fill) fill.style.width = Number.isFinite(view.progress?.duration) ? `${Math.min(100, (pos / view.progress.duration) * 100)}%` : '0%';
  if (view.listening) {
    sync();
    // An audio file reports its own end; for YouTube, also end when the time runs out (in case the embed can't say).
    if (Number.isFinite(view.progress?.duration) && !view.music?.playing?.pausedAt && position() > view.progress.duration + 3) ended();
  }
}

function apply(music) {
  view.offset = music.now - Date.now();
  view.music = music;
  render();
  sync(true);
}

on('music:update', (music) => {
  if (music.channelId === view?.channel.id) apply(music);
});
on('users members', () => view && render());
on('reload', () => view && api.get(`/api/channels/${view.channel.id}/music`).then(apply).catch(() => {}));

export async function showMusic(container, channel, serverId) {
  if (view?.channel.id === channel.id && view.root === container && container.isConnected) {
    view.channel = channel;
    return render();
  }
  closeMusic();
  view = { root: container, shell: false, channel, serverId, music: null, offset: 0, listening: false, player: null, playerFor: null, progress: { time: 0, duration: NaN }, volume: savedVolume(), lyricsOpen: false };
  window.addEventListener('message', onPlayerMessage);
  view.timer = setInterval(tick, 500);
  ensureMembers(serverId);
  render();
  const music = await api.get(`/api/channels/${channel.id}/music`).catch((err) => { toast(err.message); return null; });
  if (music && view?.channel.id === channel.id) apply(music);
  return undefined;
}
