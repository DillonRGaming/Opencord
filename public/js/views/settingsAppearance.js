import { h, debounce } from '../dom.js';
import { state } from '../store.js';
import { changeSettings } from '../actions.js';
import { ACCENTS, DEFAULTS, FONTS, THEMES } from '../theme.js';
import { button, segmented, settingRow, settingsCard, switchControl } from '../ui.js';
import { colorField } from '../colorPicker.js';
import { LANGUAGES, targetLanguage } from '../translate.js';

// Colours for the little theme previews: background, panel, raised.
const PREVIEW = {
  moss: ['#111411', '#161a17', '#1f2620'],
  graphite: ['#121211', '#1a1a19', '#252523'],
  paper: ['#e9e5db', '#f6f3ec', '#fdfbf7'],
  oled: ['#000000', '#0b0b0b', '#171717'],
  onyx: ['#0a0a0a', '#121212', '#1d1d1d'],
  slate: ['#101114', '#15181b', '#1f2226'],
  ocean: ['#0c1118', '#101820', '#19222c'],
  dusk: ['#0f0e16', '#14131e', '#1d1c29'],
  plum: ['#130f15', '#1a141d', '#251d28'],
  rose: ['#150f10', '#1c1416', '#271d20'],
  ember: ['#15100e', '#1d1613', '#29201c'],
  mocha: ['#14120f', '#1c1815', '#27221e'],
  teal: ['#0e1616', '#131e1e', '#1c2929'],
  sky: ['#d6e3f0', '#edf2f8', '#f9fbfd'],
  mint: ['#dbebe3', '#eef6f2', '#fafcfb'],
  blush: ['#eed8dd', '#f7edf0', '#fdfafa'],
  wine: ['#160e0f', '#1e1214', '#2a1b1d'],
  olive: ['#13140f', '#1a1c15', '#25271e'],
  deepsea: ['#0c1517', '#111c1f', '#19272c'],
  peach: ['#f2e0d4', '#f9f1eb', '#fdfbf9'],
  sage: ['#e1e8de', '#f1f5f0', '#fbfcfa'],
  lavender: ['#dfd8ee', '#f1edf7', '#fbfafd'],
};

// A segmented control that saves straight to one setting.
// Yes/no settings get a switch (the same control everywhere); real choices get a row of buttons.
function option(key, options, current) {
  const onOff = options.length === 2 && options.every(([v]) => typeof v === 'boolean')
    && options.every(([, label]) => ['On', 'Off', 'Show', 'Hide', 'Yes', 'No'].includes(label));
  if (onOff) return switchControl(Boolean(current[key]), (value) => changeSettings({ [key]: value }), key);
  return segmented(options, current[key], (value) => changeSettings({ [key]: value }));
}

const toggle = (on, onChange) => switchControl(on, onChange, 'On or off');

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

// Defaults for settings that aren't about looks (kept apart so "Reset appearance" leaves them alone).
const OTHER_DEFAULTS = {
  timestamps: 'hover', jumboEmoji: true, spoilers: 'click', linkPreviews: true, mediaSize: 'normal', underlineLinks: false,
  sendKey: 'enter', showTyping: true, translateAuto: false, bubbles: false, dmsFrom: 'servers', sendTyping: true, sendTypingText: false, friendRequestsFrom: 'everyone',
  readReceipts: false, showLastSeen: false, developerMode: false,
};
const settingsNow = () => ({ ...DEFAULTS, ...OTHER_DEFAULTS, ...state.me.settings });

export function appearancePage() {
  const current = settingsNow();

  const themes = choices(THEMES, (theme) => h('button', {
    type: 'button', class: 'theme-card',
    onclick: () => { themes.press(theme); changeSettings({ theme: theme.id }); },
  }, h('span', { class: 'theme-swatch', style: { background: PREVIEW[theme.id][0] } },
    PREVIEW[theme.id].slice(1).map((color) => h('span', { style: { background: color } }))), theme.name));
  themes.press(THEMES.find((theme) => theme.id === document.documentElement.dataset.theme));

  const picker = colorField({
    value: current.accent, label: 'Pick any colour',
    onChange: (c) => { accents.press(c); changeSettings({ accent: c }); },
  });
  const accents = choices(ACCENTS, (color) => h('button', {
    type: 'button', class: 'swatch', style: { background: color }, title: color, 'aria-label': `Accent ${color}`,
    onclick: () => { accents.press(color); picker.value = color; picker.style.background = color; changeSettings({ accent: color }); },
  }));
  accents.press(current.accent);

  // The whole app's language. English is how it's written; others are translated (see uiLanguage.js).
  const language = h('select', { class: 'input', 'aria-label': 'Language', 'data-no-translate': '', onchange: () => changeSettings({ uiLanguage: language.value === 'en' ? '' : language.value }) },
    LANGUAGES.map(([code, name]) => h('option', { value: code, selected: code === (current.uiLanguage || 'en') }, name)));

  return [
    settingsCard('Language', settingRow('App language', language)),
    // Dark themes, then light ones, each under its own heading.
    settingsCard('Theme',
      h('div', { class: 'theme-group-title' }, 'Dark'),
      h('div', { class: 'theme-grid' }, themes.elements.filter((_, i) => !THEMES[i].light)),
      h('div', { class: 'theme-group-title' }, 'Light'),
      h('div', { class: 'theme-grid' }, themes.elements.filter((_, i) => THEMES[i].light)),
      settingRow('Accent colour', h('div', { class: 'swatches' }, accents.elements, picker))),
    settingsCard('Layout',
      settingRow('Server list', option('railPosition', [['left', 'Left'], ['top', 'Top (prototype)']], current))),
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
      settingRow('Your messages', option('bubbles', [[false, 'On the left, like everyone’s'], [true, 'On the right, like a messenger']], current)),
      settingRow('Message spacing', option('density', [['cozy', 'Cozy'], ['compact', 'Compact']], current)),
      settingRow('Clock', option('clock', [['auto', 'Auto'], ['12', '12-hour'], ['24', '24-hour']], current)),
      settingRow('Times on grouped messages', option('timestamps', [['hover', 'On hover'], ['always', 'Always']], current)),
      settingRow('Emoji-only messages', option('jumboEmoji', [[true, 'Big'], [false, 'Normal size']], current)),
      settingRow('Spoilers', option('spoilers', [['click', 'Hidden until clicked'], ['always', 'Always shown']], current))),
    settingsCard('Media and links',
      settingRow('Link previews', option('linkPreviews', [[true, 'Show'], [false, 'Hide']], current)),
      settingRow('Picture size', option('mediaSize', [['small', 'Small'], ['normal', 'Normal'], ['large', 'Large']], current)),
      settingRow('Underline links', option('underlineLinks', [[false, 'No'], [true, 'Yes']], current))),
    settingsCard('Typing',
      settingRow('Send with', option('sendKey', [['enter', 'Enter'], ['ctrlEnter', 'Ctrl + Enter']], current)),
      settingRow('Show who is typing', option('showTyping', [[true, 'Show'], [false, 'Hide']], current))),
    settingsCard('Avatars',
      settingRow('Avatars in chat', option('chatAvatars', [[true, 'Show'], [false, 'Hide']], current)),
      settingRow('Avatar shape', option('avatarShape', [['round', 'Round'], ['square', 'Rounded square']], current))),
  ];
}

export function translationPage() {
  const current = settingsNow();
  const to = h('select', { class: 'input', 'aria-label': 'Translate into', onchange: () => changeSettings({ translateTo: to.value }) },
    LANGUAGES.map(([code, name]) => h('option', { value: code, selected: code === targetLanguage() }, name)));
  return [
    settingsCard('Translation',
      settingRow('Translate into', to),
      settingRow('Translate other languages automatically', option('translateAuto', [[false, 'Off'], [true, 'On']], current))),
  ];
}

export function privacyPage() {
  const current = settingsNow();
  return [
    settingsCard('Messages',
      settingRow('Who can DM you', option('dmsFrom', [['servers', 'Friends and server members'], ['friends', 'Friends only']], current)),
      settingRow('Let others see when you’re typing', option('sendTyping', [[true, 'Yes'], [false, 'No']], current)),
      settingRow('Show what I’m typing, live, before I send it', option('sendTypingText', [[false, 'Off'], [true, 'On']], current)),
      settingRow('Read receipts in DMs', option('readReceipts', [[false, 'Off'], [true, 'On']], current)),
      settingRow('Show when I was last online', option('showLastSeen', [[false, 'No'], [true, 'Yes']], current))),
    settingsCard('Friends',
      settingRow('Who can send you friend requests', option('friendRequestsFrom', [['everyone', 'Everyone'], ['servers', 'People in my servers'], ['nobody', 'Nobody']], current))),
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

// Developer mode adds the bot button next to Settings (bottom left), which opens the bot workspace.
export function advancedPage() {
  const current = settingsNow();
  return [settingsCard('Developer',
    settingRow('Developer mode', option('developerMode', [[false, 'Off'], [true, 'On']], current)))];
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

// No sounds, desktop notifications or call rings between two times.
function quietHoursCard(current) {
  const q = { on: false, from: '22:00', to: '08:00', ...(current.quietHours || {}) };
  const save = () => changeSettings({ quietHours: { ...q } });
  const from = h('input', { class: 'input time-input', type: 'time', value: q.from, onchange: () => { q.from = from.value; save(); } });
  const to = h('input', { class: 'input time-input', type: 'time', value: q.to, onchange: () => { q.to = to.value; save(); } });
  return settingsCard('Quiet hours',
    settingRow('Quiet hours', toggle(q.on, (value) => { q.on = value; save(); })),
    settingRow('From', from), settingRow('Until', to));
}

export function notificationsPage() {
  const current = settingsNow();
  const status = h('span', { class: 'range-value' }, 'Notification' in window ? Notification.permission.replace('default', 'not asked yet') : 'not supported');
  return [
    settingsCard('Desktop',
      settingRow('Show desktop notifications', toggle(current.desktopNotifications !== false, async (value) => {
        changeSettings({ desktopNotifications: value });
        if (value && 'Notification' in window && Notification.permission === 'default') {
          status.textContent = await Notification.requestPermission();
        }
      })),
      settingRow('Browser permission', [status, 'Notification' in window && Notification.permission !== 'granted' && button('Allow', async () => {
        status.textContent = await Notification.requestPermission();
      }, 'ghost small')])),
    settingsCard('Sound',
      settingRow('Play a sound', toggle(current.notificationSound !== false, (value) => changeSettings({ notificationSound: value })))),
    settingsCard('Direct messages',
      settingRow('Notify me about new DMs', toggle(current.dmNotifications !== false, (value) => changeSettings({ dmNotifications: value }))),
      settingRow('Red counts on unread DMs', toggle(current.dmPings !== false, (value) => changeSettings({ dmPings: value }))),
      settingRow('Ring when someone calls', toggle(current.callRing !== false, (value) => changeSettings({ callRing: value })))),
    quietHoursCard(current),
  ];
}
