import * as api from '../api.js';
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
  const { me } = state;
  let bannerColor = me.bannerColor;
  let bannerPattern = me.bannerPattern;
  let bannerPatternColor = me.bannerPatternColor;

  const displayName = h('input', { class: 'input', required: true, maxLength: 32, value: me.displayName });
  const statusText = h('input', { class: 'input', maxLength: 128, value: me.statusText, placeholder: 'What are you up to?' });
  const bio = h('textarea', { class: 'textarea', maxLength: 190, value: me.bio, placeholder: 'A few words about you' });
  const banner = colorField({
    value: bannerColor || state.me.settings.accent || DEFAULTS.accent, label: 'Banner colour',
    onInput: (c) => { bannerColor = c; draw(); }, onChange: (c) => { bannerColor = c; draw(); },
  });
  const preview = h('div');

  // The preview shows what is typed, before it is saved.
  function draw() {
    preview.replaceChildren(profileCard({
      ...state.me,
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
    await attempt(async () => setMe(await api.putFile('/api/users/@me/avatar', file)));
    drawDefaults();
    draw();
  }

  // The built-in avatars: the logo on each colour. Clicking one sets it straight away.
  const DEFAULT_AVATARS = 10;
  const defaults = h('div', { class: 'swatches avatar-swatches' });
  function drawDefaults() {
    defaults.replaceChildren(...Array.from({ length: DEFAULT_AVATARS }, (_, i) => {
      const src = `/avatars/${i + 1}.svg`;
      return h('button', {
        type: 'button', class: 'swatch avatar-swatch', 'aria-label': `Default avatar ${i + 1}`,
        'aria-pressed': String(state.me.avatar === src),
        onclick: () => pickDefault(i + 1),
      }, h('img', { src, alt: '', draggable: false }));
    }));
  }
  async function pickDefault(n) {
    await attempt(async () => setMe(await api.put(`/api/users/@me/avatar/default/${n}`)));
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
    const color = state.me.avatar ? await edgeColor(state.me.avatar) : colorFor(state.me.id);
    if (!color) return toast('Could not read colours from that picture.', 'error');
    bannerColor = color;
    banner.value = color;
    banner.style.background = color;
    draw();
  }

  async function removeAvatar() {
    await attempt(async () => setMe(await api.del('/api/users/@me/avatar')));
    drawDefaults();
    draw();
  }

  const editor = form({
    submitLabel: 'Save profile',
    onSubmit: async () => {
      setMe(await api.patch('/api/users/@me', {
        displayName: displayName.value, statusText: statusText.value, bio: bio.value, bannerColor, bannerPattern, bannerPatternColor,
      }));
      toast('Profile saved.', 'ok');
    },
  },
  settingsCard('Avatar', settingRow('Profile picture',
    [button('Upload', changeAvatar, 'ghost small'), button('Remove', removeAvatar, 'ghost small')]),
    stacked(settingRow('Or pick one', defaults))),
  settingsCard('About you', field('Display name', displayName), field('Status', statusText), field('About me', bio)),
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
