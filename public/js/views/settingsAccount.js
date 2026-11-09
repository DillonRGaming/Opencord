import * as api from '../api.js';
import { h } from '../dom.js';
import { state } from '../store.js';
import { logout } from '../actions.js';
import { formatDate } from '../format.js';
import { button, field, form, toast } from '../ui.js';

export function accountPage() {
  const { me } = state;
  const current = h('input', { class: 'input', type: 'password', required: true, autocomplete: 'current-password' });
  const next = h('input', { class: 'input', type: 'password', required: true, minLength: 8, maxLength: 200, autocomplete: 'new-password' });

  return [
    h('p', { class: 'modal-text' }, `Logged in as @${me.username}. Account created ${formatDate(me.createdAt)}.`),
    h('div', { class: 'modal-section' }, h('h3', {}, 'Change password'),
      form({
        submitLabel: 'Change password',
        onSubmit: async () => {
          await api.put('/api/users/@me/password', { currentPassword: current.value, newPassword: next.value });
          current.value = '';
          next.value = '';
          toast('Password changed. Other devices have been logged out.', 'ok');
        },
      }, field('Current password', current), field('New password', next, 'At least 8 characters.'))),
    h('div', { class: 'modal-section' }, h('h3', {}, 'Log out'),
      h('div', {}, button('Log out of this device', logout, 'danger'))),
  ];
}
