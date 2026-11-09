import { h } from '../dom.js';
import { iconButton } from '../ui.js';
import { onEscape } from './modals.js';
import { profilePage } from './settingsProfile.js';
import { appearancePage } from './settingsAppearance.js';
import { accountPage } from './settingsAccount.js';

const PAGES = [['profile', 'My Profile', profilePage], ['appearance', 'Appearance', appearancePage], ['account', 'Account', accountPage]];

// The full-screen settings view.
export function openSettings(start = 'profile') {
  const content = h('div', { class: 'settings-content' });
  const tabs = PAGES.map(([id, label, build]) => h('button', {
    type: 'button', class: 'nav-item', dataset: { id },
    onclick: () => {
      for (const tab of tabs) tab.classList.toggle('active', tab.dataset.id === id);
      content.replaceChildren(h('h1', {}, label), ...build());
    },
  }, label));

  const release = onEscape(() => close());
  function close() {
    release();
    screen.remove();
  }

  const screen = h('div', { class: 'settings', role: 'dialog', 'aria-label': 'Settings' },
    h('nav', { class: 'settings-nav' }, h('h2', {}, 'Settings'), tabs),
    h('div', { class: 'settings-page' }, iconButton('x', 'Close settings', close, 'settings-close'), content));
  document.getElementById('layers').append(screen);
  tabs.find((tab) => tab.dataset.id === start).click();
}
