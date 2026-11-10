import { h, debounce } from '../dom.js';
import { state } from '../store.js';
import { changeSettings } from '../actions.js';
import { ACCENTS, DEFAULTS, FONTS, THEMES } from '../theme.js';
import { button, segmented, settingRow, settingsCard } from '../ui.js';

// Colours for the little theme previews: background, panel, raised.
const PREVIEW = {
  moss: ['#111411', '#161a17', '#1f2620'],
  graphite: ['#121211', '#1a1a19', '#252523'],
  paper: ['#e9e5db', '#f6f3ec', '#fdfbf7'],
  oled: ['#000000', '#0b0b0b', '#171717'],
};

// A segmented control that saves straight to one setting.
function option(key, options, current) {
  return segmented(options, current[key], (value) => changeSettings({ [key]: value }));
}

function slider(key, current, { min, max, step = 1, unit = 'px' }) {
  const label = h('span', { class: 'range-value' }, `${current[key]}${unit}`);
  const input = h('input', {
    class: 'range', type: 'range', min, max, step, value: current[key],
    oninput: () => { label.textContent = `${input.value}${unit}`; changeSettings({ [key]: Number(input.value) }); },
  });
  return [input, label];
}

// A set of buttons where one is pressed; `press(value)` moves the pressed state.
function choices(values, build) {
  const buttons = values.map((value) => [value, build(value)]);
  const press = (current) => {
    for (const [value, el] of buttons) el.setAttribute('aria-pressed', String(value === current));
  };
  return { elements: buttons.map(([, el]) => el), press };
}

const settingsNow = () => ({ ...DEFAULTS, ...state.me.settings });

export function appearancePage() {
  const current = settingsNow();

  const themes = choices(THEMES, (theme) => h('button', {
    type: 'button', class: 'theme-card',
    onclick: () => { themes.press(theme); changeSettings({ theme: theme.id }); },
  }, h('span', { class: 'theme-swatch', style: { background: PREVIEW[theme.id][0] } },
    PREVIEW[theme.id].slice(1).map((color) => h('span', { style: { background: color } }))), theme.name));
  themes.press(THEMES.find((theme) => theme.id === document.documentElement.dataset.theme));

  const picker = h('input', {
    class: 'color-input', type: 'color', value: current.accent, title: 'Pick any colour',
    oninput: () => { accents.press(picker.value); changeSettings({ accent: picker.value }); },
  });
  const accents = choices(ACCENTS, (color) => h('button', {
    type: 'button', class: 'swatch', style: { background: color }, title: color, 'aria-label': `Accent ${color}`,
    onclick: () => { accents.press(color); picker.value = color; changeSettings({ accent: color }); },
  }));
  accents.press(current.accent);

  return [
    settingsCard('Theme', h('div', { class: 'theme-grid' }, themes.elements),
      settingRow('Accent colour', h('div', { class: 'swatches' }, accents.elements, picker))),
    settingsCard('Text',
      settingRow('Font', option('font', FONTS.map(([id, name]) => [id, name]), current)),
      settingRow('Size', slider('fontSize', current, { min: 12, max: 24 })),
      settingRow('Line spacing', option('lineHeight', [['tight', 'Tight'], ['normal', 'Normal'], ['relaxed', 'Relaxed']], current))),
    settingsCard('Layout',
      settingRow('Corners', option('corners', [['sharp', 'Sharp'], ['normal', 'Soft'], ['round', 'Round']], current)),
      settingRow('Panel spacing', option('spacing', [['tight', 'Tight'], ['normal', 'Normal'], ['roomy', 'Roomy']], current)),
      settingRow('Sidebar width', slider('sidebarWidth', current, { min: 200, max: 360, step: 10 }))),
    settingsCard(null, settingRow('Reset appearance', button('Reset to defaults', (event) => {
      changeSettings({ ...DEFAULTS, customCss: current.customCss });
      event.currentTarget.closest('.settings-layout')?.dispatchEvent(new Event('redraw'));
    }, 'ghost small'))),
  ];
}

export function chatPage() {
  const current = settingsNow();
  return [
    settingsCard('Messages',
      settingRow('Message spacing', option('density', [['cozy', 'Cozy'], ['compact', 'Compact']], current)),
      settingRow('Clock', option('clock', [['auto', 'Auto'], ['12', '12-hour'], ['24', '24-hour']], current))),
    settingsCard('Avatars',
      settingRow('Avatars in chat', option('chatAvatars', [[true, 'Show'], [false, 'Hide']], current)),
      settingRow('Avatar shape', option('avatarShape', [['round', 'Round'], ['square', 'Rounded square']], current))),
  ];
}

export function accessibilityPage() {
  const current = settingsNow();
  return [
    settingsCard('Display',
      settingRow('Contrast', option('contrast', [['normal', 'Normal'], ['high', 'High']], current)),
      settingRow('Animations', option('motion', [['full', 'On'], ['reduced', 'Off']], current))),
  ];
}

export function customCssPage() {
  const current = settingsNow();
  const saveCss = debounce((customCss) => changeSettings({ customCss }), 300);
  const css = h('textarea', {
    class: 'textarea code custom-css', spellcheck: false, value: current.customCss,
    placeholder: '/* Example */\nbody { background: url(https://…/wallpaper.jpg) center / cover; }',
    oninput: () => saveCss(css.value),
  });
  return [settingsCard('Your CSS', css)];
}

export function notificationsPage() {
  const current = settingsNow();
  const status = h('span', { class: 'range-value' }, 'Notification' in window ? Notification.permission.replace('default', 'not asked yet') : 'not supported');
  return [
    settingsCard('Desktop',
      settingRow('Show desktop notifications', segmented([[true, 'On'], [false, 'Off']], current.desktopNotifications !== false, async (value) => {
        changeSettings({ desktopNotifications: value });
        if (value && 'Notification' in window && Notification.permission === 'default') {
          status.textContent = await Notification.requestPermission();
        }
      })),
      settingRow('Browser permission', [status, 'Notification' in window && Notification.permission !== 'granted' && button('Allow', async () => {
        status.textContent = await Notification.requestPermission();
      }, 'ghost small')])),
    settingsCard('Sound',
      settingRow('Play a sound', segmented([[true, 'On'], [false, 'Off']], current.notificationSound !== false, (value) => changeSettings({ notificationSound: value })))),
  ];
}
