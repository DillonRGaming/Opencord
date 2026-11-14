import * as api from '../api.js';
import { h } from '../dom.js';
import { state } from '../store.js';
import { logout, listAccounts, switchAccount, addAccount, removeAccount } from '../actions.js';
import { icon } from '../icons.js';
import { formatDate } from '../format.js';
import { attempt, avatar, button, confirmButton, field, form, settingRow, settingsCard, settingsHero, toast } from '../ui.js';

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
    accountsCard(),
    settingsCard('Session', settingRow('Log out of this account', button('Log out', logout, 'danger'))),
  ];
}

// Every account logged in on this browser. Each keeps its own settings, DMs and servers; switching reloads.
function accountsCard() {
  const list = h('div', { class: 'manage-list' }, h('p', { class: 'loading' }, 'Loading…'));
  const draw = () => listAccounts().then((accounts) => {
    list.replaceChildren(...accounts.map((user) => h('div', { class: 'manage-row' },
      avatar(user, { size: 36 }),
      h('span', { class: 'manage-main' }, h('strong', {}, user.displayName), h('span', {}, `@${user.username}`)),
      h('span', { class: 'manage-actions always' }, user.current
        ? h('span', { class: 'tag' }, 'Open now')
        : [
          button('Switch', () => attempt(() => switchAccount(user.id)), 'ghost small'),
          confirmButton({
            label: `Remove ${user.displayName} from this device`, confirmLabel: 'Remove?', face: icon('x'), className: 'icon-button danger',
            onConfirm: async () => { await removeAccount(user.id); draw(); },
          }),
        ]))));
  }).catch(() => list.replaceChildren());
  draw();
  return settingsCard('Accounts on this device', list, h('div', {}, button('Add an account', () => addAccount(), 'primary small')));
}
