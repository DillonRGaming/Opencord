import { state, emit } from './store.js';

// /channels/@me            → friends page
// /channels/@me/<dmId>     → a DM
// /channels/@me/<dmId>/call → the call in a DM, full page
// /channels/<serverId>/<channelId> → a server channel
// /channels/<serverId>/<channelId>/<postId> → a post in a posts channel
// /invite/<code>           → invite preview
// /bots                    → the bot workspace: pick a bot
// /bots/<serverId>/<botId>[/profile] → a bot's blocks (or its profile)
export function parse(pathname) {
  const parts = pathname.split('/').filter(Boolean);
  if (parts[0] === 'invite' && parts[1]) return { name: 'invite', code: parts[1] };
  if (parts[0] === 'bots') return { name: 'bots', serverId: parts[1] || null, botId: parts[2] || null, tab: parts[3] === 'profile' ? 'profile' : 'blocks' };
  if (parts[0] === 'channels' && parts[1] && parts[1] !== '@me') {
    return { name: 'server', serverId: parts[1], channelId: parts[2] || null, postId: parts[3] || null };
  }
  if (parts[0] === 'channels' && parts[2]) return { name: 'dm', channelId: parts[2], call: parts[3] === 'call' };
  return { name: 'home' };
}

export const paths = {
  home: () => '/channels/@me',
  dm: (channelId) => `/channels/@me/${channelId}`,
  dmCall: (channelId) => `/channels/@me/${channelId}/call`,
  channel: (serverId, channelId) => `/channels/${serverId}${channelId ? `/${channelId}` : ''}`,
  post: (serverId, channelId, postId) => `/channels/${serverId}/${channelId}/${postId}`,
  bots: (serverId, botId, tab) => `/bots${serverId && botId ? `/${serverId}/${botId}${tab === 'profile' ? '/profile' : ''}` : ''}`,
};

// Every history entry remembers which column a phone shows ('nav' = the lists, 'main' = the content) and
// which layers (a full page, a side panel) are open on top. So the phone's own back button (or swipe)
// steps back through them: page → chat → channel list, the way it does in a native app.

const isPhone = () => matchMedia('(max-width: 799px)').matches;

function setPanel(panel) {
  document.body.dataset.panel = panel;
  emit('panel');
}

export function currentLayers() {
  return history.state?.layers || [];
}

// Where you were last, so opening the site's front page (or the app from a bookmark) goes back there.
const LAST_KEY = 'oc:lastPath';
const HOME_KEY = 'oc:lastHome';
function rememberPath(path) {
  const route = parse(path);
  try {
    if (route.name !== 'invite') localStorage.setItem(LAST_KEY, path);
    if (route.name === 'home' || (route.name === 'dm' && !route.call)) localStorage.setItem(HOME_KEY, path);
  } catch { /* storage off */ }
}

// Where the Home button goes: the DM (or the friends page) you were last on.
export function lastHomePath() {
  try { return localStorage.getItem(HOME_KEY) || paths.home(); } catch { return paths.home(); }
}

// `panel` says which column a phone should show after navigating.
export function navigate(path, { replace = false, panel = 'main' } = {}) {
  const from = document.body.dataset.panel;
  const entry = { panel, back: replace ? history.state?.back : from === 'nav' && panel === 'main' };
  if (replace) history.replaceState(entry, '', path);
  else if (path !== location.pathname || panel !== from || currentLayers().length) history.pushState(entry, '', path);
  state.route = parse(path);
  rememberPath(path);
  setPanel(panel);
  emit('route');
}

// The back arrow on a phone: show the lists, keeping the current page so its channel stays selected.
export function showNav() {
  history.replaceState({ ...history.state, panel: 'nav', back: false, layers: [] }, '');
  setPanel('nav');
}

// From the lists back to the open chat (a swipe on a phone).
export function showMain() {
  if (document.body.dataset.panel === 'main') return;
  const entry = { panel: 'main', back: true };
  if (history.state?.panel === 'nav') history.replaceState(entry, '');
  else history.pushState(entry, '');
  setPanel('main');
}

// A page or side panel opened on top: give it a history entry on phones, so "back" closes it.
export function pushLayer(name) {
  if (!isPhone() || currentLayers().includes(name)) return;
  history.pushState({ ...history.state, layers: [...currentLayers(), name] }, '');
}

// Close a layer the way the user would: through history when it has an entry, else straight away.
export function leaveLayer(name, close) {
  if (currentLayers().at(-1) === name) history.back();
  else close();
}

export function start() {
  if (location.pathname === '/') {
    let last = null;
    try { last = localStorage.getItem(LAST_KEY); } catch { /* storage off */ }
    if (last?.startsWith('/channels/') || last?.startsWith('/bots')) history.replaceState(history.state, '', last + location.search);
  }
  state.route = parse(location.pathname);
  rememberPath(location.pathname);
  const panel = state.route.name === 'home' ? 'nav' : 'main';
  history.replaceState({ panel, back: false }, '');
  document.body.dataset.panel = panel;
  window.addEventListener('popstate', () => {
    const route = parse(location.pathname);
    const changed = JSON.stringify(route) !== JSON.stringify(state.route);
    state.route = route;
    rememberPath(location.pathname);
    setPanel(history.state?.panel || (route.name === 'home' ? 'nav' : 'main'));
    emit('layers');
    if (changed) emit('route');
  });
}
