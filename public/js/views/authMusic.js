// Quiet music on the sign-up / log-in screen, with a small "now playing" tag and a mute button in the
// bottom left of the art. It fades out once you're signed in. Browsers only allow sound after a click or
// key press, so it starts on the first one if it couldn't start straight away. Muting is remembered.
import { h } from '../dom.js';
import { icon } from '../icons.js';

const TRACK = { src: '/audio/burn-this-shit-down.mp3', title: 'Burn This Shit Down', artist: 'Travis Scott' };
const START_AT = 20; // seconds into the song
// Volume over time: a quick fade in to a whisper, then slowly a little louder.
const FADE_IN = { ms: 2500, to: 0.12 };
const RISE = { ms: 10000, to: 0.4 };
const MUTE_KEY = 'oc:authMusicMuted';

const readMuted = () => { try { return localStorage.getItem(MUTE_KEY) === '1'; } catch { return false; } };
const saveMuted = (on) => { try { localStorage.setItem(MUTE_KEY, on ? '1' : '0'); } catch { /* storage off */ } };

export function authMusic() {
  const audio = new Audio(TRACK.src);
  audio.loop = true;
  audio.volume = 0;
  audio.addEventListener('loadedmetadata', () => { audio.currentTime = START_AT; }, { once: true });
  // Rises once it's really playing; stops rising when it fades out.
  let rising = 0;
  audio.addEventListener('playing', () => {
    if (rising) return;
    const began = performance.now();
    const step = (now) => {
      if (!rising) return;
      const t = now - began;
      audio.volume = t < FADE_IN.ms
        ? FADE_IN.to * (t / FADE_IN.ms)
        : FADE_IN.to + (RISE.to - FADE_IN.to) * Math.min(1, (t - FADE_IN.ms) / RISE.ms);
      if (t < FADE_IN.ms + RISE.ms) rising = requestAnimationFrame(step);
    };
    rising = requestAnimationFrame(step);
  }, { once: true });
  let muted = readMuted();

  const toggle = h('button', { type: 'button', class: 'auth-music-toggle', onclick: () => setMuted(!muted) });
  const el = h('div', { class: 'auth-music' },
    toggle,
    h('span', { class: 'auth-music-text' }, `${TRACK.artist} – ${TRACK.title}`));

  function setMuted(on) {
    muted = on;
    saveMuted(on);
    audio.muted = on;
    toggle.replaceChildren(icon(on ? 'volumeOff' : 'volume', 13));
    toggle.title = on ? 'Unmute' : 'Mute';
    toggle.setAttribute('aria-label', toggle.title);
    if (!on) start();
  }

  // Blocked until the page has been clicked or typed in: try again on the first one.
  const start = () => audio.play().catch(() => {
    const retry = () => { removeEventListener('pointerdown', retry, true); removeEventListener('keydown', retry, true); audio.play().catch(() => {}); };
    addEventListener('pointerdown', retry, true);
    addEventListener('keydown', retry, true);
  });

  setMuted(muted);

  // Fades to silence over `ms`, then stops (used just before the app opens).
  function fadeOut(ms = 1200) {
    return new Promise((resolve) => {
      cancelAnimationFrame(rising);
      rising = 0;
      if (audio.paused || muted) { audio.pause(); return resolve(); }
      const from = audio.volume;
      const began = performance.now();
      const step = (now) => {
        const t = Math.min(1, (now - began) / ms);
        audio.volume = from * (1 - t);
        if (t < 1) requestAnimationFrame(step);
        else { audio.pause(); resolve(); }
      };
      requestAnimationFrame(step);
    });
  }

  return { el, fadeOut };
}
