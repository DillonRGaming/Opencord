import { h } from '../dom.js';
import { avatar } from '../ui.js';

// The profile card: shown in the popout and as the live preview in settings.
export function profileCard(user, actionButtons = []) {
  return h('div', { class: 'profile-card' },
    h('div', { class: 'profile-banner', style: user.bannerColor ? { background: user.bannerColor } : {} }),
    h('div', { class: 'profile-body' },
      avatar(user, { size: 72, presence: true }),
      h('div', { class: 'profile-names' }, h('strong', {}, user.displayName), h('span', {}, `@${user.username}`)),
      user.statusText && h('p', { class: 'profile-status' }, user.statusText),
      user.bio && h('p', { class: 'profile-bio' }, user.bio),
      actionButtons.length > 0 && h('div', { class: 'profile-actions' }, actionButtons)));
}
