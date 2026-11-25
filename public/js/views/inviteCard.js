// An invite link in a message shows as a short wide card: the server's icon, name and size over a faint
// drifting chat (like the sign-up page's), with a Join button, or Open once you're in.
import * as api from '../api.js';
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { state } from '../store.js';
import { navigate, paths } from '../router.js';
import { joinInvite } from '../actions.js';
import { iconButton, serverIcon, toast } from '../ui.js';
import { FEED_COLORS, FEED_LINES, FEED_NAMES } from './auth.js';

const MAX_CARDS = 3;
const HOSTS = [...new Set([location.host, 'orbital.monster', 'www.orbital.monster'])].map((x) => x.replace(/\./g, '\\.'));
const LINK = new RegExp(`https?://(?:${HOSTS.join('|')})/invite/([a-z0-9]+)`, 'gi');
const lookups = new Map(); // code → Promise<invite | null>

export function inviteCodes(text) {
  return [...new Set([...String(text || '').matchAll(LINK)].map((m) => m[1].toLowerCase()))].slice(0, MAX_CARDS);
}

export const isInviteLink = (url) => inviteCodes(url).length > 0;

// The message's text without its invite links: the cards stand in for them (each has a copy button).
export const withoutInviteLinks = (text) => String(text || '').replace(LINK, '').replace(/[ \t]{2,}/g, ' ').trim();

const lookup = (code) => {
  if (!lookups.has(code)) lookups.set(code, api.get(`/api/invites/${code}`).catch(() => null));
  return lookups.get(code);
};

// Behind the card: a small copy of the sign-up page's art, a chat of made-up people drifting upward,
// blurred at the top and bottom. Seeded by the server, so each server's card always looks the same.
function backdrop(seed) {
  let n = [...seed].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) || 1;
  const next = () => { n = (n * 9301 + 49297) % 233280; return n / 233280; };
  const pick = (list) => list[Math.floor(next() * list.length)];
  const message = () => {
    const name = pick(FEED_NAMES);
    const color = FEED_COLORS[FEED_NAMES.indexOf(name) % FEED_COLORS.length];
    const minute = Math.floor(next() * 720);
    const time = `${Math.floor(minute / 60) + 1}:${String(minute % 60).padStart(2, '0')} PM`;
    return h('div', { class: 'invite-embed-msg' },
      h('span', { class: 'invite-embed-avatar', style: { background: color } }, name[0].toUpperCase()),
      h('div', {},
        h('div', { class: 'invite-embed-head' }, h('b', { style: { color } }, name), h('time', {}, time)),
        h('div', { class: 'invite-embed-line' }, pick(FEED_LINES))));
  };
  // Two identical halves, so moving up by exactly one half loops without a jump.
  const half = h('div', { class: 'invite-embed-half' }, Array.from({ length: 8 }, () => h('div', { class: 'invite-embed-row' }, message(), message(), message(), message())));
  // Each card starts somewhere different in the drift.
  const feed = h('div', { class: 'invite-embed-feed', style: { animationDelay: `${-Math.random() * 120}s` } }, half, half.cloneNode(true));
  return h('div', { class: 'invite-embed-art', 'aria-hidden': 'true' }, feed);
}

function card(code, invite) {
  const { server } = invite;
  const joined = state.servers.has(server.id);
  const open = () => {
    const here = state.servers.get(server.id);
    navigate(paths.channel(server.id, here?.channels?.[0]?.id));
  };
  const button = h('button', {
    type: 'button', class: 'button primary invite-card-join',
    onclick: async () => {
      if (state.servers.has(server.id)) return open();
      button.disabled = true;
      button.textContent = 'Joining…';
      try {
        await joinInvite(code);
      } catch (err) {
        toast(err.message);
        button.disabled = false;
        button.textContent = 'Join server';
      }
    },
  }, joined ? 'Open server' : 'Join server');
  const link = `${location.origin}/invite/${code}`;
  const copy = iconButton('copy', 'Copy invite link', async () => {
    await navigator.clipboard.writeText(link).catch(() => {});
    copy.replaceChildren(h('span', { class: 'invite-embed-copied' }, 'Copied'));
    setTimeout(() => copy.replaceChildren(icon('copy')), 1500);
  }, 'invite-embed-copy');
  const members = server.memberCount === 1 ? '1 member' : `${server.memberCount} members`;
  return h('div', { class: 'invite-embed' },
    backdrop(server.id),
    h('div', { class: 'invite-embed-body' },
      serverIcon(server, 48),
      h('div', { class: 'invite-embed-text' },
        h('strong', { class: 'invite-embed-name' }, server.name),
        h('span', { class: 'invite-embed-members' }, members)),
      copy,
      button));
}

// Cards for every invite link in a message (filled in once each invite is looked up).
export function inviteCards(text) {
  const codes = inviteCodes(text);
  if (!codes.length) return null;
  const box = h('div', { class: 'invite-embeds' });
  for (const code of codes) {
    const slot = h('div', { class: 'invite-embed loading' });
    box.append(slot);
    lookup(code).then((invite) => {
      slot.replaceWith(invite
        ? card(code, invite)
        : h('div', { class: 'invite-embed dead' }, backdrop(code), h('div', { class: 'invite-embed-body' },
          h('span', { class: 'invite-embed-dead' }, 'This invite has expired or been used up'))));
    });
  }
  return box;
}
