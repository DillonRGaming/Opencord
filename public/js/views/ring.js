// Someone started a call in a DM: a card at the top of the screen with Accept and Decline, and a soft ring.
// It goes away by itself when the caller hangs up, after 30 seconds, or once you're in the call.
import { h } from '../dom.js';
import { icon } from '../icons.js';
import * as api from '../api.js';
import { state, on, emit, findChannel, dmName, dmPeople, remember, setting, quietNow } from '../store.js';
import { navigate, paths } from '../router.js';
import { avatar } from '../ui.js';
import { voice, joinVoice } from '../voice.js';

let ringing = null; // { channelId, el, timer, sound }

function ringSound() {
  try {
    const ctx = new AudioContext();
    const beep = (at, freq) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(0.08, at + 0.03);
      gain.gain.linearRampToValueAtTime(0, at + 0.35);
      osc.connect(gain).connect(ctx.destination);
      osc.start(at);
      osc.stop(at + 0.4);
    };
    const ring = () => { const t = ctx.currentTime; beep(t, 660); beep(t + 0.45, 880); };
    ring();
    const timer = setInterval(ring, 2200);
    return () => { clearInterval(timer); ctx.close(); };
  } catch {
    return () => {};
  }
}

function stop() {
  if (!ringing) return;
  clearTimeout(ringing.timer);
  ringing.sound();
  ringing.el.remove();
  ringing = null;
}

on('call:ring', async ({ channelId, userId }) => {
  let channel = findChannel(channelId);
  if (!channel) {
    // A DM with no messages yet isn't in the list: fetch it.
    channel = await api.get(`/api/channels/${channelId}`).catch(() => null);
    if (channel?.type !== 'dm') return;
    state.dms.set(channel.id, channel);
    remember(...dmPeople(channel));
    emit('dms');
  }
  if (voice.channelId === channelId || state.me.presence === 'dnd' || !(state.voice.get(channelId) || []).length) return;
  if (setting('callRing', true) === false || quietNow()) return;
  stop();
  const caller = state.users.get(userId) || { id: userId, displayName: 'Someone' };
  const el = h('div', { class: 'ring-card', role: 'alertdialog', 'aria-label': `${caller.displayName} is calling` },
    avatar(caller, { size: 44 }),
    h('div', { class: 'ring-text' }, h('strong', {}, caller.displayName),
      h('span', {}, channel.kind === 'group' ? `Calling ${dmName(channel)}` : 'Incoming call…')),
    h('button', { type: 'button', class: 'ring-button decline', title: 'Decline', 'aria-label': 'Decline', onclick: stop }, icon('phoneOff', 20)),
    h('button', {
      type: 'button', class: 'ring-button accept', title: 'Accept', 'aria-label': 'Accept',
      onclick: () => { stop(); navigate(paths.dm(channelId)); joinVoice(channel); },
    }, icon('phone', 20)));
  document.body.append(el);
  ringing = { channelId, el, sound: ringSound(), timer: setTimeout(stop, 30_000) };
});

// The caller gave up, or we picked up somewhere else.
on('voice', () => {
  if (!ringing) return;
  if (voice.channelId === ringing.channelId || !(state.voice.get(ringing.channelId) || []).length) stop();
});
