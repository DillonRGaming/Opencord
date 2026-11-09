import { h } from '../dom.js';
import { on } from '../store.js';
import { iconButton } from '../ui.js';
import { onEscape } from '../escape.js';
import { profilePage } from './settingsProfile.js';
import { appearancePage } from './settingsAppearance.js';
import { accountPage } from './settingsAccount.js';

const PAGES = [['profile', 'My Profile', profilePage], ['appearance', 'Appearance', appearancePage], ['account', 'Account', accountPage]];

let close = null;

// Settings take the place of the sidebar and chat (the server rail stays). Going anywhere closes them.
export function openSettings(start = 'profile') {
  close?.();
  const app = document.querySelector('.app');
  const content = h('div', { class: 'settings-content' });
  const tabs = PAGES.map(([id, label, build]) => h('button', {
    type: 'button', class: 'nav-item', dataset: { id },
    onclick: () => {
      for (const tab of tabs) tab.classList.toggle('active', tab.dataset.id === id);
      content.replaceChildren(h('h1', {}, label), ...build());
    },
  }, label));

  const screen = h('section', { class: 'settings', 'aria-label': 'Settings' },
    h('nav', { class: 'settings-nav panel' }, h('h2', {}, 'Settings'), tabs),
    h('div', { class: 'settings-page panel' }, iconButton('x', 'Close settings', () => close(), 'settings-close'), content));

  const release = onEscape(() => close());
  close = () => {
    release();
    screen.remove();
    app.classList.remove('settings-open');
    close = null;
  };

  app.classList.add('settings-open');
  app.append(screen);
  tabs.find((tab) => tab.dataset.id === start).click();
}

on('route', () => close?.());
