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

// `panel` says which column a phone should show after navigating: the lists ('nav') or the content ('main').
export function navigate(path, { replace = false, panel = 'main' } = {}) {
  if (path !== location.pathname) history[replace ? 'replaceState' : 'pushState'](null, '', path);
  state.route = parse(path);
  document.body.dataset.panel = panel;
  emit('route');
}

export function start() {
  state.route = parse(location.pathname);
  document.body.dataset.panel = state.route.name === 'home' ? 'nav' : 'main';
  window.addEventListener('popstate', () => {
    state.route = parse(location.pathname);
    emit('route');
  });
}
