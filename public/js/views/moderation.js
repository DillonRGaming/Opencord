import * as api from '../api.js';
import { h } from '../dom.js';
import { avatar, field, form, segmented, settingRow, settingsCard, settingsHero, toast } from '../ui.js';
import { openPage } from './page.js';

const TIMEOUTS = [[60, '1 min'], [300, '5 min'], [600, '10 min'], [3600, '1 hour'], [86400, '1 day'], [7 * 86400, '1 week']];
const TITLES = { ban: 'Ban', kick: 'Kick', timeout: 'Time out' };

// Kick, ban or time out someone, with an optional reason that goes in the audit log.
export function openModerate(server, user, action) {
  let seconds = 600;
  const reason = h('textarea', { class: 'textarea', maxLength: 500, placeholder: 'Reason (only admins see this, in the audit log)' });
  const page = openPage({
    title: `${TITLES[action]} ${user.displayName}`,
    icon: 'shield',
    content: h('div', { class: 'settings-content' },
      settingsHero(avatar(user, { size: 72 }), user.displayName, `@${user.username}`),
      settingsCard(TITLES[action], form({
        submitLabel: TITLES[action],
        kind: 'danger',
        onSubmit: async () => {
          const body = { reason: reason.value };
          if (action === 'ban') await api.put(`/api/servers/${server.id}/bans/${user.id}`, body);
          if (action === 'kick') await api.del(`/api/servers/${server.id}/members/${user.id}`, body);
          if (action === 'timeout') await api.put(`/api/servers/${server.id}/members/${user.id}/timeout`, { ...body, seconds });
          toast({ ban: `${user.displayName} is banned.`, kick: `${user.displayName} was kicked.`, timeout: `${user.displayName} is timed out.` }[action], 'ok');
          page.close();
        },
      }, action === 'timeout' && settingRow('Length', segmented(TIMEOUTS, seconds, (value) => { seconds = value; })),
      field('Reason', reason)))),
  });
}
