import * as api from '../api.js';
import { lockMaker } from './botFace.js';
import { h } from '../dom.js';
import { state } from '../store.js';
import { setMe } from '../actions.js';
import { attempt, button, colorFor, field, form, pickFiles, settingRow, settingsCard, toast } from '../ui.js';
import { DEFAULTS } from '../theme.js';
import { profileCard } from './profileCard.js';
import { colorField } from '../colorPicker.js';
import { edgeColor } from '../imageColor.js';
import { PATTERNS, bannerStyle } from '../patterns.js';

// A setting row with its control under the label, full width (for grids of choices).
const stacked = (row) => { row.classList.add('stacked'); return row; };

const IMAGE_TYPES = 'image/png,image/jpeg,image/gif,image/webp';

export function profilePage() {
  return profileEditor({
    user: state.me,
    accent: state.me.settings.accent || DEFAULTS.accent,
    save: async (fields) => { setMe(await api.patch('/api/users/@me', fields)); toast('Profile saved.', 'ok'); return state.me; },
    uploadAvatar: async (file) => { setMe(await api.putFile('/api/users/@me/avatar', file)); return state.me; },
    defaultAvatar: async (n) => { setMe(await api.put(`/api/users/@me/avatar/default/${n}`)); return state.me; },
    removeAvatar: async () => { setMe(await api.del('/api/users/@me/avatar')); return state.me; },
  });
}

// The profile form with a live preview, for yourself or for a bot. Each callback saves and resolves the
// updated user.
// `extraAvatars` are more built-in pictures offered first; `avatarChoices` replaces the whole list; `avatarMaker(onChange)`
// replaces the list with a maker (people get the lock, bots the face); what's made shows in the preview and saves with the profile.
export function profileEditor({ user, accent = DEFAULTS.accent, save, uploadAvatar, defaultAvatar, removeAvatar, labels = {}, extraAvatars = [], avatarChoices = null, avatarMaker = lockMaker }) {
  let me = user;
  let bannerColor = me.bannerColor;
  let bannerPattern = me.bannerPattern;
  let bannerPatternColor = me.bannerPatternColor;

  const displayName = h('input', { class: 'input', required: true, maxLength: 32, value: me.displayName });
  const statusText = h('input', { class: 'input', maxLength: 128, value: me.statusText, placeholder: labels.status || 'What are you up to?' });
  const bio = h('textarea', { class: 'textarea', maxLength: 190, value: me.bio, placeholder: labels.bio || 'A few words about you' });
  const banner = colorField({
    value: bannerColor || accent, label: 'Banner colour',
    onInput: (c) => { bannerColor = c; draw(); }, onChange: (c) => { bannerColor = c; draw(); },
  });
  const preview = h('div');
  // A picture made in the maker: shown in the preview right away, uploaded when the profile is saved.
  let made = null; // { url, file() }

  // The preview shows what is typed, before it is saved.
  function draw() {
    preview.replaceChildren(profileCard({
      ...me,
      avatar: made ? made.url : me.avatar,
      displayName: displayName.value || me.username,
      statusText: statusText.value,
      bio: bio.value,
      bannerColor, bannerPattern, bannerPatternColor,
    }));
    drawPatterns();
  }
  for (const input of [displayName, statusText, bio]) input.addEventListener('input', draw);

  async function changeAvatar() {
    const [file] = await pickFiles({ accept: IMAGE_TYPES });
    if (!file) return;
    await attempt(async () => { me = await uploadAvatar(file); made = null; });
    drawDefaults();
    draw();
  }

  // The built-in avatars: the logo on each colour. Clicking one sets it straight away.
  const DEFAULT_AVATARS = 10;
  const defaults = h('div', { class: 'swatches avatar-swatches' });
  function drawDefaults() {
    const names = avatarChoices || [...extraAvatars, ...Array.from({ length: DEFAULT_AVATARS }, (_, i) => i + 1)];
    defaults.replaceChildren(...names.map((n) => {
      const src = `/avatars/${n}.svg`;
      return h('button', {
        type: 'button', class: 'swatch avatar-swatch', 'aria-label': String(n).startsWith('bot') ? 'Bot face' : `Default avatar ${n}`,
        'aria-pressed': String(me.avatar?.split('?')[0] === src),
        onclick: () => pickDefault(n),
      }, h('img', { src, alt: '', draggable: false }));
    }));
  }
  async function pickDefault(n) {
    await attempt(async () => { me = await defaultAvatar(n); });
    drawDefaults();
    draw();
  }

  // Pattern tiles: each shows the pattern on the current banner colour. "None" clears it.
  const patterns = h('div', { class: 'pattern-swatches' });
  function drawPatterns() {
    const options = [[null, 'None'], ...PATTERNS.map(([id, label]) => [id, label])];
    patterns.replaceChildren(...options.map(([id, label]) => h('button', {
      type: 'button', class: 'pattern-swatch', title: label, 'aria-label': id ? `${label} pattern` : 'No pattern',
      'aria-pressed': String((bannerPattern || null) === id),
      style: { ...bannerStyle({ bannerColor, bannerPattern: id, bannerPatternColor }) },
      onclick: () => { bannerPattern = id; draw(); },
    })));
  }
  const patternColor = colorField({
    value: bannerPatternColor, allowNone: true, label: 'Pattern colour',
    onInput: (c) => { bannerPatternColor = c; draw(); }, onChange: (c) => { bannerPatternColor = c; draw(); },
  });

  // Banner colour from the profile picture (mostly its edges), or the initials' colour without one.
  async function matchAvatar() {
    const color = me.avatar ? await edgeColor(me.avatar) : colorFor(me.id);
    if (!color) return toast('Could not read colours from that picture.', 'error');
    bannerColor = color;
    banner.value = color;
    banner.style.background = color;
    draw();
  }

  async function dropAvatar() {
    await attempt(async () => { me = await removeAvatar(); made = null; });
    drawDefaults();
    draw();
  }

  const editor = form({
    submitLabel: labels.save || 'Save profile',
    onSubmit: async () => {
      if (made) {
        me = await uploadAvatar(await made.file());
        made = null;
      }
      me = await save({
        displayName: displayName.value, statusText: statusText.value, bio: bio.value, bannerColor, bannerPattern, bannerPatternColor,
      });
    },
  },
  settingsCard('Avatar', settingRow('Profile picture',
    [button('Upload', changeAvatar, 'ghost small'), button('Remove', dropAvatar, 'ghost small')]),
    avatarMaker && !avatarChoices
      ? stacked(settingRow('Or make one', avatarMaker((picture) => { made = picture; draw(); })))
      : stacked(settingRow('Or pick one', defaults))),
  settingsCard(labels.about || 'About you', field('Display name', displayName), field('Status', statusText), field(labels.bioLabel || 'About me', bio)),
  settingsCard('Banner', settingRow('Banner colour',
    [banner, button('Match profile picture', matchAvatar, 'ghost small')]),
    stacked(settingRow('Pattern', patterns)),
    settingRow('Pattern colour', [patternColor, button('Automatic', () => { bannerPatternColor = null; patternColor.value = null; patternColor.style.background = ''; patternColor.classList.add('empty'); draw(); }, 'ghost small')])));

  drawDefaults();
  draw();
  editor.classList.add('settings-content');
  return [h('div', { class: 'profile-editor' }, editor,
    h('div', { class: 'profile-preview' }, settingsCard('Preview', preview)))];
}
