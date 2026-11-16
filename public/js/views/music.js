// A music or video channel: a shared queue of YouTube videos and uploaded files. Everyone hears (and sees) the
// same thing at the same point: the server only stores what's playing and when it started (or was paused), and
// each player steers itself to match. Browsers don't let sound start by itself, so you press Listen / Watch first.
// A video channel shows the video big and adds the browser (views/video.js) below the queue.
import * as api from '../api.js';
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { state, on, can, canPostIn } from '../store.js';
import { showNav } from '../router.js';
import { attempt, avatar, emptyList, iconButton, toast } from '../ui.js';
import { ensureMembers } from './members.js';
import { remote, openPopover, closeFunPicker } from '../fun.js';
import { mountVideoBrowser, closeVideoBrowser } from './video.js';

let view = null; // { root, channel, serverId, music, offset, listening, player, playerFor, progress, timer }

// A steady clock: changes to the computer's own clock (NTP, the user) don't move it. The offset turns it into the
// server's clock.
const perfNow = () => performance.timeOrigin + performance.now();
const clock = () => perfNow() + (view?.offset || 0);
const fmt = (s) => (Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '–:––');

export function closeMusic() {
  // Browsing away hides the page (the shell collapses it); keep the player and sync running so the music plays on.
  updateMusicDock();
}

function teardownMusic() {
  if (!view) return;
  stopListenHeartbeat();
  if (view.listening) sendListening(false);
  clearInterval(view.timer);
  clearInterval(view.clockTimer);
  window.removeEventListener('message', onPlayerMessage);
  document.removeEventListener('visibilitychange', onVisibility);
  closeFunPicker();
  closeVideoBrowser();
  view.audioCtx?.close?.().catch(() => {});
  view.player?.remove();
  view.root.replaceChildren();
  view = null;
  updateMusicDock();
}

const isVideo = () => view?.channel.kind === 'video';
// The learned seek lead is per kind of player: YouTube, or a file (<audio>/<video>).
const leadKey = (item) => (item.kind === 'youtube' ? 'youtube' : 'audio');

const current = () => view?.music?.playing && view.music.queue.find((q) => q.id === view.music.playing.itemId);

// Where the track should be right now, in seconds of the track (the shared speed is part of it).
function position() {
  const p = view.music?.playing;
  if (!p) return 0;
  return Math.max(0, (((p.pausedAt || clock()) - p.startedAt) / 1000) * (p.rate || 1));
}

const rate = () => view.music?.playing?.rate || 1;

// Where the player should be right now: the shared position, plus this device's output latency when playing,
// so the sound that actually leaves the speaker lines up (Bluetooth and some OSes add a delay the server can't see).
// The device's own sound delay: what the browser reports, plus the listener's own "Sound timing" adjustment for
// delay it can't see (Bluetooth, some phones).
const soundDelay = () => (view?.outputLatency || 0) + (view?.delay || 0);
const target = () => position() + (view?.music?.playing?.pausedAt ? 0 : soundDelay() * rate());

// The player's own position, carried forward from its last real report at the speed it's really playing at.
// null when we don't know (no report yet, or one from before a seek).
function playerPosition() {
  const p = view?.progress;
  if (!p || !Number.isFinite(p.time) || !p.at) return null;
  if (p.state !== 1) return p.time;
  return p.time + ((performance.now() - p.at) / 1000) * (p.rate || view.appliedRate || rate());
}

// Volume is each listener's own, remembered in this browser.
function savedVolume() {
  try { const v = Number(localStorage.getItem('oc:musicVolume')); return Number.isFinite(v) && localStorage.getItem('oc:musicVolume') !== null ? v : 0.8; } catch { return 0.8; }
}
function applyVolume() {
  if (!view?.player) return;
  if (view.player.tagName === 'AUDIO') view.player.volume = view.volume;
  else ytCommand('setVolume', [Math.round(view.volume * 100)]);
}

// "Sound timing": this device's extra delay, in seconds. Some speakers (Bluetooth above all) play the sound later
// than the browser knows, so that device sounds behind the rest; the listener nudges this until the echo is gone.
// Remembered in this browser only, since it belongs to this device's speaker.
const DELAY_MIN = -0.3;
const DELAY_MAX = 0.5;
const DELAY_STEP = 0.005;

function savedDelay() {
  try { const v = Number(localStorage.getItem('oc:musicDelay')); return Number.isFinite(v) ? Math.max(DELAY_MIN, Math.min(DELAY_MAX, v)) : 0; } catch { return 0; }
}

const fmtDelay = (d) => `${d > 0 ? '+' : d < 0 ? '−' : ''}${Math.abs(Math.round(d * 1000))} ms`;

function setDelay(d) {
  if (!view) return;
  view.delay = Math.max(DELAY_MIN, Math.min(DELAY_MAX, Math.round(d * 1000) / 1000));
  try { localStorage.setItem('oc:musicDelay', String(view.delay)); } catch { /* fine */ }
  const value = document.querySelector('.music-pop .music-timing-value'); // the timing lives in the speed panel
  if (value) value.textContent = fmtDelay(view.delay);
  // The sync engine picks the new target up on its next look and nudges the player there smoothly.
}

// − / value / +. Hold a button to keep going; click the value to go back to 0.
function timingControl() {
  let hold = null;
  const release = () => { clearTimeout(hold); clearInterval(hold); hold = null; };
  const stepper = (sign, label) => h('button', {
    type: 'button', class: 'music-timing-step', 'aria-label': label,
    onpointerdown: (event) => {
      event.preventDefault();
      setDelay(view.delay + sign * DELAY_STEP);
      release();
      hold = setTimeout(() => { hold = setInterval(() => setDelay(view.delay + sign * DELAY_STEP), 80); }, 400);
    },
    onpointerup: release, onpointerleave: release, onpointercancel: release,
    // Keyboard presses arrive as clicks with no pointer behind them.
    onclick: (event) => { if (event.detail === 0) setDelay(view.delay + sign * DELAY_STEP); },
  }, sign > 0 ? '+' : '−');
  return h('div', { class: 'music-timing' },
    stepper(-1, 'Play this device a little later'),
    h('button', { type: 'button', class: 'music-timing-value', 'aria-label': 'Sound timing (click to reset)', onclick: () => setDelay(0) }, fmtDelay(view.delay)),
    stepper(1, 'Play this device a little earlier'));
}

// --- automatic sync (no settings): the server's clock, this device's output latency, staying in step ---

function ensureAudioContext() {
  if (view.audioCtx) return;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  try {
    const ctx = new Ctx();
    view.audioCtx = ctx;
    ctx.resume().catch(() => {});
    const read = () => {
      const total = (Number(ctx.baseLatency) || 0) + (Number(ctx.outputLatency) || 0);
      view.outputLatency = Math.max(0, Math.min(0.5, total));
    };
    read();
    ctx.onstatechange = read;
    if (navigator.mediaDevices?.addEventListener) navigator.mediaDevices.addEventListener('devicechange', read);
    setTimeout(read, 300);
  } catch { /* no Web Audio: carry on without the output-latency nudge */ }
}

// Ask the server for its time a few times; the quickest round trips say the most, so take the middle of the best three.
async function syncClock() {
  const v = view;
  if (!v || v.clockBusy) return;
  v.clockBusy = true;
  try {
    const samples = [];
    for (let i = 0; i < 8 && view === v; i++) {
      const t0 = perfNow();
      try {
        const res = await api.get('/api/time');
        const t2 = perfNow();
        const now = Number(res?.now);
        if (Number.isFinite(now)) samples.push({ offset: now - (t0 + t2) / 2, rtt: t2 - t0 });
      } catch { /* one failed ping is fine */ }
    }
    if (!samples.length || view !== v) return;
    samples.sort((a, b) => a.rtt - b.rtt);
    const best = samples.slice(0, 3).map((s) => s.offset).sort((a, b) => a - b);
    v.offset = best[Math.floor(best.length / 2)];
    v.wallGap = Date.now() - perfNow();
    v.clockSynced = true;
    sync(true);
  } finally {
    v.clockBusy = false;
  }
}

function onVisibility() {
  if (document.hidden || !view) return;
  // The computer may have slept: check the clock again.
  syncClock();
  if (view.listening) sync(true);
}

function control(action, extra = {}) {
  const item = current();
  return attempt(() => api.post(`/api/channels/${view.channel.id}/music/control`, { action, itemId: item?.id, ...extra }));
}

function sendListening(on) {
  if (!view) return;
  api.post(`/api/channels/${view.channel.id}/music/listening`, { listening: on }).catch(() => {});
}

function startListenHeartbeat() {
  stopListenHeartbeat();
  if (!view) return;
  sendListening(true);
  view.listenTimer = setInterval(() => sendListening(true), 10000);
}

function stopListenHeartbeat() {
  if (view?.listenTimer) {
    clearInterval(view.listenTimer);
    view.listenTimer = null;
  }
}

function skip10(delta) {
  const forward = delta > 0;
  return h('button', {
    type: 'button', class: 'icon-button music-skip10',
    title: `${forward ? 'Forward' : 'Back'} 10 seconds`, 'aria-label': `${forward ? 'Forward' : 'Back'} 10 seconds`,
    onclick: () => control('seek', { position: Math.max(0, position() + delta) }),
  }, forward ? '+10' : '−10');
}

// --- the player (a YouTube embed driven by postMessage, or an <audio> element) ---

function ytCommand(func, args = []) {
  view?.player?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args }), '*');
}

// Ask the YouTube player to send us its time and state. It only starts once it's ready, so this is repeated
// until reports arrive (and again if they stop).
function ytHandshake() {
  view?.player?.contentWindow?.postMessage(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), '*');
}

function setPlayerState(n) {
  view.progress.state = n;
  if (n === 0) ended();
}

function setReportedRate(r) {
  const s = view.sync;
  view.progress.rate = r;
  // A nudge (say 1.05×) that comes back as something else means this player only takes its preset speeds.
  if (view.appliedRate && view.appliedRate !== rate() && performance.now() - s.rateSetAt > 500) {
    s.fineRate = Math.abs(r - view.appliedRate) < 0.001;
  }
}

function onPlayerMessage(event) {
  if (!view?.player || event.source !== view.player.contentWindow) return;
  let data;
  try { data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data; } catch { return; }
  const pr = view.progress;
  if (data?.event === 'onReady' || data?.event === 'initialDelivery') {
    pr.ready = true;
    sync(true);
  }
  if (data?.event === 'onStateChange' && typeof data.info === 'number') setPlayerState(data.info);
  if (data?.event === 'onPlaybackRateChange' && typeof data.info === 'number') setReportedRate(data.info);
  const info = data?.info;
  if (!info || typeof info !== 'object') return;
  pr.ready = true;
  if (typeof info.playerState === 'number') setPlayerState(info.playerState);
  if (typeof info.playbackRate === 'number') setReportedRate(info.playbackRate);
  if (typeof info.duration === 'number' && info.duration > 0) pr.duration = info.duration;
  if (typeof info.currentTime === 'number') {
    const received = performance.now();
    // Newer players say when they read the time; the message itself can sit in a queue for a while.
    let at = received;
    const stamp = Number(info.currentTimeLastUpdated_) * 1000;
    if (stamp > 1e12) at -= Math.max(0, Math.min(1000, Date.now() - stamp));
    pr.time = info.currentTime;
    pr.at = at;
    pr.received = received;
    sampleDrift();
  }
}

let endedFor = null;
function ended() {
  const item = current();
  if (!item || endedFor === item.id) return;
  endedFor = item.id;
  control('ended');
}

function buildPlayer(item) {
  view.progress = freshProgress();
  view.appliedRate = null;
  resetSync();
  view.sync.builtAt = performance.now();
  if (item.kind === 'youtube') {
    const start = Math.floor(position());
    const src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(item.source)}?enablejsapi=1&autoplay=1&controls=0&disablekb=1&modestbranding=1&rel=0&playsinline=1&start=${start}&origin=${encodeURIComponent(location.origin)}`;
    // YouTube refuses to play (error 153) unless it's told which site the player is on.
    const frame = h('iframe', { class: 'music-frame', src, allow: 'autoplay; encrypted-media', title: item.title, referrerPolicy: 'strict-origin-when-cross-origin' });
    frame.addEventListener('load', () => {
      ytHandshake();
      view.sync.handshakeAt = performance.now();
    });
    return frame;
  }
  const audio = item.kind === 'video'
    ? h('video', { class: 'music-file-video', src: item.source, preload: 'auto', playsInline: true })
    : h('audio', { class: 'music-audio', src: item.source, preload: 'auto' });
  audio.addEventListener('loadedmetadata', () => { view.progress.duration = audio.duration; sync(true); });
  audio.addEventListener('ended', ended);
  return audio;
}

// --- staying in step ---
//
// Each device measures how far its player is from where the song should be (its drift), using only real
// reports from the player, and corrects it:
//   - small drift: play a touch faster or slower, which you can't hear. YouTube only takes speed steps of 0.05,
//     so it gets one step for exactly as long as the gap needs (timed, so it can't overshoot); an <audio>
//     element takes any speed, so it's steered continuously in proportion to the gap;
//   - big drift (or someone seeked): jump, aiming a little ahead to make up for the time the jump itself takes.
//     That lead is learned from how far behind this device's earlier jumps landed.
// Play/pause is checked against what the player really does and sent again if it didn't take; a player that
// won't start (autoplay blocked) asks for a tap instead of retrying forever.

const DEADBAND = 0.012;  // closer than 12 ms is left alone; two speakers start to sound like an echo from about 30 ms
const IN_SYNC = 0.025;   // what the badge calls in sync
const HARD = 0.5;        // further than this, jump instead of nudging (a nudge would take over 10 s)
const MAX_NUDGE = 0.05;  // at most 5% faster or slower (YouTube only takes speeds in 0.05 steps)
const SETTLED = 0.004;   // once an <audio> element is being steered, carry on until this close
const MEASURE_MS = 700;  // after a nudge, let the speed settle before measuring again
const FRESH_MS = 1500;   // a report older than this doesn't say where a playing player is

const freshProgress = () => ({ time: NaN, at: 0, received: 0, duration: NaN, state: undefined, rate: 0, ready: false });

function savedLeads() {
  try { return { youtube: 0, audio: 0, ...JSON.parse(localStorage.getItem('oc:musicLead') || '{}') }; } catch { return { youtube: 0, audio: 0 }; }
}

// Per-player bookkeeping. The learned seek lead and whether YouTube takes fine speeds outlive a track.
function resetSync() {
  const old = view.sync || {};
  view.sync = {
    status: 'syncing', drift: null, samples: [], seek: null, lastSeek: 0, failedSeeks: 0,
    nudge: 0, nudgeUntil: 0, nudgeFrom: null, measureAfter: 0, weakNudges: 0, rateSetAt: 0, cmdAt: 0, cmdTries: 0, handshakeAt: 0, builtAt: 0, blocked: false,
    stateKey: old.stateKey || '', leads: old.leads || savedLeads(), fineRate: old.fineRate ?? null,
  };
}

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

// Called on each real report while playing: remember how far off the player was.
function sampleDrift() {
  const s = view?.sync;
  const pr = view?.progress;
  if (!s || s.seek || s.nudgeUntil || performance.now() < s.measureAfter || pr.state !== 1 || view.music?.playing?.pausedAt) return;
  const pos = playerPosition();
  if (pos == null) return;
  s.samples.push(pos - target());
  if (s.samples.length > 5) s.samples.shift();
}

// Where an <audio> element is, read straight from it.
function readAudio() {
  const audio = view.player;
  const pr = view.progress;
  pr.time = audio.currentTime;
  pr.at = pr.received = performance.now();
  pr.rate = audio.playbackRate;
  pr.ready = audio.readyState >= 1;
  pr.state = audio.ended ? 0 : audio.paused ? 2 : audio.seeking || audio.readyState < 3 ? 3 : 1;
  sampleDrift();
}

function seekPlayer(item, to, playing) {
  const s = view.sync;
  to = Math.max(0, to);
  if (item.kind === 'youtube') ytCommand('seekTo', [to, true]);
  else try { view.player.currentTime = to; } catch { /* not loaded yet */ }
  s.lastSeek = performance.now();
  s.seek = playing ? { at: s.lastSeek } : null;
  s.samples = [];
  s.nudge = 0;
  s.nudgeUntil = 0;
  s.nudgeFrom = null;
  view.progress.at = 0; // the last report says where the player was before the jump, not now
}

function sendPlayPause(item, play) {
  const s = view.sync;
  s.cmdAt = performance.now();
  if (item.kind === 'youtube') return ytCommand(play ? 'playVideo' : 'pauseVideo');
  if (!play) return view.player.pause();
  view.player.play().then(() => { s.blocked = false; }).catch((err) => { if (err?.name === 'NotAllowedError') s.blocked = true; });
}

function applyRate(item) {
  const s = view.sync;
  const base = rate();
  const want = item.kind === 'youtube' ? Math.round((base + s.nudge) * 100) / 100 : base * (1 + s.nudge);
  if (view.appliedRate != null && Math.abs(view.appliedRate - want) < 0.004) return;
  if (item.kind === 'youtube') ytCommand('setPlaybackRate', [want]);
  else view.player.playbackRate = want;
  view.appliedRate = want;
  s.rateSetAt = performance.now();
}

// After a jump, see where the player really landed, and learn from it how far ahead to aim next time.
function settleSeek(item, pos, want) {
  const s = view.sync;
  const err = pos - want; // negative: landed behind
  const leads = s.leads;
  const ideal = Math.max(0, Math.min(3, leads[leadKey(item)] - err));
  leads[leadKey(item)] = leads[leadKey(item)] * 0.5 + ideal * 0.5;
  try { localStorage.setItem('oc:musicLead', JSON.stringify(leads)); } catch { /* fine */ }
  s.failedSeeks = Math.abs(err) > HARD ? s.failedSeeks + 1 : 0;
  s.seek = null;
  s.samples = [err];
}

// YouTube: play one speed step faster (behind) or slower (ahead) for exactly as long as it takes to close the
// gap, since adding 0.05 to the speed gains 0.05 s of song per second.
function startNudge(item, drift) {
  const s = view.sync;
  s.nudge = drift > 0 ? -MAX_NUDGE : MAX_NUDGE;
  s.nudgeUntil = performance.now() + (Math.abs(drift) / MAX_NUDGE) * 1000;
  s.nudgeFrom = Math.abs(drift);
}

function stopNudge() {
  const s = view.sync;
  const was = s.nudge || s.nudgeUntil;
  s.nudge = 0;
  s.nudgeUntil = 0;
  if (was) {
    // Measure afresh: samples from while the speed was changing say nothing about now.
    s.samples = [];
    s.measureAfter = performance.now() + MEASURE_MS;
  }
}

// After a nudge, did the gap really shrink? A YouTube player that ignores odd speeds won't, twice running:
// stop nudging it and use small aimed jumps instead.
function checkNudge(item, far) {
  const s = view.sync;
  if (s.nudgeFrom == null) return;
  if (s.nudgeFrom > 0.03 && far > s.nudgeFrom * 0.7) s.weakNudges += 1;
  else s.weakNudges = 0;
  s.nudgeFrom = null;
  if (item.kind === 'youtube' && s.weakNudges >= 2) s.fineRate = false;
}

// Bring my player in line with the shared state. `force` means something changed (new state from the server,
// the player became ready, the tab came back): look now instead of waiting.
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
    updateSlot();
    if (item.kind !== 'youtube') sendPlayPause(item, !view.music.playing.pausedAt);
    return;
  }
  const s = view.sync;
  const pr = view.progress;
  const youtube = item.kind === 'youtube';
  const now = performance.now();
  const p = view.music.playing;
  const paused = Boolean(p.pausedAt);
  // Someone pressed play, pause, seek or changed the speed.
  const key = `${p.itemId}:${p.startedAt}:${p.pausedAt || ''}:${p.rate || 1}`;
  const changed = key !== s.stateKey;
  s.stateKey = key;
  if (changed) { s.seek = null; s.samples = []; s.failedSeeks = 0; s.cmdTries = 0; stopNudge(); }

  if (!youtube) readAudio();
  // Is the YouTube player talking to us? Until it is (or if it goes quiet while playing), keep asking.
  const quiet = !pr.ready || (!paused && (!pr.received || now - pr.received > FRESH_MS));
  if (youtube && quiet && now - s.handshakeAt > 1000) {
    ytHandshake();
    s.handshakeAt = now;
  }
  if (!pr.ready) { s.status = 'syncing'; return; }
  if (force) applyVolume();
  if (paused) stopNudge();
  applyRate(item);

  // Playing or paused, as it should be? Ask again if not; after a few tries it's waiting for a tap.
  const going = pr.state === 1 || pr.state === 3;
  const right = paused ? !going : going;
  if (right) { s.cmdTries = 0; s.blocked = false; }
  if (force || changed) sendPlayPause(item, !paused);
  else if (!right && pr.state !== 0 && now - s.cmdAt > 1200) {
    sendPlayPause(item, !paused);
    s.cmdTries += 1;
  }
  if (!paused && !right && s.cmdTries >= 3) s.blocked = true;

  // In the middle of a nudge: let it run its course (unless something changed or the player stalled).
  if (s.nudgeUntil) {
    if (!paused && !changed && !force && pr.state === 1 && now < s.nudgeUntil) return;
    stopNudge();
    applyRate(item);
  }

  const pos = playerPosition();
  const want = target();

  if (paused) {
    // Paused: just sit at the right spot.
    if (pos == null ? (force || changed) : Math.abs(pos - want) > 0.25 && (force || changed || now - s.lastSeek > 1500)) seekPlayer(item, want, false);
    s.drift = pos == null ? null : pos - want;
    // A paused YouTube player often stays quiet; that's fine as long as it's paused.
    s.status = right && (s.drift == null || Math.abs(s.drift) <= 0.25) ? 'synced' : 'syncing';
    return;
  }

  // Waiting to see where a jump landed.
  if (s.seek) {
    if (pr.state === 1 && pos != null && pr.received > s.seek.at + 300) settleSeek(item, pos, want);
    else if (now - s.seek.at < 8000) { s.status = s.blocked ? 'blocked' : 'syncing'; return; }
    else { s.seek = null; s.failedSeeks += 1; }
  }

  if (pr.state !== 1 || pos == null || (youtube && now - pr.received > FRESH_MS)) {
    // Buffering, not started, or not reporting: we can't tell where it is, so don't claim it's in step.
    s.drift = null;
    s.status = s.blocked ? 'blocked' : 'syncing';
    // A player that's been silent a long while: a jump usually gets it talking again.
    if (pos == null && (force || changed || now - s.lastSeek > 10000) && now - s.builtAt > 3000) seekPlayer(item, want + s.leads[leadKey(item)], true);
    return;
  }

  // Just after a nudge: wait for the speed to settle before measuring.
  if (now < s.measureAfter) return;
  const measured = s.samples.length >= 3;
  const drift = s.samples.length ? median(s.samples) : pos - want;
  s.drift = drift;
  const far = Math.abs(drift);
  const struggling = s.failedSeeks >= 3;
  const hard = struggling ? 3 : HARD; // jumps keep missing on this device: lean on nudging instead
  const lead = s.leads[leadKey(item)];
  const canNudge = !youtube || s.fineRate !== false;
  s.status = struggling && far > 0.5 ? 'struggling' : far <= (canNudge ? IN_SYNC : 0.1) ? 'synced' : 'syncing';
  if ((force || changed) && far > 0.25 && now - s.lastSeek > 500) seekPlayer(item, want + lead, true);
  else if (far > hard && now - s.lastSeek > 2000) seekPlayer(item, want + lead, true);
  // Small gaps are only acted on once a few reports agree, so one late report can't start a nudge.
  else if (!measured) return;
  else if (!canNudge) {
    // This player only takes its preset speeds: small jumps (aimed with the learned lead) instead.
    if (far > 0.1 && now - s.lastSeek > 6000) seekPlayer(item, want + lead, true);
  } else if (youtube) {
    checkNudge(item, far);
    if (far > DEADBAND) startNudge(item, drift);
  } else {
    // An <audio> element takes any speed but applies changes gradually, so short bursts barely move it: steer
    // continuously instead, a little faster or slower in proportion to the gap, until it's within a few ms.
    s.nudge = far > DEADBAND || (s.nudge && far > SETTLED) ? -Math.max(-MAX_NUDGE, Math.min(MAX_NUDGE, drift / 2)) : 0;
  }
  applyRate(item);
}

// Syncing happens quietly. The one thing that needs the listener: a browser that won't let the music start.
function tapToPlay() {
  return h('button', { type: 'button', class: 'music-tap', hidden: true, onclick: resyncNow }, icon('play', 14), 'Tap to play');
}

function updateTapToPlay() {
  const tap = view?.root.querySelector('.music-tap');
  if (tap) tap.hidden = !view.sync?.blocked;
}

// A tap counts as permission to play, and starts the checks over.
function resyncNow() {
  if (!view?.listening) return;
  ensureAudioContext();
  view.audioCtx?.resume?.().catch(() => {});
  const item = current();
  const s = view.sync;
  if (item && s) {
    if (item.kind !== 'youtube') sendPlayPause(item, !view.music.playing.pausedAt);
    else if (s.blocked && !view.showVideo) toggleVideo(); // YouTube may need a tap on the video itself
    s.failedSeeks = 0;
    s.cmdTries = 0;
    s.handshakeAt = 0;
    if (item.kind === 'youtube') ytHandshake();
  }
  syncClock();
  sync(true);
}

// --- drawing ---

// Video titles carry a lot of noise ("(Official Video) [4K]"); the card shows the short version.
function shortTitle(title) {
  return title.replace(/\s*[([][^)\]]*[)\]]/g, '').replace(/\s+(--|—|\|)\s+.*$/, '').trim() || title;
}

function nowPlaying() {
  const item = current();
  if (!item) {
    return h('section', { class: 'music-now empty' }, isVideo() ? emptyList('video', 'Nothing playing')
      : emptyList('music', 'Nothing playing', view.music?.queue?.length ? 'Pick a song from the playlist below.' : 'Paste a YouTube link below to start.'));
  }
  const paused = Boolean(view.music.playing.pausedAt);
  const adder = state.users.get(item.addedBy);
  const bar = h('div', { class: 'music-bar', role: 'slider', 'aria-label': 'Position', tabIndex: 0 }, h('span', { class: 'music-fill' }));
  const len = view.progress?.duration;
  if (Number.isFinite(len) && len > 0) bar.firstElementChild.style.width = `${Math.min(100, (position() / len) * 100)}%`;
  bar.addEventListener('click', (event) => {
    const box = bar.getBoundingClientRect();
    const duration = view.progress?.duration;
    if (Number.isFinite(duration)) control('seek', { position: ((event.clientX - box.left) / box.width) * duration });
  });
  const video = isVideo();
  // A video channel that's showing the video doesn't need the thumbnail too.
  const art = video && view.listening ? null : item.kind === 'youtube'
    ? h('img', { class: 'music-art', src: `/media/preview-image?url=${encodeURIComponent(`https://i.ytimg.com/vi/${item.source}/hqdefault.jpg`)}`, alt: '' })
    : h('span', { class: 'music-art audio' }, icon(item.kind === 'video' ? 'video' : 'music', 28));
  const youtube = item.kind === 'youtube';
  return h('section', { class: 'music-now' },
    h('div', { class: 'music-info' }, art,
      h('div', { class: 'music-text' },
        h('strong', { title: item.title }, shortTitle(item.title)),
        adder && h('span', { class: 'music-by' }, avatar(adder, { size: 16 }), adder.displayName))),
    h('div', { class: 'music-progress' }, bar,
      h('div', { class: 'music-time' }, h('span', { class: 'music-at' }, fmt(position())), h('span', { class: 'music-length' }, fmt(view.progress?.duration)))),
    h('div', { class: 'music-controls' },
      h('div', { class: 'music-side' },
        view.listening
          ? iconButton(video ? 'video' : 'headphones', video ? 'Stop watching' : 'Stop listening', stopListening, 'on')
          : h('button', { type: 'button', class: 'button accent small music-listen', onclick: startListening }, icon(video ? 'play' : 'headphones', 16), video ? 'Watch' : 'Listen'),
        view.listening && tapToPlay(),
        view.listening && youtube && !video && iconButton('video', view.showVideo ? 'Hide video' : 'Show video', toggleVideo, view.showVideo ? 'on' : ''),
        !video && iconButton('lyrics', view.lyricsOpen ? 'Hide lyrics' : 'Lyrics', toggleLyrics, view.lyricsOpen ? 'on' : '')),
      h('div', { class: 'music-transport' },
        skip10(-10),
        iconButton('skipBack', 'Previous (or restart)', () => control('previous')),
        iconButton(paused ? 'play' : 'pause', paused ? 'Play' : 'Pause', () => control(paused ? 'play' : 'pause'), 'music-main'),
        iconButton('skip', 'Skip', () => control('skip')),
        skip10(10)),
      h('div', { class: 'music-side end' },
        speedButton(),
        volumeButton(),
        video && view.listening && iconButton('monitor', 'Full screen', () => view.slot.requestFullscreen?.().catch(() => {})))));
}

function toggleVideo() {
  view.showVideo = !view.showVideo;
  try { localStorage.setItem('oc:musicVideo', view.showVideo ? '1' : '0'); } catch { /* fine */ }
  render();
}

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

// Speed and volume open small panels instead of crowding the bar.

// Speed (shared: everyone hears the same speed), and this device's sound timing.
function speedButton() {
  const el = h('button', {
    type: 'button', class: `music-speed${rate() !== 1 ? ' on' : ''}`, 'aria-label': `Speed ${rate()}×`, 'aria-haspopup': 'dialog',
    onclick: () => {
      const speeds = h('div', { class: 'music-pop-speeds' }, SPEEDS.map((v) => h('button', {
        type: 'button', 'aria-pressed': String(v === rate()),
        onclick: (event) => {
          for (const b of speeds.children) b.setAttribute('aria-pressed', String(b === event.currentTarget));
          control('rate', { rate: v });
        },
      }, `${v}×`)));
      openPopover(el, 'music-pop', 'Speed and timing', [
        h('span', { class: 'music-pop-label' }, 'Speed'),
        speeds,
        view.listening && h('div', { class: 'music-pop-row' }, h('span', { class: 'music-pop-label' }, 'Timing'), timingControl()),
      ]);
    },
  }, `${rate()}×`);
  return el;
}

// Volume only changes your own player.
function volumeButton() {
  const el = iconButton('volume', 'Volume', () => {
    const slider = h('input', {
      type: 'range', min: 0, max: 1, step: 0.01, value: view.volume, class: 'music-volume', 'aria-label': 'Volume',
      oninput: () => {
        view.volume = Number(slider.value);
        try { localStorage.setItem('oc:musicVolume', String(view.volume)); } catch { /* fine */ }
        slider.style.setProperty('--fill', `${view.volume * 100}%`);
        applyVolume();
      },
    });
    slider.style.setProperty('--fill', `${view.volume * 100}%`);
    if (openPopover(el, 'music-pop music-pop-volume', 'Volume', [slider])) slider.focus();
  });
  el.setAttribute('aria-haspopup', 'dialog');
  return el;
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
  if (item.title === 'YouTube video') { box.lastChild.textContent = 'This video has no title to look lyrics up by.'; return box; }
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
    // Measured against the list itself, so the line lands in the middle of the box whatever is above it.
    const offset = active.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop;
    const top = offset - list.clientHeight / 2 + active.clientHeight / 2;
    // Small steps glide; a big jump (someone seeked) snaps straight there.
    list.scrollTo({ top, behavior: Math.abs(top - list.scrollTop) > list.clientHeight ? 'instant' : 'smooth' });
  }
}

function queueList() {
  const playingId = view.music?.playing?.itemId;
  const input = h('input', { class: 'input', placeholder: 'Add a song: paste a YouTube link', 'aria-label': 'Song link' });
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
  }, icon('plus', 16), input);
  const queue = view.music?.queue || [];
  const at = queue.findIndex((q) => q.id === playingId);
  const paused = Boolean(view.music?.playing?.pausedAt);
  const left = at === -1 ? 0 : queue.length - at - 1;
  const mayRemove = (item) => item.addedBy === state.me.id || can(view.serverId, 'manageMessages');
  const row = (item, i) => {
    const adder = state.users.get(item.addedBy);
    const now = item.id === playingId;
    const played = at !== -1 && i < at;
    const thumb = item.kind === 'youtube'
      ? h('img', { class: 'music-item-art', src: remote(`https://i.ytimg.com/vi/${item.source}/default.jpg`), alt: '', loading: 'lazy' })
      : h('span', { class: 'music-item-art audio' }, icon(item.kind === 'video' ? 'video' : 'music', 16));
    return h('div', { class: `music-item${now ? ' now' : ''}${played ? ' played' : ''}` },
      h('button', {
        type: 'button', class: 'music-item-play', title: now ? 'Playing now' : 'Play this', 'aria-label': `Play ${item.title}`,
        onclick: () => { if (!now) attempt(() => api.post(`/api/channels/${view.channel.id}/music/control`, { action: 'jump', itemId: item.id })); },
      },
      h('span', { class: 'music-n' }, now ? h('span', { class: `music-eq${paused ? ' paused' : ''}` }, h('i'), h('i'), h('i')) : h('span', { class: 'music-n-num' }, i + 1), !now && h('span', { class: 'music-n-play' }, icon('play', 14))),
      thumb,
      h('span', { class: 'music-item-text' }, h('strong', { title: item.title }, shortTitle(item.title)), h('span', {}, adder?.displayName || ''))),
      mayRemove(item) && iconButton('x', `Remove ${item.title}`, () => attempt(() => api.del(`/api/channels/${view.channel.id}/music/${item.id}`)), 'music-item-remove'));
  };
  // A video channel adds through the browser below (search, or paste a link there).
  if (isVideo()) {
    return queue.length > 0 && h('section', { class: 'music-queue' },
      h('div', { class: 'music-queue-head' }, h('h3', {}, 'Queue'), left > 0 && h('span', { class: 'muted' }, `${left} up next`)),
      h('div', { class: 'music-list' }, queue.map(row)));
  }
  return h('section', { class: 'music-queue' },
    h('div', { class: 'music-queue-head' }, h('h3', {}, 'Playlist'),
      queue.length > 0 && h('span', { class: 'muted' }, at === -1 ? `${queue.length} song${queue.length === 1 ? '' : 's'}` : left ? `${left} up next` : 'Last song')),
    queue.length > 0 && h('div', { class: 'music-list' }, queue.map(row)),
    canAdd ? add : h('p', { class: 'muted' }, 'Only some roles can add songs here.'),
    at === -1 && queue.length > 0 && h('p', { class: 'music-hint' }, 'The playlist finished. Tap any song to play it again.'));
}

// The player lives in its own slot that redraws never touch: moving an embed in the page reloads it,
// which would restart the song.
function render() {
  if (!view?.root.isConnected) return;
  updateMusicDock();
  if (view.root.classList.contains('collapsed')) return;
  const { channel } = view;
  if (!view.shell) {
    view.head = h('div');
    view.slot = h('div', { class: 'music-player-slot' });
    view.content = h('div');
    // A video channel's browser keeps its own state (search, results), so redraws here never touch it.
    view.browse = h('div', { class: 'music-browse' });
    view.body = h('div', { class: `page-scroll music-scroll${isVideo() ? ' video-channel' : ''}` }, view.slot, view.content, view.browse);
    view.shell = true;
    view.root.replaceChildren(view.head, view.body);
  }
  updateSlot();
  view.head.replaceChildren(h('header', { class: 'main-header' },
    iconButton('back', 'Back', () => showNav(), 'back-button'),
    h('div', { class: 'main-title' }, icon(isVideo() ? 'video' : 'music', 18), h('span', {}, channel.name)),
    channel.topic ? h('div', { class: 'main-topic', title: channel.topic }, channel.topic) : h('div', { class: 'main-spacer' })));
  const scroll = view.body.scrollTop;
  // The lyrics box only redraws when the song changes, so it doesn't jump back to the top.
  const item = current();
  if (!view.lyricsOpen || !item) view.lyricsBox = null;
  else if (!view.lyricsBox || view.lyricsFor !== item?.id) {
    view.lyricsBox = lyricsPanel();
    view.lyricsFor = item?.id;
    view.activeLine = null;
  }
  view.content.replaceChildren(h('div', { class: 'music-page' }, nowPlaying(), view.lyricsBox || '', queueList() || ''));
  if (isVideo()) {
    mountVideoBrowser(view.browse, {
      channel, serverId: view.serverId, canAdd: () => canPostIn(view.serverId, view.channel),
      play: (item) => addVideo(item, true), queue: (item) => addVideo(item, false),
    });
  }
  view.body.scrollTop = scroll;
  updateTapToPlay();
}

// The video sits above the card when shown. Hidden, it stays in the page (tiny and invisible) so the
// sound keeps playing.
function updateSlot() {
  if (!view?.slot) return;
  const visual = view.listening && current() && current().kind !== 'audio';
  view.slot.hidden = !visual;
  view.slot.classList.toggle('collapsed', !isVideo() && !view.showVideo);
}

// A video from the browser: played for everyone now (and this device starts watching), or added to the queue.
async function addVideo(item, playNow) {
  const v = view;
  const body = item.kind === 'youtube'
    ? { url: `https://www.youtube.com/watch?v=${item.source}`, title: item.title }
    : { url: item.source };
  const done = await attempt(() => api.post(`/api/channels/${v.channel.id}/music`, { ...body, playNow }));
  if (!done || view !== v) return false;
  if (playNow) {
    if (!v.listening) startListening();
    v.body.scrollTo({ top: 0, behavior: 'smooth' });
  }
  return true;
}

function startListening() {
  if (!view) return;
  ensureAudioContext();
  view.listening = true;
  startListenHeartbeat();
  render();
  sync(true);
}

// The little player above the user panel: thumbnail, title and a stop button. The real player stays in the page
// (collapsed, not removed) so it never reloads; this only mirrors its state.
export function updateMusicDock() {
  const dock = document.getElementById('music-dock');
  if (!dock) return;
  const item = current();
  if (!view?.listening || !item) {
    dock.hidden = true;
    dock.replaceChildren();
    dock.dataset.key = '';
    return;
  }
  const paused = Boolean(view.music.playing.pausedAt);
  const key = `${item.id}:${paused}`;
  if (!dock.hidden && dock.dataset.key === key) return;
  dock.dataset.key = key;
  dock.hidden = false;
  const art = item.kind === 'youtube'
    ? h('img', { class: 'music-dock-thumb', src: `/media/preview-image?url=${encodeURIComponent(`https://i.ytimg.com/vi/${item.source}/hqdefault.jpg`)}`, alt: '', loading: 'lazy' })
    : h('span', { class: 'music-dock-thumb audio' }, icon(item.kind === 'video' ? 'video' : 'music', 20));
  dock.replaceChildren(
    art,
    h('div', { class: 'music-dock-text' },
      h('strong', { class: 'music-dock-title', title: item.title }, shortTitle(item.title)),
      h('span', { class: 'music-dock-sub' }, paused ? 'Paused' : 'Playing')),
    iconButton(paused ? 'play' : 'pause', paused ? 'Play' : 'Pause', () => control(paused ? 'play' : 'pause')),
    iconButton(isVideo() ? 'video' : 'headphones', isVideo() ? 'Stop watching' : 'Stop listening', stopListening, 'on'));
}

function stopListening() {
  if (!view) return;
  view.listening = false;
  stopListenHeartbeat();
  sendListening(false);
  view.player?.remove();
  view.player = null;
  view.playerFor = null;
  updateMusicDock();
  render();
}

// The time and bar move on their own between updates.
function tick() {
  if (!view?.root.isConnected) return;
  // The computer's clock jumped (sleep, a clock change): measure the server's clock again.
  if (view.clockSynced && Math.abs(Date.now() - perfNow() - view.wallGap) > 300) {
    view.wallGap = Date.now() - perfNow();
    syncClock();
  }
  if (view.listening) {
    sync();
    updateTapToPlay();
    // An audio file reports its own end; for YouTube, also end when the time runs out (in case the embed can't say).
    if (Number.isFinite(view.progress?.duration) && !view.music?.playing?.pausedAt && position() > view.progress.duration + 3) ended();
  }
  if (view.root.classList.contains('collapsed')) return;
  const at = view.root.querySelector('.music-at');
  if (!at) return;
  // The player runs ahead by this device's output latency so the sound lands on time; the words and the
  // progress bar follow what is actually being heard, so subtract it back out.
  const mine = view.listening ? playerPosition() : null;
  const heard = mine != null && mine > 0 ? Math.max(0, mine - soundDelay() * rate()) : position();
  at.textContent = fmt(heard);
  if (view.lyricsOpen) followLyrics(heard);
  view.root.querySelector('.music-length').textContent = fmt(view.progress?.duration);
  const fill = view.root.querySelector('.music-fill');
  if (fill) fill.style.width = Number.isFinite(view.progress?.duration) ? `${Math.min(100, (heard / view.progress.duration) * 100)}%` : '0%';
}

function apply(music) {
  if (!view.clockSynced) view.offset = music.now - perfNow();
  view.music = music;
  render();
  sync(true);
}

on('music:update', (music) => {
  if (music.channelId === view?.channel.id) apply(music);
});
on('users members', () => view && render());
on('reload', () => { if (view) syncClock(); }); // reconnected: the clock may have moved
on('reload', () => view && api.get(`/api/channels/${view.channel.id}/music`).then(apply).catch(() => {}));

export async function showMusic(container, channel, serverId) {
  if (view?.channel.id === channel.id && view.root === container && container.isConnected) {
    view.channel = channel;
    return render();
  }
  if (view) teardownMusic();
  view = { root: container, shell: false, channel, serverId, music: null, offset: 0, wallGap: 0, sync: null, clockSynced: false, outputLatency: 0, delay: savedDelay(), audioCtx: null, listenTimer: null, listening: false, player: null, playerFor: null, progress: freshProgress(), volume: savedVolume(), lyricsOpen: false, showVideo: (() => { try { return localStorage.getItem('oc:musicVideo') !== '0'; } catch { return true; } })() };
  window.addEventListener('message', onPlayerMessage);
  document.addEventListener('visibilitychange', onVisibility);
  view.timer = setInterval(tick, 250);
  ensureMembers(serverId);
  render();
  const music = await api.get(`/api/channels/${channel.id}/music`).catch((err) => { toast(err.message); return null; });
  if (music && view?.channel.id === channel.id) apply(music);
  syncClock();
  view.clockTimer = setInterval(syncClock, 60000);
  return undefined;
}
