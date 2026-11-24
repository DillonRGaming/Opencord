import * as api from './api.js';
import { h } from './dom.js';
import { icon } from './icons.js';
import { state, on, emit, load, remember } from './store.js';
import * as router from './router.js';
import { navigate, paths } from './router.js';
import * as theme from './theme.js';
import { connect } from './realtime.js';
import { refreshPresenceDots, skeletonApp, toast } from './ui.js';
import { showAuth } from './views/auth.js';
import { mountRail } from './views/rail.js';
import { mountSidebar } from './views/sidebar.js';
import { showChat, closeChat } from './views/chat.js';
import { showFriends } from './views/friends.js';
import { openInvite } from './views/serverPages.js';
import { mountSide } from './views/side.js';
import { mountPages, registerPage, restorePage } from './views/page.js';
import { showBotWorkspace, leaveBotWorkspace } from './views/botWorkspace.js';
import { showVoice, closeVoiceView } from './views/voiceView.js';
import { startGestures } from './gestures.js';
import { startDropdowns } from './dropdown.js';
import { startElastic } from './elastic.js';
import { setUiLanguage } from './uiLanguage.js';
import { showPosts, closePosts, loadPost } from './views/posts.js';
import { showWhiteboard, closeWhiteboard } from './views/whiteboard.js';
import { showCalendar, closeCalendar } from './views/calendar.js';
import { showMusic, closeMusic } from './views/music.js';
import { showWiki, closeWiki } from './views/wiki.js';
import './views/ring.js';

const root = document.getElementById('app');

// The normal column content and the persistent music page. Only one is shown; the music page is collapsed
// (not removed) when you browse away, so its embed keeps playing and never reloads.
let contentEl = null;
let musicHost = null;

function emptyState(title, text) {
  return h('div', { class: 'empty-state keep' }, h('span', { class: 'empty-icon' }, icon('message', 26)), h('h2', {}, title), h('p', {}, text));
}

// Channel kinds that have their own view instead of a chat.
const APPS = {
  posts: { show: showPosts, close: closePosts },
  whiteboard: { show: showWhiteboard, close: closeWhiteboard },
  calendar: { show: showCalendar, close: closeCalendar },
  music: { show: showMusic, close: closeMusic },
  wiki: { show: showWiki, close: closeWiki },
  video: { show: showMusic, close: closeMusic }, // the same shared player, with a video browser
};

function closeApps(except = null) {
  for (const [kind, app] of Object.entries(APPS)) if (kind !== except) app.close();
}

// Decides what the main column shows for the current address.
async function showMain(main) {
  const { route } = state;
  const server = route.name === 'server' && state.servers.get(route.serverId);
  const musicChannel = server && server.channels.find((c) => c.id === route.channelId && (c.kind === 'music' || c.kind === 'video'));
  if (musicHost) {
    musicHost.classList.toggle('collapsed', !musicChannel);
    contentEl?.classList.toggle('is-hidden', Boolean(musicChannel));
    if (musicChannel) main = musicHost;
  }
  if (route.name === 'bots') {
    closeChat();
    closeApps();
    closeVoiceView();
    return showBotWorkspace(main);
  }
  leaveBotWorkspace();
  const voiceChannel = server && server.channels.find((c) => c.id === route.channelId && c.kind === 'voice');
  if (voiceChannel) {
    closeChat();
    closeApps();
    return showVoice(main, voiceChannel, server.id);
  }
  closeVoiceView();

  if (route.name === 'server') {
    const server = state.servers.get(route.serverId);
    if (!server) return navigate(paths.home(), { replace: true, panel: 'nav' });
    const picked = server.channels.find((c) => c.id === route.channelId);
    closeApps(picked?.kind === 'posts' && route.postId ? null : picked?.kind);
    const app = APPS[picked?.kind];
    if (app && !(picked.kind === 'posts' && route.postId)) {
      closeChat();
      return app.show(main, picked, server.id);
    }
    if (picked?.kind === 'posts') {
      const post = await loadPost(route.postId);
      if (!post) return navigate(paths.channel(server.id, picked.id), { replace: true });
      if (state.route.postId !== post.id) return undefined; // moved on while it loaded
      return showChat(main, post, server.id);
    }
    const channel = picked?.kind === 'text' ? picked : null;
    if (channel) return showChat(main, channel, server.id);
    if (document.body.dataset.panel === 'nav') return;
    const first = [...server.channels].filter((c) => c.kind === 'text').sort((a, b) => a.position - b.position)[0];
    if (first) {
      return navigate(paths.channel(server.id, first.id), { replace: true, panel: document.body.dataset.panel });
    }
    closeChat();
    return main.replaceChildren();
  }

  closeApps();
  if (route.name === 'dm') {
    const dm = state.dms.get(route.channelId);
    if (dm && route.call) {
      closeChat();
      return showVoice(main, dm, null);
    }
    closeVoiceView();
    if (dm) return showChat(main, dm);
    // A DM that has no messages yet isn't in the list, so ask for it.
    const fetched = await api.get(`/api/channels/${route.channelId}`).catch(() => null);
    if (fetched?.type !== 'dm') return navigate(paths.home(), { replace: true, panel: 'nav' });
    state.dms.set(fetched.id, fetched);
    remember(fetched.recipient);
    return emit('dms');
  }

  closeChat();
  closeApps();
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
  contentEl = h('div', { class: 'column-content' });
  musicHost = h('div', { class: 'music-page-host collapsed' });
  const column = h('div', { class: 'column panel' }, contentEl, musicHost);
  const side = h('aside', { class: 'side panel', hidden: true });
  root.replaceChildren(
    h('div', { class: 'offline-bar', role: 'status' }, 'Connection lost. Reconnecting…'),
    h('div', { class: 'app' }, rail, sidebar, h('main', { class: 'main' }, column, side)));

  const invite = state.route.name === 'invite' && state.route.code;
  if (invite) handleInviteLink(invite);

  mountRail(rail);
  mountSidebar(sidebar);
  mountSide(side);
  mountPages(column);
  on('route servers dms', () => showMain(contentEl));
  on('presence', refreshPresenceDots);
  showMain(contentEl);
  // Opened from a message link (…?m=<id>): jump to that message once the chat is up.
  const linked = new URLSearchParams(location.search).get('m');
  if (linked && state.route.channelId) {
    history.replaceState(history.state, '', location.pathname);
    import('./views/chat.js').then((m) => m.jumpToMessage(state.route.postId || state.route.channelId, linked));
  }
  startGestures();
  connect();
  restorePage();
}

// Pages that come back after a refresh (see ?page= in views/page.js). Each resolves true if it opened.
registerPage('stats', async () => { (await import('./views/personStats.js')).openMyStats(); return true; });
registerPage('notifications', async () => { (await import('./views/notifications.js')).openNotifications(); return true; });
registerPage('settings', async (section) => { (await import('./views/settings.js')).openSettings(section); return true; });
registerPage('server', async (serverId, section) => {
  const server = state.servers.get(serverId);
  if (server) (await import('./views/serverSettings.js')).openServerSettings(server, section);
  return Boolean(server);
});
// Older links to the bot pages go to the bot workspace.
registerPage('bot', async (serverId, botId) => { navigate(paths.bots(serverId, botId), { replace: true }); return true; });
registerPage('botsettings', async (serverId, botId) => { navigate(paths.bots(serverId, botId, 'profile'), { replace: true }); return true; });

async function boot() {
  theme.applyCached();
  startDropdowns();
  startElastic();
  router.start();

  let data;
  // Only if loading takes a moment: a quick load goes straight to the app with no flash of placeholders.
  const shell = setTimeout(() => { if (!root.firstChild || root.querySelector('.boot')) root.replaceChildren(skeletonApp()); }, 150);
  try {
    data = await api.get('/api/bootstrap');
    clearTimeout(shell);
  } catch (err) {
    clearTimeout(shell);
    if (err.status !== 401) {
      root.replaceChildren(emptyState("Can't reach Opencord", `${err.message} Reload the page to try again.`));
      return;
    }
    const { route } = state;
    const invite = route.name === 'invite' ? await api.get(`/api/invites/${encodeURIComponent(route.code)}`).catch(() => null) : null;
    theme.apply({}); // The login and sign-up screens always use the default look (Onyx).
    showAuth(root, invite);
    return;
  }

  load(data);
  theme.apply(state.me.settings);
  setUiLanguage(state.me.settings?.uiLanguage);
  // From here on, a 401 means the session ended somewhere else: go back to the login screen.
  api.setUnauthorizedHandler(() => location.reload());
  showApp();
  emit('notifications');
}

boot();

// Mentions and #channel links inside messages.
document.addEventListener('click', async (event) => {
  const mention = event.target.closest('.mention[data-user-id]');
  if (mention) {
    const user = state.users.get(mention.dataset.userId);
    if (user) (await import('./views/profile.js')).openProfile(user, { serverId: state.route.serverId });
    return;
  }
  const routed = event.target.closest('a[data-route]');
  if (routed && !event.ctrlKey && !event.metaKey) {
    event.preventDefault();
    navigate(new URL(routed.href).pathname);
  }
});
