import { h } from '../dom.js';
import { state, on, emit } from '../store.js';
import { iconButton } from '../ui.js';
import { onEscape } from '../escape.js';
import { showMembers } from './members.js';
import { pushLayer, leaveLayer, currentLayers } from '../router.js';

// The column on the right. It shows one thing at a time: a panel someone opened (a profile, an invite
// link, the channel editor…) or, inside a server, the member list. Panels take the place of pop-up dialogs.

let el = null;
let panel = null; // { title, build, onClose, release }
// Whether the member list is hidden is remembered in this browser. Phones always start with it hidden.
const MEMBERS_KEY = 'opencord:members-hidden';
const readPref = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
const writePref = (key, value) => { try { localStorage.setItem(key, value); } catch { /* private mode */ } };
let membersHidden = matchMedia('(max-width: 799px)').matches || readPref(MEMBERS_KEY) === '1';
let shownServer = null; // the server whose member list is on screen, so switching channels doesn't redraw it

// extraClass on the ✕: the member list's is only shown on phones; on wider screens the header's toggle closes it.
function header(title, onClose, extraClass = '') {
  return h('header', { class: 'side-header' }, h('h2', {}, title), iconButton('x', 'Close', onClose, extraClass));
}

// Closed by the person (✕ or Escape), not by moving to another chat: says so, so preferences can follow.
export function dismissPanel() {
  emit('panel:dismissed', panel?.title);
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
  el.replaceChildren(header('Members', () => toggleMembers(false), 'phone-only'), body);
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
  if (matchMedia('(hover: hover)').matches) el.querySelector('.side-body input:not([readonly]), .side-body textarea')?.focus();
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
  if (!matchMedia('(max-width: 799px)').matches) writePref(MEMBERS_KEY, membersHidden ? '1' : '0');
  if (panel) closePanel();
  else render();
}

// The Members toggle every server channel's header has, in the same place (last, on the right).
export function membersButton() {
  const el = iconButton('users', 'Members', () => {
    toggleMembers();
    el.setAttribute('aria-pressed', String(membersShown()));
  });
  el.setAttribute('aria-pressed', String(membersShown()));
  return el;
}
