// Voice messages: record from the microphone right inside the message box, then send as an audio file named
// "voice-message…". Those files show as a round play button and a waveform instead of the plain audio player.
import { h } from './dom.js';
import { icon } from './icons.js';
import { iconButton, toast } from './ui.js';

export const isVoiceMessage = (attachment) => attachment.kind === 'audio' && /^voice-message/.test(attachment.name);

const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const MAX_SECONDS = 10 * 60;

// Shows a recording bar over the composer. onDone(file) is called with the recording when it's sent.
export async function recordVoice(composer, onDone) {
  if (composer.querySelector('.voice-recorder')) return;
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    toast('This browser can’t record audio.');
    return;
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  } catch {
    toast('The microphone is blocked. Allow it for this site, then try again.');
    return;
  }
  const type = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'].find((t) => MediaRecorder.isTypeSupported(t)) || '';
  const recorder = new MediaRecorder(stream, type ? { mimeType: type } : {});
  const chunks = [];
  recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };

  // A live level meter while recording.
  const ctx = new AudioContext();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 256;
  ctx.createMediaStreamSource(stream).connect(analyser);
  const levels = new Uint8Array(analyser.frequencyBinCount);
  // Drawn like a sent voice message's waveform: same bars, scaled so the loudest one fills the height.
  const bars = h('div', { class: 'voice-wave voice-rec-bars' }, Array.from({ length: 48 }, () => h('span', { class: 'played', style: { height: '10%' } })));
  const time = h('span', { class: 'voice-rec-time' }, '0:00');
  const started = Date.now();
  let frame = 0;
  const history = [];
  // Loudness is read every frame, but a new bar only comes in every STEP ms (the loudest bit of that slice),
  // on a fixed scale, so the bars move at a steady pace and don't resize as you talk.
  const STEP = 120;
  let slicePeak = 0;
  let sliceStart = Date.now();
  const tick = () => {
    analyser.getByteTimeDomainData(levels);
    for (const v of levels) slicePeak = Math.max(slicePeak, Math.abs(v - 128) / 128);
    if (Date.now() - sliceStart >= STEP) {
      history.push(Math.min(1, Math.sqrt(slicePeak) * 1.15)); // sqrt lifts quiet speech so it's still visible
      if (history.length > 48) history.shift();
      slicePeak = 0;
      sliceStart = Date.now();
      const offset = 48 - history.length; // new sound comes in from the right
      [...bars.children].forEach((bar, i) => {
        const p = history[i - offset];
        bar.style.height = `${p === undefined ? 10 : Math.max(10, p * 100)}%`;
      });
    }
    const secs = (Date.now() - started) / 1000;
    time.textContent = fmt(secs);
    if (secs >= MAX_SECONDS) finish(true);
    else frame = requestAnimationFrame(tick);
  };

  let done = false;
  function finish(send) {
    if (done) return;
    done = true;
    cancelAnimationFrame(frame);
    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      ctx.close().catch(() => {});
      bar.remove();
      if (!send || !chunks.length) return;
      const mime = (recorder.mimeType || type || 'audio/webm').split(';')[0];
      const ext = mime.includes('ogg') ? 'ogg' : mime.includes('mp4') ? 'm4a' : 'webm';
      const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
      onDone(new File(chunks, `voice-message-${stamp}.${ext}`, { type: mime === 'audio/mp4' ? 'audio/mp4' : mime }));
    };
    recorder.stop();
  }

  const bar = h('div', { class: 'voice-recorder', role: 'status', 'aria-label': 'Recording a voice message' },
    iconButton('trash', 'Cancel', () => finish(false), 'danger'),
    h('span', { class: 'voice-rec-dot' }), time, bars,
    h('button', { type: 'button', class: 'button accent small', onclick: () => finish(true) }, icon('send', 15), 'Send'));
  composer.append(bar);
  recorder.start(250);
  tick();
}

// --- the player ---

const peaksCache = new Map(); // url → Promise<number[]>

function peaksFor(url, count = 48) {
  if (!peaksCache.has(url)) {
    peaksCache.set(url, (async () => {
      const data = await (await fetch(url)).arrayBuffer();
      const ctx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, 44100, 44100);
      const audio = await ctx.decodeAudioData(data);
      const samples = audio.getChannelData(0);
      const size = Math.floor(samples.length / count) || 1;
      const peaks = [];
      for (let i = 0; i < count; i += 1) {
        let max = 0;
        for (let j = i * size; j < (i + 1) * size && j < samples.length; j += 16) max = Math.max(max, Math.abs(samples[j]));
        peaks.push(max);
      }
      const top = Math.max(...peaks, 0.01);
      return { peaks: peaks.map((p) => p / top), duration: audio.duration };
    })().catch(() => null));
  }
  return peaksCache.get(url);
}

export function voiceMessageView(attachment) {
  const audio = h('audio', { src: attachment.url, preload: 'none' });
  const wave = h('div', { class: 'voice-wave' }, Array.from({ length: 48 }, () => h('span', { style: { height: '20%' } })));
  const time = h('span', { class: 'voice-time' }, '0:00');
  const speedButton = h('button', { type: 'button', class: 'voice-speed', title: 'Playback speed' }, '1×');
  let duration = 0;
  const playButton = h('button', { type: 'button', class: 'voice-play', 'aria-label': 'Play voice message' }, icon('play', 18));

  let drawn = false;
  const draw = async () => {
    if (drawn) return;
    drawn = true;
    const info = await peaksFor(attachment.url);
    if (!info) return;
    duration = info.duration;
    time.textContent = fmt(Math.round(duration));
    info.peaks.forEach((p, i) => { wave.children[i].style.height = `${Math.max(10, p * 100)}%`; });
  };
  // Load the waveform once the message is on screen.
  const seen = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) { seen.disconnect(); draw(); }
  });
  seen.observe(wave);

  const progress = () => {
    const d = Number.isFinite(audio.duration) ? audio.duration : duration;
    const at = d ? audio.currentTime / d : 0;
    [...wave.children].forEach((bar, i) => bar.classList.toggle('played', i / wave.children.length < at));
    time.textContent = fmt(audio.paused && !audio.currentTime ? d : audio.currentTime);
  };
  audio.addEventListener('timeupdate', progress);
  audio.addEventListener('play', () => playButton.replaceChildren(icon('pause', 18)));
  audio.addEventListener('pause', () => playButton.replaceChildren(icon('play', 18)));
  audio.addEventListener('ended', () => { audio.currentTime = 0; progress(); });
  playButton.addEventListener('click', () => {
    // Only one voice message plays at a time.
    for (const other of document.querySelectorAll('.voice-message audio')) if (other !== audio) other.pause();
    if (audio.paused) audio.play().catch(() => toast('Couldn’t play that.'));
    else audio.pause();
  });
  wave.addEventListener('click', (event) => {
    const box = wave.getBoundingClientRect();
    const d = Number.isFinite(audio.duration) ? audio.duration : duration;
    if (!d) return;
    audio.currentTime = ((event.clientX - box.left) / box.width) * d;
    if (audio.paused) audio.play().catch(() => {});
  });
  const SPEEDS = [1, 1.5, 2];
  speedButton.addEventListener('click', () => {
    audio.playbackRate = SPEEDS[(SPEEDS.indexOf(audio.playbackRate) + 1) % SPEEDS.length];
    speedButton.textContent = `${audio.playbackRate}×`;
  });
  return h('div', { class: 'voice-message' }, playButton, wave, time, speedButton, audio);
}
