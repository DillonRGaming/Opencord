import * as api from '../api.js';
import { h } from '../dom.js';
import { state } from '../store.js';
import { setMe } from '../actions.js';
import { attempt, button, field, form, pickFiles, settingRow, settingsCard, toast } from '../ui.js';
import { DEFAULTS } from '../theme.js';
import { profileCard } from './profileCard.js';

const IMAGE_TYPES = 'image/png,image/jpeg,image/gif,image/webp';

export function profilePage() {
  const { me } = state;
  let bannerColor = me.bannerColor;

  const displayName = h('input', { class: 'input', required: true, maxLength: 32, value: me.displayName });
  const statusText = h('input', { class: 'input', maxLength: 128, value: me.statusText, placeholder: 'What are you up to?' });
  const bio = h('textarea', { class: 'textarea', maxLength: 190, value: me.bio, placeholder: 'A few words about you' });
  const banner = h('input', { class: 'color-input', type: 'color', value: bannerColor || state.me.settings.accent || DEFAULTS.accent });
  const preview = h('div');

  // The preview shows what is typed, before it is saved.
  function draw() {
    preview.replaceChildren(profileCard({
      ...state.me,
      displayName: displayName.value || me.username,
      statusText: statusText.value,
      bio: bio.value,
      bannerColor,
    }));
  }
  for (const input of [displayName, statusText, bio]) input.addEventListener('input', draw);
  banner.addEventListener('input', () => { bannerColor = banner.value; draw(); });

  async function changeAvatar() {
    const [file] = await pickFiles({ accept: IMAGE_TYPES });
    if (!file) return;
    await attempt(async () => setMe(await api.putFile('/api/users/@me/avatar', file)));
    draw();
  }

  async function removeAvatar() {
    await attempt(async () => setMe(await api.del('/api/users/@me/avatar')));
    draw();
  }

  const editor = form({
    submitLabel: 'Save profile',
    onSubmit: async () => {
      setMe(await api.patch('/api/users/@me', {
        displayName: displayName.value, statusText: statusText.value, bio: bio.value, bannerColor,
      }));
      toast('Profile saved.', 'ok');
    },
  },
  settingsCard('Avatar', settingRow('Profile picture',
    [button('Change', changeAvatar, 'ghost small'), button('Remove', removeAvatar, 'ghost small')])),
  settingsCard('About you', field('Display name', displayName), field('Status', statusText), field('About me', bio)),
  settingsCard('Banner', settingRow('Banner colour',
    [banner, button('Use accent colour', () => { bannerColor = null; draw(); }, 'ghost small')])));

  draw();
  editor.classList.add('settings-content');
  return [h('div', { class: 'profile-editor' }, editor,
    h('div', { class: 'profile-preview' }, settingsCard('Preview', preview)))];
}
