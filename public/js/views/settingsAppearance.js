import { h, debounce } from '../dom.js';
import { state } from '../store.js';
import { changeSettings } from '../actions.js';
import { ACCENTS, DEFAULTS, THEMES } from '../theme.js';
import { segmented } from '../ui.js';

// Colours for the little theme previews: background, panel, raised.
const PREVIEW = {
  moss: ['#111411', '#161a17', '#1f2620'],
  graphite: ['#121211', '#1a1a19', '#252523'],
  paper: ['#e9e5db', '#f6f3ec', '#fdfbf7'],
  oled: ['#000000', '#0b0b0b', '#171717'],
};

function group(label, ...children) {
  return h('div', { class: 'settings-group' }, h('span', { class: 'field-label' }, label), children);
}

// A set of buttons where one is pressed; `press(value)` moves the pressed state.
function choices(values, build) {
  const buttons = values.map((value) => [value, build(value)]);
  const press = (current) => {
    for (const [value, el] of buttons) el.setAttribute('aria-pressed', String(value === current));
  };
  return { elements: buttons.map(([, el]) => el), press };
}

export function appearancePage() {
  const current = { ...DEFAULTS, ...state.me.settings };

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

  const sizeLabel = h('span', { class: 'field-hint' }, `${current.fontSize}px`);
  const size = h('input', {
    class: 'range', type: 'range', min: 12, max: 24, step: 1, value: current.fontSize,
    oninput: () => { sizeLabel.textContent = `${size.value}px`; changeSettings({ fontSize: Number(size.value) }); },
  });

  const saveCss = debounce((customCss) => changeSettings({ customCss }), 300);
  const css = h('textarea', {
    class: 'textarea code', spellcheck: false, value: current.customCss,
    placeholder: '/* Example */\nbody { background: url(https://…/wallpaper.jpg) center / cover; }',
    oninput: () => saveCss(css.value),
  });

  return [
    group('Theme', h('div', { class: 'theme-grid' }, themes.elements)),
    group('Accent colour', h('div', { class: 'swatches' }, accents.elements, picker)),
    group('Font size', h('div', { class: 'row' }, size, sizeLabel)),
    group('Message spacing', h('div', {}, segmented([['cozy', 'Cozy'], ['compact', 'Compact']], current.density, (density) => changeSettings({ density })))),
    group('Avatar shape', h('div', {}, segmented([['round', 'Round'], ['square', 'Rounded square']], current.avatarShape, (avatarShape) => changeSettings({ avatarShape })))),
    group('Custom CSS', css, h('span', { class: 'field-hint' },
      'Applies only to you, on every device you log in on. Colours are CSS variables such as --bg-app, --bg-panel, --text and --accent.')),
  ];
}
