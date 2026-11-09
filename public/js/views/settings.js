import { h } from '../dom.js';
import { openPage } from './page.js';
import { profilePage } from './settingsProfile.js';
import { appearancePage } from './settingsAppearance.js';
import { accountPage } from './settingsAccount.js';

const PAGES = [['profile', 'Profile', profilePage], ['appearance', 'Appearance', appearancePage], ['account', 'Account', accountPage]];

// Settings open as a page in the main column, with the sections as tabs in the header.
export function openSettings(start = 'profile') {
  const content = h('div', { class: 'settings-content' });
  const tabs = PAGES.map(([id, label, build]) => h('button', {
    type: 'button', role: 'tab', class: 'tab', dataset: { id },
    onclick: () => {
      for (const tab of tabs) tab.setAttribute('aria-selected', String(tab.dataset.id === id));
      content.replaceChildren(...build());
    },
  }, label));

  openPage({ title: 'Settings', actions: h('div', { class: 'tabs', role: 'tablist' }, tabs), content });
  tabs.find((tab) => tab.dataset.id === start).click();
}
