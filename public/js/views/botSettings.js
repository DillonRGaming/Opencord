// A bot's settings page: its profile (name, picture, status, bio, banner) like a person's, plus switching it
// on or off, making it an admin, and shortcuts to its blocks and AI.
import * as api from '../api.js';
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { attempt, button, settingRow, settingsCard, switchControl, toast } from '../ui.js';
import { openPage } from './page.js';
import { profileEditor } from './settingsProfile.js';

export function openBotSettings(server, bot) {
  const base = `/api/servers/${server.id}/bots/${bot.id}`;
  // Every change returns the whole bot; keep our copy current and hand back its user for the editor.
  const heading = h('span', {}, bot.user.displayName);
  const take = (updated) => { Object.assign(bot, updated); heading.textContent = bot.user.displayName; return bot.user; };

  const aiState = () => (bot.ai?.enabled && bot.ai?.model ? `On · ${bot.ai.modelName || bot.ai.model}` : 'Off');
  const aiLine = h('span', { class: 'setting-hint' }, aiState());

  const openBuilder = async (options) => {
    const { openBotBuilder } = await import('./botBuilder.js');
    openBotBuilder(server, bot, options);
  };

  const botCard = settingsCard('Bot',
    settingRow('Switched on', switchControl(Boolean(bot.enabled), (on) => attempt(async () => {
      take(await api.patch(base, { enabled: on }));
      toast(on ? `${bot.user.displayName} is on.` : `${bot.user.displayName} is off: no blocks or AI run.`, 'ok');
    }), 'Switched on')),
    settingRow('Admin (unlocks the Admin and Roles blocks)', switchControl(Boolean(bot.admin), (on) => attempt(async () => {
      take(await api.patch(base, { admin: on }));
      toast(on ? `${bot.user.displayName} is an admin now.` : `${bot.user.displayName} is no longer an admin.`, 'ok');
    }), 'Admin')),
    settingRow(h('span', {}, 'AI ', aiLine), button('AI settings', () => openBuilder({ ai: true }), 'ghost small')),
    settingRow(`${bot.program.length} script${bot.program.length === 1 ? '' : 's'}`, button('Edit blocks', () => openBuilder(), 'ghost small')),
    settingRow('Username', h('code', {}, `@${bot.user.username}`)));

  const editor = profileEditor({
    user: bot.user,
    extraAvatars: ['bot'],
    labels: { about: 'About the bot', bioLabel: 'Bio', bio: 'What this bot does', status: 'Playing with blocks', save: 'Save bot profile' },
    save: async (fields) => {
      const user = take(await api.patch(`${base}/profile`, fields));
      toast('Bot profile saved.', 'ok');
      return user;
    },
    uploadAvatar: async (file) => take(await api.putFile(`${base}/avatar`, file)),
    defaultAvatar: async (n) => take(await api.put(`${base}/avatar/default/${n}`)),
    removeAvatar: async () => take(await api.del(`${base}/avatar`)),
  });

  return openPage({
    title: 'Bot settings',
    actions: h('span', { class: 'bot-settings-name' }, icon('bot', 18), heading),
    content: h('div', { class: 'bot-settings' }, botCard, editor),
  });
}
