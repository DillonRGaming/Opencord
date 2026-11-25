import { h } from '../dom.js';
import { icon } from '../icons.js';
import { openPage, setPageKey } from './page.js';
import { profilePage } from './settingsProfile.js';
import { appearancePage, chatPage, accessibilityPage, advancedPage, customCssPage, notificationsPage, privacyPage, snippetsPage, translationPage } from './settingsAppearance.js';
import { accountPage } from './settingsAccount.js';

// [heading, [[id, label, build, search words]]]
const GROUPS = [
  ['User settings', [
    ['account', 'My Account', accountPage, 'password log out username'],
    ['profile', 'Profile', profilePage, 'avatar display name status about bio banner'],
    ['privacy', 'Privacy', privacyPage, 'dms direct messages friend requests typing block'],
  ]],
  ['App settings', [
    ['appearance', 'Appearance', appearancePage, 'theme colour color accent font size text corners spacing sidebar dark light'],
    ['chat', 'Chat', chatPage, 'messages compact cozy clock time avatars previews spoilers enter send typing pictures links emoji'],
    ['snippets', 'Snippets', snippetsPage, 'shortcuts text replace expand abbreviations autocorrect gts'],
    ['translation', 'Translation', translationPage, 'translate language auto detect'],
    ['notifications', 'Notifications', notificationsPage, 'desktop sound alerts mentions dms ring calls quiet hours'],
    ['accessibility', 'Accessibility', accessibilityPage, 'contrast animations motion'],
    ['css', 'Custom CSS', customCssPage, 'style code wallpaper'],
    ['advanced', 'Advanced', advancedPage, 'developer mode bots bot builder blocks'],
  ]],
];

// A settings-style page: a searchable list of sections on the left, the open section on the right.
// `key` puts it in the address as key:<section>, so a refresh comes back to the same section.
export function openSectionedPage({ title, icon: iconName = null, groups, start, key = null }) {
  const content = h('div', { class: 'settings-content' });
  const heading = h('h2', { class: 'settings-page-title' });
  const items = [];
  let active = null;

  const show = (item) => {
    active = item;
    for (const other of items) other.el.setAttribute('aria-current', String(other === item));
    heading.textContent = item.label;
    if (key) setPageKey(`${key}:${item.id}`);
    content.replaceChildren(...[item.build()].flat());
    content.closest('.settings-main')?.scrollTo(0, 0);
  };

  const nav = h('nav', { class: 'settings-nav', 'aria-label': title });
  const search = h('input', {
    class: 'input', type: 'search', placeholder: 'Search', 'aria-label': 'Search settings',
    oninput: () => {
      const q = search.value.trim().toLowerCase();
      for (const group of nav.querySelectorAll('.settings-nav-group')) {
        let any = false;
        for (const item of items.filter((i) => i.group === group)) {
          const match = !q || `${item.label} ${item.words}`.toLowerCase().includes(q);
          item.el.hidden = !match;
          any ||= match;
        }
        group.hidden = !any;
      }
    },
  });
  nav.append(h('label', { class: 'settings-search' }, icon('search', 16), search));

  for (const [groupLabel, entries] of groups) {
    const group = h('div', { class: 'settings-nav-group' }, groupLabel && h('div', { class: 'settings-nav-heading' }, groupLabel));
    for (const [id, label, build, words = ''] of entries) {
      const item = { id, label, build, words, group };
      item.el = h('button', { type: 'button', class: 'settings-nav-item', onclick: () => show(item) }, label);
      items.push(item);
      group.append(item.el);
    }
    nav.append(group);
  }

  if (items.length <= 4) nav.querySelector('.settings-search').remove();
  const layout = h('div', { class: 'settings-layout' }, nav, h('div', { class: 'settings-main' }, heading, content));
  layout.addEventListener('redraw', () => show(active));
  const page = openPage({ title, icon: iconName, content: layout, key });
  show(items.find((item) => item.id === start) || items[0]);
  return page;
}

export function openSettings(start = 'account') {
  return openSectionedPage({ title: 'Settings', icon: 'settings', groups: GROUPS, start, key: 'settings' });
}
