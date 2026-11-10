import { withMenu } from '../contextMenu.js';
import { serverMenu } from '../menus.js';
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { state, on, isUnread, hasUnread, relationsWith } from '../store.js';
import { navigate, paths } from '../router.js';
import { serverIcon } from '../ui.js';
import { openAddServer } from './serverPages.js';

// Remembers which channel was open in each server, so clicking its icon goes back there.
const lastChannel = new Map();

function item({ active, unread, label, onclick, menu }, face) {
  const el = h('div', { class: `rail-item${active ? ' active' : ''}${unread ? ' unread' : ''}` },
    h('span', { class: 'rail-pill' }),
    h('button', { type: 'button', title: label, 'aria-label': label, onclick }, face));
  return menu ? withMenu(el, menu) : el;
}

// The top text channel, by position.
function firstText(server) {
  return [...server.channels].filter((c) => c.kind === 'text').sort((a, b) => a.position - b.position)[0];
}

function openServer(server) {
  const remembered = lastChannel.get(server.id);
  const channel = server.channels.find((c) => c.id === remembered) || firstText(server);
  navigate(paths.channel(server.id, channel?.id), { panel: 'nav' });
}

export function mountRail(el) {
  function render() {
    const { route } = state;
    if (route.name === 'server' && route.channelId) lastChannel.set(route.serverId, route.channelId);
    const homeUnread = [...state.dms.values()].some(isUnread) || relationsWith('incoming').length > 0;

    el.replaceChildren(
      item({
        active: route.name !== 'server', unread: homeUnread, label: 'Friends and direct messages',
        onclick: () => navigate(paths.home(), { panel: 'nav' }),
      }, h('span', { class: 'rail-button' }, icon('logo', 22))),
      h('span', { class: 'rail-divider' }),
      ...[...state.servers.values()].map((server) => item({
        active: route.serverId === server.id, unread: hasUnread(server), label: server.name,
        onclick: () => openServer(server), menu: () => serverMenu(server),
      }, serverIcon(server, 44))),
      item({ label: 'Add a server', onclick: openAddServer }, h('span', { class: 'rail-button add' }, icon('plus', 20))),
    );
  }

  on('servers unread route relationships dms', render);
  render();
}
