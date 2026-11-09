import * as api from './api.js';
import { h } from './dom.js';
import { icon } from './icons.js';
import { state, on, emit, load, remember } from './store.js';
import * as router from './router.js';
import { navigate, paths } from './router.js';
import * as theme from './theme.js';
import { connect } from './realtime.js';
import { refreshPresenceDots, toast } from './ui.js';
import { showAuth } from './views/auth.js';
import { mountRail } from './views/rail.js';
import { mountSidebar } from './views/sidebar.js';
import { showChat, closeChat } from './views/chat.js';
import { showFriends } from './views/friends.js';
import { openInvite } from './views/serverPanels.js';
import { mountSide } from './views/side.js';

const root = document.getElementById('app');

function emptyState(title, text) {
  return h('div', { class: 'empty-state' }, icon('message', 44), h('h2', {}, title), h('p', {}, text));
}

// Decides what the main column shows for the current address.
async function showMain(main) {
  const { route } = state;

  if (route.name === 'server') {
    const server = state.servers.get(route.serverId);
    if (!server) return navigate(paths.home(), { replace: true, panel: 'nav' });
    const channel = server.channels.find((c) => c.id === route.channelId);
    if (channel) return showChat(main, channel, server.id);
    if (server.channels.length) {
      return navigate(paths.channel(server.id, server.channels[0].id), { replace: true, panel: document.body.dataset.panel });
    }
    closeChat();
    return main.replaceChildren(emptyState('No channels', 'This server has no channels yet.'));
  }

  if (route.name === 'dm') {
    const dm = state.dms.get(route.channelId);
    if (dm) return showChat(main, dm);
    // A DM that has no messages yet isn't in the list, so ask for it.
    const fetched = await api.get(`/api/channels/${route.channelId}`).catch(() => null);
    if (fetched?.type !== 'dm') return navigate(paths.home(), { replace: true, panel: 'nav' });
    state.dms.set(fetched.id, fetched);
    remember(fetched.recipient);
    return emit('dms');
  }

  closeChat();
  return showFriends(main);
}

// Someone already logged in opened an invite link.
async function handleInviteLink(code) {
  navigate(paths.home(), { replace: true, panel: 'nav' });
  const invite = await api.get(`/api/invites/${encodeURIComponent(code)}`).catch(() => null);
  if (!invite) return toast("That invite link doesn't work any more.");
  if (state.servers.has(invite.server.id)) return navigate(paths.channel(invite.server.id), { panel: 'nav' });
  return openInvite(invite);
}

function showApp() {
  const rail = h('nav', { class: 'rail', 'aria-label': 'Servers' });
  const sidebar = h('aside', { class: 'sidebar panel' });
  const column = h('div', { class: 'column panel' });
  const side = h('aside', { class: 'side panel', hidden: true });
  root.replaceChildren(
    h('div', { class: 'offline-bar', role: 'status' }, 'Connection lost. Reconnecting…'),
    h('div', { class: 'app' }, rail, sidebar, h('main', { class: 'main' }, column, side)));

  const invite = state.route.name === 'invite' && state.route.code;
  if (invite) handleInviteLink(invite);

  mountRail(rail);
  mountSidebar(sidebar);
  mountSide(side);
  on('route servers dms', () => showMain(column));
  on('presence', refreshPresenceDots);
  showMain(column);
  connect();
}

async function boot() {
  theme.applyCached();
  router.start();

  let data;
  try {
    data = await api.get('/api/bootstrap');
  } catch (err) {
    if (err.status !== 401) {
      root.replaceChildren(emptyState("Can't reach Opencord", `${err.message} Reload the page to try again.`));
      return;
    }
    const { route } = state;
    const invite = route.name === 'invite' ? await api.get(`/api/invites/${encodeURIComponent(route.code)}`).catch(() => null) : null;
    showAuth(root, invite);
    return;
  }

  load(data);
  theme.apply(state.me.settings);
  // From here on, a 401 means the session ended somewhere else: go back to the login screen.
  api.setUnauthorizedHandler(() => location.reload());
  showApp();
}

boot();
