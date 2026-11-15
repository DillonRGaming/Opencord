import { h } from '../dom.js';
import { avatar, statusOf } from '../ui.js';
import { timeAgo, formatStamp } from '../format.js';
import { bannerStyle } from '../patterns.js';

// The profile card: shown in the popout and as the live preview in settings.
export function profileCard(user, actionButtons = [], extra = null) {
  return h('div', { class: 'profile-card' },
    h('div', { class: 'profile-banner', style: bannerStyle(user) }),
    h('div', { class: 'profile-body' },
      // The status sits to the right of the picture, just under the banner.
      h('div', { class: 'profile-top' }, avatar(user, { size: 72, presence: true }),
        user.statusText && h('p', { class: 'profile-status', title: user.statusText }, user.statusText)),
      h('div', { class: 'profile-names' }, h('strong', {}, user.displayName), h('span', {}, `@${user.username}`)),
      user.lastSeen && statusOf(user) === 'offline'
        && h('p', { class: 'profile-last-seen', title: formatStamp(user.lastSeen) }, `Last online ${timeAgo(user.lastSeen)}`),
      extra,
      user.bio && h('p', { class: 'profile-bio' }, user.bio),
      actionButtons.length > 0 && h('div', { class: 'profile-actions' }, actionButtons)));
}
