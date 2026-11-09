import * as api from '../api.js';
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { inviteCard } from './serverPages.js';

const USERNAME = /^[a-z0-9_.]{2,32}$/i;

// A labelled input that shows a check mark once what's typed is acceptable.
function input(label, props, isValid, hint) {
  const control = h('input', { class: 'auth-input', ...props });
  const wrap = h('span', { class: 'auth-control' }, control, h('span', { class: 'auth-check', 'aria-hidden': 'true' }, icon('check', 14)));
  const check = () => wrap.classList.toggle('valid', isValid(control.value));
  control.addEventListener('input', check);
  return { control, el: h('label', { class: 'auth-field' }, h('span', { class: 'auth-label' }, label), wrap, hint && h('span', { class: 'auth-hint' }, hint)) };
}

// The art half of the screen: the logo drawn big, and what Opencord is for.
function showcase() {
  return h('aside', { class: 'auth-art', 'aria-hidden': 'true' },
    h('span', { class: 'auth-art-mark one' }, icon('logo', 520)),
    h('span', { class: 'auth-art-mark two' }, icon('logo', 260)),
    h('div', { class: 'auth-art-card' },
      h('strong', {}, 'No limits.', h('br'), 'Send anything.'),
      h('p', {}, 'Messages of any length and files of any size, with your friends, on a server you run yourself.')));
}

// The log in / create account screen. With an invite, it shows the server first and joins after signing in.
export function showAuth(root, invite) {
  let mode = invite ? 'register' : 'login';

  async function finish() {
    if (!invite) {
      location.reload();
      return;
    }
    const server = await api.post(`/api/invites/${invite.code}`).catch(() => null);
    location.href = server ? `/channels/${server.id}` : '/channels/@me';
  }

  function render() {
    const login = mode === 'login';
    const username = input('Username', {
      name: 'username', autocomplete: 'username', required: true, maxLength: 32, autocapitalize: 'none', spellcheck: false,
    }, (v) => USERNAME.test(v.trim()), !login && 'Letters, numbers, _ and . (2–32)');
    const displayName = input('Display name', { name: 'displayName', autocomplete: 'nickname', maxLength: 32, placeholder: 'Optional' },
      (v) => v.trim().length > 0);
    const password = input('Password', {
      name: 'password', type: 'password', required: true, minLength: login ? 1 : 8,
      autocomplete: login ? 'current-password' : 'new-password',
    }, (v) => v.length >= (login ? 1 : 8), !login && 'At least 8 characters');

    const error = h('p', { class: 'form-error', role: 'alert' });
    const submit = h('button', { type: 'submit', class: 'auth-submit' }, login ? 'Log in' : 'Create account', icon('arrowRight', 18));
    const form = h('form', {
      class: 'auth-form',
      onsubmit: async (event) => {
        event.preventDefault();
        error.textContent = '';
        submit.disabled = true;
        try {
          const body = { username: username.control.value.trim(), password: password.control.value };
          if (!login && displayName.control.value.trim()) body.displayName = displayName.control.value.trim();
          await api.post(login ? '/api/auth/login' : '/api/auth/register', body);
          await finish();
        } catch (err) {
          error.textContent = err.message;
          submit.disabled = false;
        }
      },
    }, username.el, !login && displayName.el, password.el, error, submit);

    root.replaceChildren(h('div', { class: 'auth' },
      h('main', { class: 'auth-main' },
        h('div', { class: 'auth-brand' }, icon('logo', 28), 'Opencord'),
        h('div', { class: 'auth-body' },
          h('h1', { class: 'auth-title' }, login ? 'Welcome back' : 'Sign up'),
          h('p', { class: 'auth-lead' }, invite ? "You've been invited to join" : login ? 'Log in to pick up where you left off.' : 'Make an account. It takes ten seconds.'),
          invite && inviteCard(invite),
          form,
          h('p', { class: 'auth-switch' }, login ? 'New here? ' : 'Already have an account? ',
            h('button', { type: 'button', onclick: () => { mode = login ? 'register' : 'login'; render(); } },
              login ? 'Create an account' : 'Log in')))),
      showcase()));
    username.control.focus();
  }

  render();
}
