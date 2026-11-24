import { withMenu } from '../contextMenu.js';
import { serverMenu } from '../menus.js';
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { state, on, isUnread, hasUnread, relationsWith, sortedDms, dmName } from '../store.js';
import { navigate, lastHomePath, paths } from '../router.js';
import { avatar, button, field, form, serverIcon, settingRow, settingsCard } from '../ui.js';
import { changeSettings } from '../actions.js';
import { colorField } from '../colorPicker.js';
import { openPage } from './page.js';
import { groupFace } from './sidebar.js';
import { openAddServer } from './serverPages.js';
import { lastBotPath } from './botWorkspace.js';

// Remembers which channel was open in each server, so clicking its icon goes back there.
// The channel you were last in on each server, kept across reloads.
const LAST_CHANNELS = 'oc:lastChannels';
const lastChannel = new Map((() => {
  try { return Object.entries(JSON.parse(localStorage.getItem(LAST_CHANNELS) || '{}')); } catch { return []; }
})());
function saveLastChannels() {
  try { localStorage.setItem(LAST_CHANNELS, JSON.stringify(Object.fromEntries([...lastChannel].slice(-200)))); } catch { /* storage off */ }
}

const pingText = (n) => (n > 99 ? '99+' : String(n));

function item({ active, unread, label, onclick, menu, pings = 0 }, face) {
  const el = h('div', { class: `rail-item${active ? ' active' : ''}${unread ? ' unread' : ''}` },
    h('span', { class: 'rail-pill' }),
    // The label only shows when the server list is a row of tabs along the top (Appearance → Server list → Top).
    h('button', { type: 'button', title: label, 'aria-label': pings ? `${label}, ${pings} unread` : label, onclick }, face, h('span', { class: 'rail-label' }, label)),
    pings > 0 && h('span', { class: 'ping-badge' }, pingText(pings)));
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

// --- server folders ---
// The rail's order and folders are kept per account in settings.rail: a list of server ids and folders
// ({ folder, name, color, open, servers: [ids] }). Servers you join later go at the end.

const keyOf = (entry) => (typeof entry === 'string' ? entry : `f:${entry.folder}`);

function railLayout() {
  const raw = Array.isArray(state.me.settings?.rail) ? state.me.settings.rail : [];
  const seen = new Set();
  const out = [];
  for (const entry of raw) {
    if (typeof entry === 'string') {
      if (state.servers.has(entry) && !seen.has(entry)) { seen.add(entry); out.push(entry); }
    } else if (entry?.folder) {
      const servers = (entry.servers || []).filter((id) => state.servers.has(id) && !seen.has(id));
      servers.forEach((id) => seen.add(id));
      if (servers.length) out.push({ ...entry, servers });
    }
  }
  for (const id of state.servers.keys()) if (!seen.has(id)) out.push(id);
  return out;
}

let redrawRail = () => {};
function saveLayout(next) {
  changeSettings({ rail: next.filter((e) => typeof e === 'string' || e.servers.length) });
  redrawRail();
}

// Takes a server out of wherever it is (top level or a folder).
function without(entries, serverId) {
  return entries.filter((e) => e !== serverId).map((e) => (typeof e === 'string' ? e : { ...e, servers: e.servers.filter((id) => id !== serverId) }));
}

// Drops `dragKey` (a server id or "f:<folder>") on `targetKey` at `zone`: before / after / into (a folder or,
// on a server, makes a new folder of the two).
function drop(dragKey, targetKey, zone, folderOfTarget = null) {
  if (dragKey === targetKey) return;
  let entries = railLayout();
  if (dragKey.startsWith('f:')) {
    // Folders only move between top-level items.
    const folder = entries.find((e) => keyOf(e) === dragKey);
    const targetTop = folderOfTarget ? `f:${folderOfTarget}` : targetKey;
    entries = entries.filter((e) => e !== folder);
    const at = entries.findIndex((e) => keyOf(e) === targetTop);
    entries.splice(at + (zone === 'after' ? 1 : 0), 0, folder);
    return saveLayout(entries);
  }
  const serverId = dragKey;
  entries = without(entries, serverId);
  if (targetKey === 'end') {
    // Dropped below everything (the empty space, or the + button): out of any folder, last in the list.
    entries.push(serverId);
    return saveLayout(entries);
  }
  if (zone === 'into' && targetKey.startsWith('f:')) {
    entries.find((e) => keyOf(e) === targetKey)?.servers.push(serverId);
  } else if (zone === 'into') {
    // Server on server: a new folder with both, where the target was.
    const at = entries.findIndex((e) => e === targetKey);
    if (at === -1) return undefined;
    entries.splice(at, 1, { folder: Date.now().toString(36), name: '', color: null, open: true, servers: [targetKey, serverId] });
  } else if (folderOfTarget) {
    const folder = entries.find((e) => keyOf(e) === `f:${folderOfTarget}`);
    const at = folder.servers.indexOf(targetKey);
    folder.servers.splice(at + (zone === 'after' ? 1 : 0), 0, serverId);
  } else {
    const at = entries.findIndex((e) => keyOf(e) === targetKey);
    entries.splice(at + (zone === 'after' ? 1 : 0), 0, serverId);
  }
  return saveLayout(entries);
}

function updateFolder(id, changes) {
  saveLayout(railLayout().map((e) => (keyOf(e) === `f:${id}` ? { ...e, ...changes } : e)));
}

function ungroup(id) {
  saveLayout(railLayout().flatMap((e) => (keyOf(e) === `f:${id}` ? e.servers : [e])));
}

const folderName = (folder) => folder.name || folder.servers.map((id) => state.servers.get(id)?.name).filter(Boolean).slice(0, 3).join(', ');

function openFolderSettings(folder) {
  const name = h('input', { class: 'input', maxLength: 40, value: folder.name, placeholder: folderName({ ...folder, name: '' }) });
  const page = openPage({
    title: 'Folder',
    icon: 'folder',
    content: h('div', { class: 'settings-content' },
      settingsCard(null, form({
        submitLabel: 'Save',
        onSubmit: async () => { updateFolder(folder.folder, { name: name.value.trim() }); page.close(); },
      }, field('Name', name),
      settingRow('Colour', colorField({ value: folder.color, allowNone: true, label: 'Folder colour', onChange: (c) => updateFolder(folder.folder, { color: c }) })))),
      settingsCard(null, settingRow('Take the servers out of this folder', button('Ungroup', () => { ungroup(folder.folder); page.close(); }, 'ghost small')))),
  });
}

// Extra right-click items for a server: move it into a folder, make a new one, or take it out.
function folderItems(serverId) {
  const entries = railLayout();
  const folders = entries.filter((e) => typeof e !== 'string');
  const inFolder = folders.find((f) => f.servers.includes(serverId));
  return [
    '-',
    ...folders.filter((f) => f !== inFolder).map((f) => ({ label: `Move to ${folderName(f)}`, icon: 'folder', onClick: () => drop(serverId, `f:${f.folder}`, 'into') })),
    !inFolder && { label: 'Put in a new folder', icon: 'folder', onClick: () => {
      const next = entries.map((e) => (e === serverId ? { folder: Date.now().toString(36), name: '', color: null, open: true, servers: [serverId] } : e));
      saveLayout(next);
    } },
    inFolder && { label: 'Take out of folder', icon: 'folder', onClick: () => {
      const next = without(entries, serverId);
      next.splice(next.findIndex((e) => e === inFolder || keyOf(e) === keyOf(inFolder)) + 1, 0, serverId);
      saveLayout(next);
    } },
  ];
}

// --- dragging (with a mouse; on a phone, use the right-click / long-press menu) ---

let dragging = null; // key being dragged

function dropZone(event, el, canInto) {
  const box = el.getBoundingClientRect();
  const y = (event.clientY - box.top) / box.height;
  if (canInto && y > 0.28 && y < 0.72) return 'into';
  return y < 0.5 ? 'before' : 'after';
}

function makeDraggable(el, key, { target, canInto, folderOf = null }) {
  el.draggable = true;
  el.addEventListener('dragstart', (event) => {
    dragging = key;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', key);
    requestAnimationFrame(() => el.classList.add('dragging'));
  });
  el.addEventListener('dragend', () => {
    dragging = null;
    el.classList.remove('dragging');
    document.querySelectorAll('.rail .drop-before, .rail .drop-after, .rail .drop-into').forEach((x) => x.classList.remove('drop-before', 'drop-after', 'drop-into'));
  });
  el.addEventListener('dragover', (event) => {
    if (!dragging || dragging === key) return;
    event.preventDefault();
    // Folders can't go inside folders.
    const zone = dropZone(event, el, canInto && !dragging.startsWith('f:'));
    el.classList.toggle('drop-before', zone === 'before');
    el.classList.toggle('drop-after', zone === 'after');
    el.classList.toggle('drop-into', zone === 'into');
  });
  el.addEventListener('dragleave', () => el.classList.remove('drop-before', 'drop-after', 'drop-into'));
  el.addEventListener('drop', (event) => {
    event.preventDefault();
    const zone = dropZone(event, el, canInto && !dragging?.startsWith('f:'));
    el.classList.remove('drop-before', 'drop-after', 'drop-into');
    if (dragging) drop(dragging, target, zone, folderOf);
    dragging = null;
  });
  return el;
}

export function mountRail(el) {
  // Tabs along the top scroll sideways with momentum (a flick keeps gliding, then slows) and stretch a little past
  // either end before springing back. Any wheel or trackpad direction scrolls them. The pinned home and + buttons
  // don't move: only the tabs between them shift during the stretch (CSS reads --rubber).
  let pos = 0; // where the strip wants to be, can go past the ends while stretching
  let vel = 0;
  let frame = null;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const maxScroll = () => Math.max(0, el.scrollWidth - el.clientWidth);
  let lastSet = 0; // what step() last set, to notice the strip being scrolled some other way (keyboard, a jump)
  function step() {
    const max = maxScroll();
    if (Math.abs(el.scrollLeft - lastSet) > 2) pos = el.scrollLeft + (pos - Math.min(max, Math.max(0, pos)));
    pos += vel;
    vel *= 0.9; // friction
    if (pos < 0 || pos > max) {
      const edge = pos < 0 ? 0 : max;
      vel *= 0.55; // past the end: slow down hard…
      pos += (edge - pos) * 0.18; // …and spring back
    }
    const inside = Math.min(max, Math.max(0, pos));
    el.scrollLeft = inside;
    lastSet = el.scrollLeft;
    const over = pos - inside;
    el.style.setProperty('--rubber', `${(-over * 0.6).toFixed(2)}px`);
    if (Math.abs(vel) > 0.15 || Math.abs(over) > 0.4) frame = requestAnimationFrame(step);
    else { frame = null; pos = inside; el.style.setProperty('--rubber', '0px'); }
  }
  el.addEventListener('wheel', (event) => {
    if (document.documentElement.dataset.rail !== 'top') return;
    if (el.scrollWidth <= el.clientWidth) return;
    event.preventDefault();
    const raw = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    const delta = raw * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? el.clientWidth : 1);
    if (reduced.matches) { el.scrollLeft += delta; return; }
    if (!frame) { pos = el.scrollLeft; lastSet = pos; } // pick up from wherever it is now
    const max = maxScroll();
    const outside = pos < 0 || pos > max;
    vel += delta * (outside ? 0.08 : 0.22);
    vel = Math.max(-80, Math.min(80, vel));
    if (!frame) frame = requestAnimationFrame(step);
  }, { passive: false });

  function serverItem(server, folderOf = null) {
    return makeDraggable(item({
      active: state.route.serverId === server.id, unread: hasUnread(server), label: server.name,
      onclick: () => openServer(server), menu: () => [...serverMenu(server), ...folderItems(server.id)],
    }, serverIcon(server, 44)), server.id, { target: server.id, canInto: !folderOf, folderOf });
  }

  function folderView(folder) {
    const servers = folder.servers.map((id) => state.servers.get(id)).filter(Boolean);
    const unread = servers.some(hasUnread);
    const active = servers.some((s) => s.id === state.route.serverId);
    const style = folder.color ? { '--folder': folder.color } : null;
    const label = folderName(folder);
    const toggle = () => updateFolder(folder.folder, { open: !folder.open });
    const menu = () => [
      { label: folder.open ? 'Close folder' : 'Open folder', icon: 'folder', onClick: toggle },
      { label: 'Folder settings', icon: 'settings', onClick: () => openFolderSettings(folder) },
      { label: 'Ungroup', icon: 'x', onClick: () => ungroup(folder.folder) },
    ];
    if (!folder.open) {
      // Closed: one tile with up to four tiny server icons in it.
      const tile = item({ active, unread, label, onclick: toggle, menu },
        h('span', { class: 'folder-face', style }, servers.slice(0, 4).map((s) => serverIcon(s, 18))));
      tile.classList.add('rail-folder');
      return makeDraggable(tile, `f:${folder.folder}`, { target: `f:${folder.folder}`, canInto: true });
    }
    // Open: the folder's icon on top and its servers under it, on a tinted background.
    const head = item({ unread: unread && !active, label: `${label} (close)`, onclick: toggle, menu },
      h('span', { class: 'folder-head', style }, icon('folder', 20)));
    makeDraggable(head, `f:${folder.folder}`, { target: `f:${folder.folder}`, canInto: true });
    return h('div', { class: 'rail-folder-open', style }, head, servers.map((s) => serverItem(s, folder.folder)));
  }

  function render() {
    const { route } = state;
    if (route.name === 'server' && route.channelId && lastChannel.get(route.serverId) !== route.channelId) {
      lastChannel.delete(route.serverId);
      lastChannel.set(route.serverId, route.channelId);
      saveLastChannels();
    }
    const homeUnread = [...state.dms.values()].some(isUnread) || relationsWith('incoming').length > 0;
    // DMs with unread messages also sit in the rail under Home, with a red count, like pings.
    const pinged = state.me.settings?.dmPings === false ? [] : sortedDms().filter((dm) => state.dmPings.get(dm.id) && state.route.channelId !== dm.id).slice(0, 5);

    el.replaceChildren(
      item({
        active: route.name !== 'server' && route.name !== 'bots', unread: homeUnread, label: 'Friends and direct messages',
        onclick: () => navigate(lastHomePath(), { panel: 'nav' }),
        pings: relationsWith('incoming').length,
      }, h('span', { class: 'rail-button' }, icon('logo', 30))),
      ...pinged.map((dm) => item({
        label: dmName(dm), pings: state.dmPings.get(dm.id), onclick: () => navigate(paths.dm(dm.id)),
      }, dm.kind === 'group' ? groupFace(dm, 44) : avatar(dm.recipient, { size: 44 }))),
      h('span', { class: 'rail-divider' }),
      ...railLayout().map((entry) => (typeof entry === 'string' ? serverItem(state.servers.get(entry)) : folderView(entry))),
      (() => {
        const add = item({ label: 'Add a server', onclick: openAddServer }, h('span', { class: 'rail-button add' }, icon('plus', 20)));
        add.classList.add('add-server');
        return add;
      })(),
      // Developer mode: the bot workspace button sits at the bottom of the rail.
      ...(state.me.settings?.developerMode ? [(() => {
        const bots = item({
          active: route.name === 'bots', label: 'Bots',
          onclick: () => navigate(route.name === 'bots' ? paths.bots() : lastBotPath()),
        }, h('span', { class: 'rail-button' }, icon('bot', 22)));
        bots.classList.add('rail-bots');
        return bots;
      })()] : []),
    );
  }

  // The empty space at the bottom of the rail (and the + button) take a drop too: that's how a server comes
  // out of a folder that's last in the list.
  const isEnd = (event) => event.target === el || event.target.closest?.('.rail-item.add-server');
  el.addEventListener('dragover', (event) => {
    if (!dragging || !isEnd(event)) return;
    event.preventDefault();
    el.classList.add('drop-end');
  });
  el.addEventListener('dragleave', (event) => { if (event.target === el) el.classList.remove('drop-end'); });
  el.addEventListener('drop', (event) => {
    el.classList.remove('drop-end');
    if (!dragging || !isEnd(event)) return;
    event.preventDefault();
    if (dragging.startsWith('f:')) {
      const entries = railLayout();
      const folder = entries.find((e) => keyOf(e) === dragging);
      saveLayout([...entries.filter((e) => e !== folder), folder]);
    } else {
      drop(dragging, 'end', 'after');
    }
    dragging = null;
  });

  redrawRail = render;
  on('servers unread route relationships dms users me', render);
  render();
}
