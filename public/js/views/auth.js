import * as api from '../api.js';
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { inviteCard } from './serverPages.js';
import { authMusic } from './authMusic.js';

const USERNAME = /^[a-z0-9_.]{2,32}$/i;

// A labelled input that shows a check mark once what's typed is acceptable.
// A password field also gets a show / hide button on the right.
function input(label, props, isValid, hint) {
  const control = h('input', { class: 'auth-input', ...props });
  const reveal = props.type === 'password' && h('button', {
    type: 'button', class: 'auth-reveal', 'aria-label': 'Show password', title: 'Show password', 'aria-pressed': 'false',
    // Keep focus (and the caret) in the field.
    onpointerdown: (event) => event.preventDefault(),
    onclick: () => {
      const show = control.type === 'password';
      control.type = show ? 'text' : 'password';
      reveal.replaceChildren(icon(show ? 'eyeOff' : 'eye', 18));
      reveal.setAttribute('aria-pressed', String(show));
      reveal.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      reveal.title = show ? 'Hide password' : 'Show password';
    },
  }, icon('eye', 18));
  const wrap = h('span', { class: `auth-control${reveal ? ' has-reveal' : ''}` }, control,
    h('span', { class: 'auth-check', 'aria-hidden': 'true' }, icon('check', 14)), reveal);
  const check = () => wrap.classList.toggle('valid', isValid(control.value));
  control.addEventListener('input', check);
  return { control, el: h('label', { class: 'auth-field' }, h('span', { class: 'auth-label' }, label), wrap) };
}

// The art half of the screen: a fake chat racing upward, made of random people saying random things.
export const FEED_NAMES = ['mika', 'jordan', 'pixelfox', 'sam', 'nova', 'river', 'kai', 'ash', 'blue', 'theo', 'luna', 'zed', 'quinn', 'milo', 'ivy', 'rex', 'sora', 'echo'];
export const FEED_LINES = [
  'ok who is on tonight', 'lmaooo', 'gg', 'that was insane', 'brb food', 'wait what', 'no way', 'send the link',
  'anyone up for a game?', 'i am so tired', 'this bot is cracked', 'new emoji just dropped', 'who pinged me',
  'voice in 5?', 'its 3am why are we awake', 'yes', 'nah', 'real', 'bro', 'did you see that', 'pushed the fix',
  'cant believe that worked', 'one more round', 'w', 'thats crazy', 'ok im back', 'joining now', 'lol same',
  'hold on', 'loading...', 'skill issue', 'we need a 4th', 'who made this server', 'patch notes are out',
];
export const FEED_COLORS = ['#f87171', '#fb923c', '#facc15', '#4ade80', '#2dd4bf', '#60a5fa', '#a78bfa', '#f472b6'];
const pick = (list) => list[Math.floor(Math.random() * list.length)];

const CELL_W = 230; // width of one message slot in the honeycomb
const ROW_H = 74; // height of one row

function showcase() {
  const track = h('div', { class: 'auth-feed' });
  const art = h('aside', { class: 'auth-art', 'aria-hidden': 'true' }, track);
  const speed = matchMedia('(prefers-reduced-motion: reduce)').matches ? 8 : 22; // pixels per second
  let minute = 8 * 60 + Math.floor(Math.random() * 600);
  let odd = false;

  const message = () => {
    const name = pick(FEED_NAMES);
    const color = FEED_COLORS[FEED_NAMES.indexOf(name) % FEED_COLORS.length];
    if (Math.random() < 0.3) minute = (minute + 1) % 1440;
    const time = `${((Math.floor(minute / 60) + 11) % 12) + 1}:${String(minute % 60).padStart(2, '0')} ${minute < 720 ? 'AM' : 'PM'}`;
    return h('div', { class: 'auth-feed-msg', style: { width: `${CELL_W}px` } },
      h('span', { class: 'auth-feed-avatar', style: { background: color } }, name[0].toUpperCase(),
        // Half of them show a status, like the real member list.
        Math.random() < 0.5 && h('span', { class: `presence ${pick(['online', 'online', 'idle', 'dnd', 'offline'])}` })),
      h('div', { class: 'auth-feed-text' },
        h('div', { class: 'auth-feed-head' }, h('b', { style: { color } }, name), h('time', {}, time)),
        typed(pick(FEED_LINES), first ? Math.random() * 2500 : 2200 + Math.random() * 3000)));
  };
  // A line that shows typing dots, then types itself out one letter at a time.
  const typed = (text, delay) => {
    const line = h('div', { class: 'auth-feed-line typing' });
    let i = 0;
    const step = () => {
      if (!line.isConnected && i) return;
      line.classList.remove('typing');
      line.textContent = text.slice(0, ++i);
      if (i < text.length) setTimeout(step, 35 + Math.random() * 70);
    };
    setTimeout(step, delay);
    return line;
  };
  let first = true;
  // Phones shrink the chat with CSS zoom; sizes and speed below are in the feed's own (zoomed) pixels.
  const zoom = () => parseFloat(getComputedStyle(track).zoom) || 1;
  // Rows alternate between two offsets, half a slot apart, so the slots sit like a honeycomb.
  // Enough messages to cross the art, or the whole window if it's wider (it may be widened later).
  const cols = () => Math.ceil(Math.max(art.clientWidth, innerWidth) / (CELL_W * zoom())) + 1;
  const row = () => {
    const el = h('div', { class: 'auth-feed-row', style: { height: `${ROW_H}px`, transform: `translateX(${odd ? -CELL_W / 2 : 0}px)` } },
      ...Array.from({ length: cols() }, message));
    odd = !odd;
    return el;
  };
  // A wider window: lengthen the rows already there.
  const widen = () => {
    if (!art.isConnected) return removeEventListener('resize', widen);
    const want = cols();
    for (const el of track.children) while (el.children.length < want) el.append(message());
  };
  addEventListener('resize', widen);
  const fill = () => {
    const need = Math.ceil((art.clientHeight || 900) / (ROW_H * zoom())) + 2;
    while (track.children.length < need) track.append(row());
    first = false;
  };

  let offset = 0;
  let last = 0;
  const frame = (now) => {
    if (last && !art.isConnected) return;
    if (!track.children.length && art.clientHeight) fill();
    offset += last ? ((now - last) / 1000) * (speed / zoom()) : 0; // same on-screen speed at any zoom
    last = now;
    // A row that has scrolled fully off the top goes away and a new one joins at the bottom.
    while (offset >= ROW_H && track.firstChild) {
      offset -= ROW_H;
      track.firstChild.remove();
      fill();
    }
    track.style.transform = `translateY(${-offset}px)`;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  return art;
}

// Google and Discord sign-in, shown but not wired up yet.
const OAUTH_LOGOS = {
  Google: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.3-1.6 3.8-5.5 3.8-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.2 14.6 2.2 12 2.2 6.6 2.2 2.2 6.6 2.2 12s4.4 9.8 9.8 9.8c5.7 0 9.4-4 9.4-9.6 0-.6-.1-1.1-.2-1.6H12z"/></svg>',
  Discord: '<svg viewBox="0 0 24 24" width="20" height="20"><path fill="#5865F2" d="M20.3 4.4A19.6 19.6 0 0 0 15.4 3l-.6 1.3a18 18 0 0 0-5.6 0L8.6 3a19.5 19.5 0 0 0-4.9 1.5C.6 9.1-.3 13.6.1 18.1a19.8 19.8 0 0 0 6 3l1.3-2a12.7 12.7 0 0 1-2-1l.5-.4a14 14 0 0 0 12.2 0l.5.4c-.6.4-1.3.7-2 1l1.3 2a19.7 19.7 0 0 0 6-3c.5-5.2-.9-9.7-3.6-13.7zM8 15.4c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4zm8 0c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4z"/></svg>',
};
function oauthButtons() {
  const button = (name) => {
    const logo = h('span', { class: 'auth-oauth-logo' });
    logo.innerHTML = OAUTH_LOGOS[name];
    return h('button', { type: 'button', class: 'auth-oauth', disabled: true, title: 'Coming soon' }, logo, name);
  };
  return h('div', { class: 'auth-oauth-wrap' },
    h('div', { class: 'auth-oauth-row' }, button('Google'), button('Discord')),
    h('div', { class: 'auth-or' }, 'OR'));
}

// The log in / create account screen. With an invite, it shows the server first and joins after signing in.
// With `add`, it's adding another account to this browser: the open one stays logged in, to switch back to.
export function showAuth(root, invite, { add = false } = {}) {
  let mode = add ? 'login' : 'register';

  // Music on this screen (not when adding another account): fades out as the app opens.
  const music = add ? null : authMusic();

  async function finish() {
    await music?.fadeOut();
    if (!invite) {
      location.reload();
      return;
    }
    const server = await api.post(`/api/invites/${invite.code}`).catch(() => null);
    location.href = server ? `/channels/${server.id}` : '/channels/@me';
  }

  // Built once, so switching between sign up and log in keeps the chat running instead of starting over.
  const art = showcase();

  function render() {
    const login = mode === 'login';
    const username = input('Username', {
      name: 'username', autocomplete: 'username', required: true, maxLength: 32, autocapitalize: 'none', spellcheck: false,
    }, (v) => USERNAME.test(v.trim()));
    const password = input('Password', {
      name: 'password', type: 'password', required: true, minLength: login ? 1 : 8,
      autocomplete: login ? 'current-password' : 'new-password',
    }, (v) => v.length >= (login ? 1 : 8));

    const error = h('p', { class: 'form-error', role: 'alert' });
    const submit = h('button', { type: 'submit', class: 'auth-submit' }, login ? 'Log in' : 'Create account', icon('arrowRight', 18));
    const form = h('form', {
      class: 'auth-form',
      onsubmit: async (event) => {
        event.preventDefault();
        error.textContent = '';
        submit.disabled = true;
        try {
          // A new account's display name starts as its username; it can be changed in settings.
          const body = { username: username.control.value.trim(), password: password.control.value, add };
          // With an invite, sign-up works even when this Opencord only lets invited people in.
          if (!login && invite) body.inviteCode = invite.code;
          await api.post(login ? '/api/auth/login' : '/api/auth/register', body);
          await finish();
        } catch (err) {
          error.textContent = err.message;
          submit.disabled = false;
        }
      },
    }, username.el, password.el, error, submit);

    root.replaceChildren(h('div', { class: 'auth' },
      h('main', { class: 'auth-main' },
        h('div', { class: 'auth-brand' }, icon('logo', 34), 'Opencord'),
        h('div', { class: 'auth-body' },
          h('h1', { class: 'auth-title' }, add ? (login ? 'Add an account' : 'Make another account') : login ? 'Welcome back' : 'Sign up'),
          (add || invite) && h('p', { class: 'auth-lead' }, add ? 'You stay logged in to your other accounts and can switch between them any time.'
            : "You've been invited to join"),
          invite && inviteCard(invite),
          oauthButtons(),
          form,
          h('p', { class: 'auth-switch' }, login ? 'New here? ' : 'Already have an account? ',
            h('button', { type: 'button', onclick: () => { mode = login ? 'register' : 'login'; render(); } },
              login ? 'Create an account' : 'Log in')),
          add && h('p', { class: 'auth-switch' }, h('button', { type: 'button', onclick: () => location.reload() }, 'Back to Opencord')))),
      art,
      music?.el));
    username.control.focus();
  }

  render();
}
