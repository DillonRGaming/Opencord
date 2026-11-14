import { state, emit } from './store.js';

// /channels/@me            → friends page
// /channels/@me/<dmId>     → a DM
// /channels/<serverId>/<channelId> → a server channel
// /invite/<code>           → invite preview
export function parse(pathname) {
  const parts = pathname.split('/').filter(Boolean);
  if (parts[0] === 'invite' && parts[1]) return { name: 'invite', code: parts[1] };
  if (parts[0] === 'channels' && parts[1] && parts[1] !== '@me') {
    return { name: 'server', serverId: parts[1], channelId: parts[2] || null };
  }
  if (parts[0] === 'channels' && parts[2]) return { name: 'dm', channelId: parts[2] };
  return { name: 'home' };
}

export const paths = {
  home: () => '/channels/@me',
  dm: (channelId) => `/channels/@me/${channelId}`,
  channel: (serverId, channelId) => `/channels/${serverId}${channelId ? `/${channelId}` : ''}`,
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

// `panel` says which column a phone should show after navigating.
export function navigate(path, { replace = false, panel = 'main' } = {}) {
  const from = document.body.dataset.panel;
  const entry = { panel, back: replace ? history.state?.back : from === 'nav' && panel === 'main' };
  if (replace) history.replaceState(entry, '', path);
  else if (path !== location.pathname || panel !== from || currentLayers().length) history.pushState(entry, '', path);
  state.route = parse(path);
  setPanel(panel);
  emit('route');
}

// The back arrow on a phone: back to the lists. Uses the browser's history when the lists are the page before.
export function showNav() {
  if (history.state?.back && !currentLayers().length) {
    history.back();
    return;
  }
  history.replaceState({ ...history.state, panel: 'nav', back: false, layers: [] }, '');
  setPanel('nav');
}

// From the lists back to the open chat (a swipe on a phone).
export function showMain() {
  if (document.body.dataset.panel === 'main') return;
  history.pushState({ panel: 'main', back: true }, '');
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
  state.route = parse(location.pathname);
  const panel = state.route.name === 'home' ? 'nav' : 'main';
  history.replaceState({ panel, back: false }, '');
  document.body.dataset.panel = panel;
  window.addEventListener('popstate', () => {
    const route = parse(location.pathname);
    const changed = JSON.stringify(route) !== JSON.stringify(state.route);
    state.route = route;
    setPanel(history.state?.panel || (route.name === 'home' ? 'nav' : 'main'));
    emit('layers');
    if (changed) emit('route');
  });
}
