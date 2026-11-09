import * as api from '../api.js';
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { field, form } from '../ui.js';
import { inviteCard } from './serverPages.js';

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
    const username = h('input', { class: 'input', name: 'username', autocomplete: 'username', required: true, maxLength: 32, autocapitalize: 'none', spellcheck: false });
    const displayName = h('input', { class: 'input', name: 'displayName', autocomplete: 'nickname', maxLength: 32 });
    const password = h('input', {
      class: 'input', name: 'password', type: 'password', required: true, minLength: login ? 1 : 8,
      autocomplete: login ? 'current-password' : 'new-password',
    });

    const fields = login
      ? [field('Username', username), field('Password', password)]
      : [
        field('Username', username, '2–32 characters: letters, numbers, _ and .'),
        field('Display name (optional)', displayName),
        field('Password', password, 'At least 8 characters.'),
      ];

    const card = h('div', { class: 'auth-card' },
      h('div', { class: 'auth-brand' }, icon('logo', 30), 'Opencord'),
      invite
        ? [h('p', { class: 'auth-lead' }, "You've been invited to join"), inviteCard(invite)]
        : h('p', { class: 'auth-lead' }, login ? 'Welcome back.' : 'Create an account to start chatting.'),
      form({
        submitLabel: login ? 'Log in' : 'Create account',
        onSubmit: async () => {
          const body = { username: username.value.trim(), password: password.value };
          if (!login && displayName.value.trim()) body.displayName = displayName.value.trim();
          await api.post(login ? '/api/auth/login' : '/api/auth/register', body);
          await finish();
        },
      }, fields),
      h('p', { class: 'auth-switch' }, login ? 'New here? ' : 'Already have an account? ',
        h('button', { type: 'button', onclick: () => { mode = login ? 'register' : 'login'; render(); } },
          login ? 'Create an account' : 'Log in')));

    root.replaceChildren(h('div', { class: 'auth' }, card));
    username.focus();
  }

  render();
}
