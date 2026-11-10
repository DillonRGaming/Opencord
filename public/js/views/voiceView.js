// The main area for a voice channel: a grid of tiles (camera, screen or avatar on a colour) and the
// call controls along the bottom, or a "join" screen when you're not in the call yet.
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { state, on } from '../store.js';
import { avatar, iconButton } from '../ui.js';
import {
  voice, joinVoice, leaveVoice, toggleMute, toggleDeafen, toggleCamera, toggleScreen, localVideoStream, peerStream,
} from '../voice.js';
import { openProfile } from './profile.js';

let view = null; // { root, channel, serverId, tiles: Map(userId → tile) }

function videoFor(person) {
  if (person.userId === state.me.id) return voice.video ? localVideoStream() : null;
  if (!person.video && !person.screen) return null;
  const stream = peerStream(person.userId);
  return stream?.getVideoTracks().some((t) => t.readyState === 'live') ? stream : null;
}

function tile(person) {
  const user = state.users.get(person.userId) || { id: person.userId, displayName: 'Someone', username: '' };
  const video = h('video', { autoplay: true, playsInline: true, muted: true });
  const face = h('div', { class: 'vt-face' }, avatar(user, { size: 96 }));
  const el = h('button', { type: 'button', class: 'vt', onclick: () => openProfile(user) }, face, video);
  return { el, video, face, user, stream: null };
}

function updateTile(t, person) {
  const stream = videoFor(person);
  if (stream !== t.stream) {
    t.stream = stream;
    t.video.srcObject = stream;
    if (stream) t.video.play().catch(() => {});
  }
  const me = person.userId === state.me.id;
  t.el.classList.toggle('has-video', Boolean(stream));
  t.el.classList.toggle('screen', Boolean(stream) && (me ? voice.video === 'screen' : person.screen));
  t.el.classList.toggle('mirror', Boolean(stream) && me && voice.video === 'camera');
  t.el.classList.toggle('speaking', Boolean(person.speaking) && !person.muted);
  t.el.title = t.user.displayName;
}

function controls() {
  const button = (name, label, onclick, extra = '') => h('button', { type: 'button', class: `vc-button ${extra}`, title: label, 'aria-label': label, onclick }, icon(name, 20));
  return h('div', { class: 'vc-bar' },
    button(voice.muted ? 'micOff' : 'mic', voice.muted ? 'Unmute' : 'Mute', toggleMute, voice.muted ? 'off' : ''),
    button(voice.video === 'camera' ? 'video' : 'videoOff', voice.video === 'camera' ? 'Turn camera off' : 'Turn camera on', toggleCamera, voice.video === 'camera' ? 'on' : ''),
    button(voice.deafened ? 'headphonesOff' : 'headphones', voice.deafened ? 'Undeafen' : 'Deafen', toggleDeafen, voice.deafened ? 'off' : ''),
    button('monitor', voice.video === 'screen' ? 'Stop sharing' : 'Share your screen', toggleScreen, voice.video === 'screen' ? 'on' : ''),
    button('phoneOff', 'Leave call', leaveVoice, 'leave'));
}

function render() {
  if (!view?.root.isConnected) return;
  const { channel } = view;
  const people = state.voice.get(channel.id) || [];
  const inCall = voice.channelId === channel.id && !voice.connecting;
  const header = h('header', { class: 'main-header' },
    iconButton('back', 'Back', () => { document.body.dataset.panel = 'nav'; }, 'back-button'),
    h('div', { class: 'main-title' }, icon('volume', 18), h('span', {}, channel.name)),
    h('div', { class: 'main-spacer' }));

  if (!inCall) {
    view.tiles.clear();
    view.root.replaceChildren(header, h('div', { class: 'vc-lobby' },
      h('div', { class: 'vc-lobby-faces' }, people.length
        ? people.slice(0, 6).map((p) => avatar(state.users.get(p.userId) || { id: p.userId, displayName: '?' }, { size: 64 }))
        : h('span', { class: 'empty-icon' }, icon('volume', 30))),
      h('h2', {}, channel.name),
      people.length > 0 && h('p', {}, `${people.map((p) => state.users.get(p.userId)?.displayName || 'Someone').slice(0, 3).join(', ')}${people.length > 3 ? ` and ${people.length - 3} more` : ''} ${people.length === 1 ? 'is' : 'are'} in the call.`),
      h('button', { type: 'button', class: 'button primary vc-join', disabled: voice.connecting, onclick: () => joinVoice(channel) },
        voice.connecting ? 'Connecting…' : 'Join voice')));
    return;
  }

  // In the call: keep tiles between renders so videos don't flicker.
  let grid = view.root.querySelector('.vc-grid');
  if (!grid) {
    grid = h('div', { class: 'vc-grid' });
    view.root.replaceChildren(h('div', { class: 'vc-call' }, iconButton('back', 'Back', () => { document.body.dataset.panel = 'nav'; }, 'back-button vc-back'), h('div', { class: 'vc-stage' }, grid), controls()));
  } else {
    view.root.querySelector('.vc-bar').replaceWith(controls());
  }
  const seen = new Set();
  for (const person of people) {
    seen.add(person.userId);
    let t = view.tiles.get(person.userId);
    if (!t) {
      t = tile(person);
      view.tiles.set(person.userId, t);
    }
    updateTile(t, person);
  }
  for (const [userId, t] of view.tiles) if (!seen.has(userId)) { t.el.remove(); view.tiles.delete(userId); }
  const ordered = people.map((p) => view.tiles.get(p.userId).el);
  if (ordered.some((el, i) => grid.children[i] !== el)) grid.replaceChildren(...ordered);
  const cols = Math.ceil(Math.sqrt(Math.max(people.length, 1)));
  grid.style.setProperty('--cols', cols);
  grid.style.setProperty('--rows', Math.ceil(Math.max(people.length, 1) / cols));
}

on('voice voice:media users', render);

export function closeVoiceView() {
  view = null;
}

export function showVoice(container, channel, serverId) {
  const root = h('section', { class: 'chat voice-view', 'aria-label': channel.name });
  container.replaceChildren(root);
  if (view?.channel.id !== channel.id) view = { channel, serverId, tiles: new Map() };
  view.root = root;
  view.channel = channel;
  view.tiles.clear();
  render();
}
