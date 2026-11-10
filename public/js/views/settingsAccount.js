import * as api from '../api.js';
import { h } from '../dom.js';
import { state } from '../store.js';
import { logout } from '../actions.js';
import { formatDate } from '../format.js';
import { avatar, button, field, form, settingRow, settingsCard, settingsHero, toast } from '../ui.js';

export function accountPage() {
  const { me } = state;
  const current = h('input', { class: 'input', type: 'password', required: true, autocomplete: 'current-password' });
  const next = h('input', { class: 'input', type: 'password', required: true, minLength: 8, maxLength: 200, autocomplete: 'new-password' });

  return [
    settingsHero(avatar(me, { size: 72 }), me.displayName, `@${me.username} · joined ${formatDate(me.createdAt)}`),
    settingsCard('Password',
      form({
        submitLabel: 'Change password',
        onSubmit: async () => {
          await api.put('/api/users/@me/password', { currentPassword: current.value, newPassword: next.value });
          current.value = '';
          next.value = '';
          toast('Password changed. Other devices have been logged out.', 'ok');
        },
      }, field('Current password', current), field('New password', next))),
    settingsCard('Session', settingRow('Log out of this device', button('Log out', logout, 'danger'))),
  ];
}
