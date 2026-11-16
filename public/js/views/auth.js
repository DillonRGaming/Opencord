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

// The art half of the screen: the logo drawn big.
function showcase() {
  return h('aside', { class: 'auth-art', 'aria-hidden': 'true' },
    h('span', { class: 'auth-art-mark one' }, icon('logo', 520)),
    h('span', { class: 'auth-art-mark two' }, icon('logo', 260)));
}

// The log in / create account screen. With an invite, it shows the server first and joins after signing in.
// With `add`, it's adding another account to this browser: the open one stays logged in, to switch back to.
export function showAuth(root, invite, { add = false } = {}) {
  let mode = add ? 'login' : 'register';

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
          h('p', { class: 'auth-lead' }, add ? 'You stay logged in to your other accounts and can switch between them any time.'
            : invite ? "You've been invited to join" : login ? 'Log in to pick up where you left off.' : 'Make an account. It takes ten seconds.'),
          invite && inviteCard(invite),
          form,
          h('p', { class: 'auth-switch' }, login ? 'New here? ' : 'Already have an account? ',
            h('button', { type: 'button', onclick: () => { mode = login ? 'register' : 'login'; render(); } },
              login ? 'Create an account' : 'Log in')),
          add && h('p', { class: 'auth-switch' }, h('button', { type: 'button', onclick: () => location.reload() }, 'Back to Opencord')))),
      showcase()));
    username.control.focus();
  }

  render();
}
