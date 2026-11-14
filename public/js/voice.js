// Voice and video channels: every pair of people in a room connects peer to peer (WebRTC). The server only
// relays the set-up messages, so audio and video never pass through it. Good for rooms of up to ~8 people.
//
// Each pair uses "perfect negotiation": either side can add or remove camera/screen at any time and the
// connection renegotiates itself; when both offer at once, the "polite" side backs off.
import { on, emit, findChannel } from './store.js';
import { voiceEmit, voiceSend } from './realtime.js';
import { toast } from './ui.js';

const ICE = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];

export const voice = {
  channelId: null,
  serverId: null,
  muted: false,
  deafened: false,
  connecting: false,
  video: null, // null, 'camera' or 'screen'
  facing: 'user', // which camera: 'user' (front) or 'environment' (back)
  canFlip: false, // more than one camera
  torch: null, // null when the camera has no light, else whether it's on
};

let mySocket = null;
let mic = null; // MediaStream with the microphone
let videoTrack = null; // the camera or screen track being sent
let localVideo = null; // MediaStream for showing my own camera/screen
const peers = new Map(); // socketId → { pc, audio, stream, userId, polite, makingOffer, ignoreOffer, videoSender }
let level = null;
let speaking = false;

export const localVideoStream = () => localVideo;
export const isSpeaking = () => speaking && !voice.muted;
export const peerStream = (userId) => [...peers.values()].find((p) => p.userId === userId)?.stream || null;

function sendState() {
  voiceSend('voice:update', {
    muted: voice.muted, deafened: voice.deafened, speaking: speaking && !voice.muted,
    video: voice.video === 'camera', screen: voice.video === 'screen',
  });
}

function signal(to, data) {
  voiceSend('voice:signal', { to, data });
}

function peer(socketId, userId) {
  if (peers.has(socketId)) return peers.get(socketId);
  const pc = new RTCPeerConnection({ iceServers: ICE });
  const audio = new Audio();
  audio.autoplay = true;
  audio.muted = voice.deafened;
  const entry = { pc, audio, stream: null, userId, polite: mySocket < socketId, makingOffer: false, ignoreOffer: false, videoSender: null };
  peers.set(socketId, entry);

  for (const track of mic.getAudioTracks()) pc.addTrack(track, mic);
  if (videoTrack) entry.videoSender = pc.addTrack(videoTrack, mic);

  pc.onnegotiationneeded = async () => {
    try {
      entry.makingOffer = true;
      await pc.setLocalDescription();
      signal(socketId, { sdp: pc.localDescription });
    } catch (err) {
      console.warn('voice offer failed', err);
    } finally {
      entry.makingOffer = false;
    }
  };
  pc.onicecandidate = ({ candidate }) => { if (candidate) signal(socketId, { candidate }); };
  pc.ontrack = ({ track, streams }) => {
    entry.stream = streams[0] || entry.stream || new MediaStream();
    if (!entry.stream.getTracks().includes(track)) entry.stream.addTrack(track);
    if (track.kind === 'audio') {
      audio.srcObject = entry.stream;
      audio.play().catch(() => {});
    }
    track.onunmute = () => emit('voice:media');
    track.onmute = () => emit('voice:media');
    entry.stream.onremovetrack = () => emit('voice:media');
    emit('voice:media');
  };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'failed') pc.restartIce();
  };
  return entry;
}

function dropPeer(socketId) {
  const entry = peers.get(socketId);
  if (!entry) return;
  entry.pc.close();
  entry.audio.srcObject = null;
  peers.delete(socketId);
  emit('voice:media');
}

// Lights up the "speaking" ring when the mic level stays above a threshold for a moment.
function watchLevel(stream) {
  const context = new AudioContext();
  const analyser = context.createAnalyser();
  analyser.fftSize = 512;
  context.createMediaStreamSource(stream).connect(analyser);
  const data = new Uint8Array(analyser.frequencyBinCount);
  let quietSince = 0;
  const timer = setInterval(() => {
    analyser.getByteFrequencyData(data);
    const avg = data.reduce((a, b) => a + b, 0) / data.length;
    const now = Date.now();
    if (avg > 18 && !voice.muted) {
      quietSince = now;
      if (!speaking) { speaking = true; sendState(); emit('voice:speaking'); }
    } else if (speaking && now - quietSince > 350) {
      speaking = false;
      sendState();
      emit('voice:speaking');
    }
  }, 100);
  level = { context, timer };
}

export async function joinVoice(channel) {
  if (voice.channelId === channel.id || voice.connecting) return;
  if (voice.channelId) leaveVoice();
  voice.connecting = true;
  voice.channelId = channel.id;
  voice.serverId = channel.serverId || null;
  emit('voice');
  try {
    mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  } catch {
    Object.assign(voice, { connecting: false, channelId: null, serverId: null });
    emit('voice');
    toast('Opencord needs microphone access to join voice. Allow it in your browser and try again.');
    return;
  }
  const result = await voiceEmit('voice:join', channel.id);
  voice.connecting = false;
  if (!result || result.error) {
    mic.getTracks().forEach((t) => t.stop());
    mic = null;
    Object.assign(voice, { channelId: null, serverId: null });
    emit('voice');
    toast(result?.error || 'Could not join voice.');
    return;
  }
  mySocket = result.self;
  mic.getAudioTracks().forEach((t) => { t.enabled = !voice.muted; });
  watchLevel(mic);
  sendState();
  // The newcomer connects to everyone already there; adding tracks starts each negotiation.
  for (const { socketId, userId } of result.peers) peer(socketId, userId);
  emit('voice');
}

export function leaveVoice() {
  if (!voice.channelId) return;
  voiceSend('voice:leave');
  for (const id of [...peers.keys()]) dropPeer(id);
  stopVideo(false);
  mic?.getTracks().forEach((t) => t.stop());
  mic = null;
  if (level) { clearInterval(level.timer); level.context.close(); level = null; }
  speaking = false;
  Object.assign(voice, { channelId: null, serverId: null, connecting: false });
  emit('voice');
}

export function toggleMute() {
  voice.muted = !voice.muted;
  if (!voice.muted && voice.deafened) voice.deafened = false;
  applyAudio();
}

export function toggleDeafen() {
  voice.deafened = !voice.deafened;
  voice.muted = voice.deafened;
  applyAudio();
}

function applyAudio() {
  mic?.getAudioTracks().forEach((t) => { t.enabled = !voice.muted; });
  for (const { audio } of peers.values()) audio.muted = voice.deafened;
  sendState();
  emit('voice');
}

// --- camera and screen share (one video at a time, like a single "video" slot) ---

const CAMERA = { width: { ideal: 1280 }, height: { ideal: 720 } };

async function openCamera(facing, exact = false) {
  return navigator.mediaDevices.getUserMedia({ video: { ...CAMERA, facingMode: exact ? { exact: facing } : facing } });
}

async function cameraInfo(track) {
  const cameras = (await navigator.mediaDevices.enumerateDevices().catch(() => [])).filter((d) => d.kind === 'videoinput');
  voice.canFlip = cameras.length > 1;
  voice.torch = track.getCapabilities?.().torch ? false : null;
}

// Puts a new camera or screen track in the video slot and sends it to everyone.
function useVideoTrack(track, kind) {
  videoTrack = track;
  localVideo = new MediaStream([track]);
  voice.video = kind;
  track.onended = () => { if (videoTrack === track) stopVideo(); };
  for (const entry of peers.values()) {
    if (entry.videoSender) entry.videoSender.replaceTrack(track);
    else entry.videoSender = entry.pc.addTrack(track, mic);
  }
}

async function startVideo(kind) {
  let stream;
  try {
    stream = kind === 'screen'
      ? await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: false })
      : await openCamera(voice.facing);
  } catch {
    if (kind === 'camera') toast('Opencord needs camera access for video. Allow it in your browser and try again.');
    return;
  }
  const track = stream.getVideoTracks()[0];
  stopVideo(false);
  useVideoTrack(track, kind);
  if (kind === 'camera') {
    voice.facing = track.getSettings?.().facingMode || voice.facing;
    await cameraInfo(track);
  } else {
    voice.canFlip = false;
    voice.torch = null;
  }
  sendState();
  emit('voice');
  emit('voice:media');
}

// Front ↔ back camera. Phones often can't open both at once, so the old one stops first.
export async function flipCamera() {
  if (voice.video !== 'camera' || !videoTrack) return;
  const next = voice.facing === 'user' ? 'environment' : 'user';
  const old = videoTrack;
  old.onended = null;
  old.stop();
  let stream = await openCamera(next, true).catch(() => null);
  if (!stream) {
    // No facing information (most laptops): just take the next camera in the list.
    const cameras = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
    const index = cameras.findIndex((d) => d.deviceId === old.getSettings?.().deviceId);
    const other = cameras[(index + 1) % cameras.length];
    stream = await navigator.mediaDevices.getUserMedia({ video: { ...CAMERA, deviceId: { exact: other?.deviceId } } }).catch(() => null);
  }
  if (!stream) {
    stream = await openCamera(voice.facing).catch(() => null);
    if (!stream) { stopVideo(); return; }
    toast("Couldn't switch camera.");
  } else {
    voice.facing = stream.getVideoTracks()[0].getSettings?.().facingMode || next;
  }
  useVideoTrack(stream.getVideoTracks()[0], 'camera');
  await cameraInfo(videoTrack);
  emit('voice');
  emit('voice:media');
}

// The phone's flashlight, when the camera in use has one.
export async function toggleTorch() {
  if (voice.torch === null || !videoTrack) return;
  const on = !voice.torch;
  try {
    await videoTrack.applyConstraints({ advanced: [{ torch: on }] });
    voice.torch = on;
  } catch {
    toast("Couldn't turn the light on.");
  }
  emit('voice');
}

function stopVideo(announce = true) {
  if (!videoTrack) return;
  videoTrack.onended = null;
  videoTrack.stop();
  videoTrack = null;
  localVideo = null;
  voice.video = null;
  voice.torch = null;
  for (const entry of peers.values()) {
    if (entry.videoSender) {
      entry.pc.removeTrack(entry.videoSender);
      entry.videoSender = null;
    }
  }
  if (announce) {
    sendState();
    emit('voice');
    emit('voice:media');
  }
}

export function toggleCamera() {
  if (!voice.channelId) return;
  if (voice.video === 'camera') stopVideo();
  else startVideo('camera');
}

export function toggleScreen() {
  if (!voice.channelId) return;
  if (voice.video === 'screen') stopVideo();
  else startVideo('screen');
}

// --- signaling ---

on('voice:signal', async ({ from, userId, data }) => {
  if (!voice.channelId || !mic) return;
  const entry = peer(from, userId);
  const { pc } = entry;
  try {
    if (data.sdp) {
      const collision = data.sdp.type === 'offer' && (entry.makingOffer || pc.signalingState !== 'stable');
      entry.ignoreOffer = !entry.polite && collision;
      if (entry.ignoreOffer) return;
      await pc.setRemoteDescription(data.sdp);
      if (data.sdp.type === 'offer') {
        await pc.setLocalDescription();
        signal(from, { sdp: pc.localDescription });
      }
    } else if (data.candidate) {
      try {
        await pc.addIceCandidate(data.candidate);
      } catch (err) {
        if (!entry.ignoreOffer) throw err;
      }
    }
  } catch (err) {
    console.warn('voice signal failed', err);
  }
});

on('voice:peer-left', ({ socketId }) => dropPeer(socketId));

// If the channel disappears (or we lose the server, or leave the DM group), hang up.
on('servers dms', () => {
  if (!voice.channelId || voice.connecting) return;
  if (!findChannel(voice.channelId)) leaveVoice();
});

// After a reconnect the server has forgotten us: rejoin the same room.
on('reload', () => {
  if (!voice.channelId || voice.connecting) return;
  const channel = findChannel(voice.channelId);
  leaveVoice();
  if (channel) joinVoice(channel);
});

window.addEventListener('beforeunload', () => leaveVoice());
