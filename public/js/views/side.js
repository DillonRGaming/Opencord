import { h } from '../dom.js';
import { state, on } from '../store.js';
import { iconButton } from '../ui.js';
import { onEscape } from '../escape.js';
import { showMembers } from './members.js';
import { pushLayer, leaveLayer, currentLayers } from '../router.js';

// The column on the right. It shows one thing at a time: a panel someone opened (a profile, an invite
// link, the channel editor…) or, inside a server, the member list. Panels take the place of pop-up dialogs.

let el = null;
let panel = null; // { title, build, onClose, release }
let membersHidden = matchMedia('(max-width: 799px)').matches;
let shownServer = null; // the server whose member list is on screen, so switching channels doesn't redraw it

function header(title, onClose) {
  return h('header', { class: 'side-header' }, h('h2', {}, title), iconButton('x', 'Close', onClose));
}

export function dismissPanel() {
  leaveLayer('panel', closePanel);
}

function render() {
  if (!el) return;
  if (panel) {
    shownServer = null;
    el.hidden = false;
    el.replaceChildren(header(panel.title, dismissPanel), h('div', { class: 'side-body' }, panel.build()));
    return;
  }
  const serverId = state.route.name === 'server' ? state.route.serverId : null;
  if (!serverId || membersHidden) {
    shownServer = null;
    el.hidden = true;
    el.replaceChildren();
    return;
  }
  el.hidden = false;
  if (shownServer === serverId) return;
  shownServer = serverId;
  const body = h('div', { class: 'side-body members' });
  el.replaceChildren(header('Members', () => toggleMembers(false)), body);
  showMembers(body, serverId);
}

export function mountSide(aside) {
  el = aside;
  render();
}

on('layers', () => { if (panel && !currentLayers().includes('panel') && matchMedia('(max-width: 799px)').matches) closePanel(); });

// Moving somewhere else closes an open panel.
on('route', () => {
  if (panel) closePanel();
  else render();
});

// `build` returns the panel's contents; it runs again on refreshPanel(). Returns { close }.
export function openPanel({ title, build, onClose }) {
  closePanel();
  const mine = { title, build, onClose, release: onEscape(() => dismissPanel()) };
  pushLayer('panel');
  panel = mine;
  render();
  el.querySelector('.side-body input:not([readonly]), .side-body textarea')?.focus();
  return { close: () => { if (panel === mine) closePanel(); } };
}

export function closePanel() {
  if (!panel) return;
  const { release, onClose } = panel;
  panel = null;
  release();
  onClose?.();
  render();
}

export function refreshPanel() {
  if (panel) render();
}

export function membersShown() {
  return !membersHidden && !panel;
}

export function toggleMembers(show = !membersShown()) {
  membersHidden = !show;
  if (panel) closePanel();
  else render();
}
