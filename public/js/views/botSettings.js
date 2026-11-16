// A bot's profile (name, picture, status, bio, banner), shown in the bot workspace's Profile tab, plus
// deleting the bot. Opening "bot settings" from elsewhere goes to that tab.
import * as api from '../api.js';
import { h } from '../dom.js';
import { confirmButton, settingRow, toast } from '../ui.js';
import { navigate, paths } from '../router.js';
import { profileEditor } from './settingsProfile.js';

export function openBotSettings(server, bot) {
  navigate(paths.bots(server.id, bot.id, 'profile'));
}

// `onChange(bot)` hears about every saved change; `onDelete()` runs after the bot is deleted.
export function botProfileView(server, bot, { onChange, onDelete }) {
  const base = `/api/servers/${server.id}/bots/${bot.id}`;
  const take = (updated) => { Object.assign(bot, updated); onChange?.(bot); return bot.user; };

  const editor = profileEditor({
    user: bot.user,
    extraAvatars: ['bot'],
    labels: { about: 'About the bot', bioLabel: 'Bio', bio: 'What this bot does', status: 'Playing with blocks', save: 'Save profile' },
    save: async (fields) => {
      const user = take(await api.patch(`${base}/profile`, fields));
      toast('Profile saved.', 'ok');
      return user;
    },
    uploadAvatar: async (file) => take(await api.putFile(`${base}/avatar`, file)),
    defaultAvatar: async (n) => take(await api.put(`${base}/avatar/default/${n}`)),
    removeAvatar: async () => take(await api.del(`${base}/avatar`)),
  });

  const danger = h('section', { class: 'settings-card danger' }, h('h2', { class: 'settings-card-title' }, 'Danger zone'),
    settingRow(`Delete ${bot.user.displayName} and all its blocks`, confirmButton({
      label: 'Delete bot', confirmLabel: 'Click again to delete',
      onConfirm: async () => { await api.del(base); onDelete?.(); },
    })));

  return h('div', { class: 'bot-profile' }, editor, danger);
}
