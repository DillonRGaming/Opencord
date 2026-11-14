import { h } from '../dom.js';
import { avatar } from '../ui.js';

// The profile card: shown in the popout and as the live preview in settings.
export function profileCard(user, actionButtons = [], extra = null) {
  return h('div', { class: 'profile-card' },
    h('div', { class: 'profile-banner', style: user.bannerColor ? { background: user.bannerColor } : {} }),
    h('div', { class: 'profile-body' },
      // The status sits to the right of the picture, just under the banner.
      h('div', { class: 'profile-top' }, avatar(user, { size: 72, presence: true }),
        user.statusText && h('p', { class: 'profile-status', title: user.statusText }, user.statusText)),
      h('div', { class: 'profile-names' }, h('strong', {}, user.displayName), h('span', {}, `@${user.username}`)),
      extra,
      user.bio && h('p', { class: 'profile-bio' }, user.bio),
      actionButtons.length > 0 && h('div', { class: 'profile-actions' }, actionButtons)));
}
