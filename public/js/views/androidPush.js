// Android app only: hands the phone's push token to the server (so calls ring and messages arrive while the
// app is closed) and acts on a tapped notification: Accept on a call joins it, a message opens its chat.
import * as api from '../api.js';
import { state, findChannel } from '../store.js';
import { navigate, paths } from '../router.js';
import { joinVoice } from '../voice.js';
import { requestNotifications } from '../native.js';

const bridge = () => window.OpencordPush;

async function registerToken(tries = 10) {
  const token = bridge()?.token();
  if (token) return api.post('/api/users/@me/push-token', { token }).catch(() => {});
  // Firebase hands the token over a moment after the first launch.
  if (tries > 0) setTimeout(() => registerToken(tries - 1), 3000);
}

function act(action) {
  if (!action) return;
  const [kind, channelId, serverId] = action.split(':');
  if (kind === 'call') {
    const channel = findChannel(channelId);
    navigate(paths.dmCall(channelId));
    if (channel) joinVoice(channel);
  } else if (kind === 'open') {
    navigate(serverId ? paths.channel(serverId, channelId) : paths.dm(channelId));
  }
}

export function startAndroidPush() {
  if (!bridge() || !state.me) return;
  requestNotifications(); // Android 13+ asks once
  registerToken();
  act(bridge().takeAction());
  // Tapped while the app was already open in the background.
  document.addEventListener('visibilitychange', () => { if (!document.hidden) act(bridge().takeAction()); });
}
