// The main area for a voice channel: a grid of tiles (camera, screen or avatar on a colour) and the
// call controls along the bottom, or a "join" screen when you're not in the call yet.
import { h } from '../dom.js';
import { showNav } from '../router.js';
import { icon } from '../icons.js';
import { state, on } from '../store.js';
import { avatar, iconButton } from '../ui.js';
import {
  voice, joinVoice, leaveVoice, toggleMute, toggleDeafen, toggleCamera, toggleScreen, localVideoStream, peerStream,
  flipCamera, toggleTorch, isSpeaking,
} from '../voice.js';
import { openProfile } from './profile.js';

let view = null; // { root, channel, serverId, tiles: Map(userId → tile), focus: userId shown big, or null }

function videoFor(person) {
  if (person.userId === state.me.id) return voice.video ? localVideoStream() : null;
  if (!person.video && !person.screen) return null;
  const stream = peerStream(person.userId);
  return stream?.getVideoTracks().some((t) => t.readyState === 'live') ? stream : null;
}

// Clicking a tile shows it big with the others in a strip underneath; clicking it again goes back to the grid.
function toggleFocus(userId) {
  view.focus = view.focus === userId ? null : userId;
  render();
}

function tile(person) {
  const user = state.users.get(person.userId) || { id: person.userId, displayName: 'Someone', username: '' };
  const video = h('video', { autoplay: true, playsInline: true, muted: true });
  const face = h('div', { class: 'vt-face' }, avatar(user, { size: 96 }));
  const status = h('span', { class: 'vt-status' });
  const label = h('div', { class: 'vt-label' }, h('span', { class: 'vt-name' }, status, user.displayName));
  const el = h('div', {
    class: 'vt', role: 'button', tabIndex: 0, 'aria-label': user.displayName,
    onclick: () => toggleFocus(person.userId),
    onkeydown: (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggleFocus(person.userId); } },
    oncontextmenu: (event) => { event.preventDefault(); openProfile(user); },
  }, face, video, label);
  return { el, video, face, status, user, stream: null };
}

function updateTile(t, person) {
  const stream = videoFor(person);
  if (stream !== t.stream) {
    t.stream = stream;
    t.video.srcObject = stream;
  }
  if (stream && t.video.paused) t.video.play().catch(() => {});
  const me = person.userId === state.me.id;
  const speaking = me ? isSpeaking() : Boolean(person.speaking) && !person.muted;
  t.el.classList.toggle('has-video', Boolean(stream));
  t.el.classList.toggle('screen', Boolean(stream) && (me ? voice.video === 'screen' : person.screen));
  t.el.classList.toggle('mirror', Boolean(stream) && me && voice.video === 'camera' && voice.facing !== 'environment');
  t.el.classList.toggle('speaking', speaking);
  t.el.classList.toggle('focus', view.focus === person.userId);
  t.status.replaceChildren(icon(person.deafened ? 'headphonesOff' : person.muted ? 'micOff' : 'mic', 13));
  t.el.title = `${t.user.displayName} · click to ${view.focus === person.userId ? 'go back to the grid' : 'make big'}`;
}

function controls() {
  const button = (name, label, onclick, extra = '') => h('button', { type: 'button', class: `vc-button ${extra}`, title: label, 'aria-label': label, onclick }, icon(name, 20));
  return h('div', { class: 'vc-bar' },
    button(voice.muted ? 'micOff' : 'mic', voice.muted ? 'Unmute' : 'Mute', toggleMute, voice.muted ? 'off' : ''),
    button(voice.video === 'camera' ? 'video' : 'videoOff', voice.video === 'camera' ? 'Turn camera off' : 'Turn camera on', toggleCamera, voice.video === 'camera' ? 'on' : ''),
    button(voice.deafened ? 'headphonesOff' : 'headphones', voice.deafened ? 'Undeafen' : 'Deafen', toggleDeafen, voice.deafened ? 'off' : ''),
    button('monitor', voice.video === 'screen' ? 'Stop sharing' : 'Share your screen', toggleScreen, voice.video === 'screen' ? 'on' : ''),
    voice.video === 'camera' && voice.canFlip && button('flipCamera', 'Switch camera', flipCamera),
    voice.video === 'camera' && voice.torch !== null && button(voice.torch ? 'flashlight' : 'flashlightOff', voice.torch ? 'Turn light off' : 'Turn light on', toggleTorch, voice.torch ? 'on' : ''),
    button('phoneOff', 'Leave call', leaveVoice, 'leave'));
}

function render() {
  if (!view?.root.isConnected) return;
  const { channel } = view;
  const people = state.voice.get(channel.id) || [];
  const inCall = voice.channelId === channel.id && !voice.connecting;
  const header = h('header', { class: 'main-header' },
    iconButton('back', 'Back', () => showNav(), 'back-button'),
    h('div', { class: 'main-title' }, icon('volume', 18), h('span', {}, channel.name)),
    h('div', { class: 'main-spacer' }));

  if (view.compact) view.root.hidden = !inCall && !people.length;
  if (!inCall && view.compact) {
    // A DM: just a slim bar saying who's in the call, with a button to join.
    view.tiles.clear();
    const names = people.map((p) => state.users.get(p.userId)?.displayName || 'Someone');
    view.root.replaceChildren(...(people.length ? [h('div', { class: 'call-bar' },
      h('span', { class: 'call-bar-faces' }, people.slice(0, 4).map((p) => avatar(state.users.get(p.userId) || { id: p.userId, displayName: '?' }, { size: 28 }))),
      h('span', { class: 'call-bar-text' }, `${names.slice(0, 3).join(', ')} ${people.length === 1 ? 'is' : 'are'} in a call`),
      h('button', { type: 'button', class: 'button accent small', disabled: voice.connecting, onclick: () => joinVoice(channel) },
        icon('phone', 16), voice.connecting ? 'Joining…' : 'Join'))] : []));
    return;
  }
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
    view.root.replaceChildren(h('div', { class: 'vc-call' }, !view.compact && iconButton('back', 'Back', () => showNav(), 'back-button vc-back'), h('div', { class: 'vc-stage' }, grid), controls()));
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
  if (view.focus && !seen.has(view.focus)) view.focus = null;
  const ordered = people.map((p) => view.tiles.get(p.userId).el);
  if (view.focus) {
    // One big tile, the rest in a strip along the bottom.
    const big = view.tiles.get(view.focus).el;
    const rest = ordered.filter((el) => el !== big);
    let strip = grid.querySelector(':scope > .vc-strip');
    if (!strip) strip = h('div', { class: 'vc-strip' });
    grid.classList.add('focused');
    if (grid.firstChild !== big || grid.children[1] !== (rest.length ? strip : undefined)) grid.replaceChildren(big, ...(rest.length ? [strip] : []));
    if (rest.some((el, i) => strip.children[i] !== el) || strip.children.length !== rest.length) strip.replaceChildren(...rest);
  } else {
    grid.classList.remove('focused');
    if (ordered.length !== grid.children.length || ordered.some((el, i) => grid.children[i] !== el)) grid.replaceChildren(...ordered);
    const cols = Math.ceil(Math.sqrt(Math.max(people.length, 1)));
    grid.style.setProperty('--cols', cols);
    grid.style.setProperty('--rows', Math.ceil(Math.max(people.length, 1) / cols));
  }
  // Moving a video in the page can pause it.
  for (const t of view.tiles.values()) if (t.stream && t.video.paused) t.video.play().catch(() => {});
}

on('voice voice:media voice:speaking users', render);

export function closeVoiceView() {
  view = null;
}

// The call area at the top of a DM: hidden with no call, a bar when others are in one, the full call once you join.
export function mountCallStage(el, channel) {
  view = { channel, serverId: null, tiles: new Map(), focus: null, compact: true, root: el };
  render();
}

export function showVoice(container, channel, serverId) {
  const root = h('section', { class: 'chat voice-view', 'aria-label': channel.name });
  container.replaceChildren(root);
  if (view?.channel.id !== channel.id) view = { channel, serverId, tiles: new Map(), focus: null };
  view.root = root;
  view.channel = channel;
  view.tiles.clear();
  render();
}
