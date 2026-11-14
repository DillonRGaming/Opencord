import * as api from '../api.js';
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { state, on, emit, remember, roleOf } from '../store.js';
import { openModerate } from './moderation.js';
import { openBotBuilder } from './botBuilder.js';
import { formatDate, formatStamp } from '../format.js';
import {
  attempt, avatar, button, confirmButton, copyText, field, form, iconButton, pickFiles, segmented, serverIcon,
  settingRow, settingsCard, settingsHero, toast,
} from '../ui.js';
import { openChannelPage } from './serverPages.js';
import { openSectionedPage } from './settings.js';
import { rolesSection, memberRoleButton } from './roles.js';
import { roleColor } from '../store.js';

const EXPIRY = [[0, 'Never'], [3600, '1 hour'], [86400, '1 day'], [7 * 86400, '7 days'], [30 * 86400, '30 days']];
const MAX_USES = [[0, 'No limit'], [1, '1'], [5, '5'], [10, '10'], [25, '25'], [100, '100']];

function emptyState(iconName, title) {
  return h('div', { class: 'empty-state small' }, h('span', { class: 'empty-icon' }, icon(iconName, 22)), h('strong', {}, title));
}

function dangerCard(...rows) {
  return h('section', { class: 'settings-card danger' }, h('h2', { class: 'settings-card-title' }, 'Danger zone'), rows);
}

// Owner only. Every section reads the server fresh from the store, so live updates show up on redraw.
export function openServerSettings(server) {
  const id = server.id;
  const current = () => state.servers.get(id) || server;

  // --- Overview ---
  function overview() {
    const s = current();
    let bannerColor = s.bannerColor;
    const name = h('input', { class: 'input', required: true, maxLength: 100, value: s.name });
    const description = h('textarea', { class: 'textarea', maxLength: 500, value: s.description || '', placeholder: 'What this server is about' });
    const banner = h('input', { class: 'color-input', type: 'color', value: bannerColor || '#3a3a37', oninput: () => { bannerColor = banner.value; } });

    const changeIcon = async () => {
      const [file] = await pickFiles({ accept: 'image/png,image/jpeg,image/gif,image/webp' });
      if (file) await attempt(async () => { await api.putFile(`/api/servers/${id}/icon`, file); redraw(); });
    };
    const removeIcon = () => attempt(async () => { await api.del(`/api/servers/${id}/icon`); redraw(); });
    const changeBanner = async () => {
      const [file] = await pickFiles({ accept: 'image/png,image/jpeg,image/gif,image/webp' });
      if (file) await attempt(async () => { await api.putFile(`/api/servers/${id}/banner`, file); redraw(); });
    };
    const removeBanner = () => attempt(async () => { await api.del(`/api/servers/${id}/banner`); redraw(); });
    const bannerPreview = h('button', {
      type: 'button', class: 'banner-preview', title: 'Change banner', onclick: changeBanner,
      style: { backgroundColor: s.bannerColor || 'var(--bg-panel)', backgroundImage: s.banner ? `url("${s.banner}")` : null },
    }, !s.banner && h('span', {}, icon('image', 20), 'Upload a banner'));

    return [
      settingsHero(serverIcon(s, 72), s.name, `${s.channels.length} channel${s.channels.length === 1 ? '' : 's'} · created ${formatDate(s.createdAt)}`,
        button('Change icon', changeIcon, 'ghost small'), s.icon && button('Remove', removeIcon, 'ghost small')),
      settingsCard('Details', form({
        submitLabel: 'Save changes',
        onSubmit: async () => {
          await api.patch(`/api/servers/${id}`, { name: name.value, description: description.value, bannerColor });
          toast('Server saved.', 'ok');
        },
      }, field('Server name', name), field('Description', description),
      settingRow('Banner colour', [banner, button('Clear', () => { bannerColor = null; banner.value = '#3a3a37'; }, 'ghost small')]))),
      settingsCard('Banner', bannerPreview,
        h('div', { class: 'button-row' }, button(s.banner ? 'Change banner' : 'Upload banner', changeBanner, 'ghost small'),
          s.banner && button('Remove', removeBanner, 'ghost small'))),
    ];
  }

  // --- Channels ---
  function channels() {
    const s = current();
    const list = [...s.channels].sort((a, b) => a.position - b.position);
    const move = (index, by) => attempt(async () => {
      const ids = list.map((c) => c.id);
      [ids[index], ids[index + by]] = [ids[index + by], ids[index]];
      await api.put(`/api/servers/${id}/channels/order`, { ids });
    });
    return [settingsCard(`Channels — ${list.length}`,
      h('div', { class: 'manage-list' }, list.map((channel, index) => h('div', { class: 'manage-row' },
        h('span', { class: `manage-icon${channel.parentId ? ' nested' : ''}` }, icon({ voice: 'volume', category: 'folder' }[channel.kind] || (channel.readOnly ? 'lock' : 'hash'), 18)),
        h('span', { class: 'manage-main' }, h('strong', {}, channel.name),
          h('span', {}, [{ voice: 'Voice', category: 'Category' }[channel.kind],
            channel.parentId && `in ${s.channels.find((c) => c.id === channel.parentId)?.name || '?'}`,
            channel.topic, channel.slowmode && `Slowmode ${channel.slowmode}s`, channel.readOnly && 'Read only'].filter(Boolean).join(' · ') || 'Text')),
        h('span', { class: 'manage-actions' },
          iconButton('arrowUp', 'Move up', () => move(index, -1), index === 0 ? 'hidden-action' : ''),
          iconButton('arrowDown', 'Move down', () => move(index, 1), index === list.length - 1 ? 'hidden-action' : ''),
          iconButton('pencil', `Edit #${channel.name}`, () => openChannelPage(current(), channel)),
          confirmButton({
            label: 'Delete channel', confirmLabel: 'Delete', face: icon('trash'), className: 'icon-button danger',
            onConfirm: () => api.del(`/api/channels/${channel.id}`),
          }))))),
      h('div', {}, button('New channel', () => openChannelPage(current()), 'ghost small')))];
  }

  // --- Invites ---
  function invites() {
    let expiresIn = 0;
    let maxUses = 0;
    const list = h('div', { class: 'manage-list' }, h('p', { class: 'loading' }, 'Loading…'));
    const load = async () => {
      const rows = await api.get(`/api/servers/${id}/invites`).catch(() => []);
      list.replaceChildren(...(rows.length ? rows.map(inviteRow) : [emptyState('link', 'No invites yet')]));
    };
    const inviteRow = (invite) => {
      const link = `${location.origin}/invite/${invite.code}`;
      const limits = [
        `${invite.uses}${invite.maxUses ? ` / ${invite.maxUses}` : ''} use${invite.uses === 1 && !invite.maxUses ? '' : 's'}`,
        invite.expired ? 'Expired' : invite.expiresAt ? `Expires ${formatStamp(invite.expiresAt)}` : 'Never expires',
      ];
      return h('div', { class: `manage-row${invite.expired ? ' faded' : ''}` },
        avatar(invite.creator, { size: 32 }),
        h('span', { class: 'manage-main' }, h('strong', { class: 'mono' }, invite.code), h('span', {}, `${invite.creator.displayName} · ${limits.join(' · ')}`)),
        h('span', { class: 'manage-actions' },
          iconButton('copy', 'Copy link', async () => { await copyText(link); toast('Invite link copied.', 'ok'); }),
          confirmButton({
            label: 'Revoke invite', confirmLabel: 'Revoke', face: icon('trash'), className: 'icon-button danger',
            onConfirm: async () => { await api.del(`/api/servers/${id}/invites/${invite.code}`); load(); },
          })));
    };
    load();
    return [
      settingsCard('New invite',
        settingRow('Expire after', segmented(EXPIRY, expiresIn, (value) => { expiresIn = value; })),
        settingRow('Max uses', segmented(MAX_USES, maxUses, (value) => { maxUses = value; })),
        h('div', {}, button('Create invite', () => attempt(async () => {
          const invite = await api.post(`/api/servers/${id}/invites`, { expiresIn, maxUses });
          await copyText(`${location.origin}/invite/${invite.code}`);
          toast('Invite created and copied.', 'ok');
          load();
        })))),
      settingsCard('Active invites', list),
    ];
  }

  // --- Members ---
  function members() {
    const s = current();
    const all = state.members.get(id) || [];
    if (!state.members.has(id)) {
      api.get(`/api/servers/${id}/members`).then((loaded) => {
        loaded.forEach((m) => remember(m.user));
        state.members.set(id, loaded);
        emit('members');
      }).catch(() => {});
    }
    let query = '';
    const list = h('div', { class: 'manage-list' });
    const draw = () => list.replaceChildren(...all
      .filter(({ user }) => `${user.displayName}\n${user.username}`.toLowerCase().includes(query))
      .sort((a, b) => a.user.displayName.localeCompare(b.user.displayName))
      .map(({ user, joinedAt, timeoutUntil }) => {
        const owner = user.id === s.ownerId;
        const role = roleOf(id, user.id);
        const iAmOwner = s.ownerId === state.me.id;
        const outranks = !owner && user.id !== state.me.id && (iAmOwner || role === 'member');
        return h('div', { class: 'manage-row' },
          avatar(user, { size: 36, presence: true }),
          h('span', { class: 'manage-main' }, h('strong', { style: roleColor(id, user.id) ? { color: roleColor(id, user.id) } : null }, user.displayName,
            user.bot ? h('span', { class: 'member-tag bot' }, 'Bot') : role !== 'member' && h('span', { class: 'member-tag' }, role === 'owner' ? 'Owner' : 'Admin')),
            h('span', {}, [`@${user.username}`, `joined ${formatDate(joinedAt)}`, timeoutUntil && `timed out until ${formatStamp(timeoutUntil)}`].filter(Boolean).join(' · '))),
          h('span', { class: 'manage-actions' },
            memberRoleButton(id, user),
            !owner && iAmOwner && !user.bot && iconButton('shield', role === 'admin' ? 'Remove admin' : 'Make admin',
              () => attempt(() => api.put(`/api/servers/${id}/members/${user.id}/role`, { role: role === 'admin' ? 'member' : 'admin' })), role === 'admin' ? 'on' : ''),
            !owner && iAmOwner && !user.bot && confirmButton({
              label: 'Make owner', confirmLabel: 'Hand over', face: icon('crown'), className: 'icon-button',
              onConfirm: async () => { await api.post(`/api/servers/${id}/owner`, { userId: user.id }); page.close(); toast(`${user.displayName} owns the server now.`, 'ok'); },
            }),
            outranks && (timeoutUntil
              ? iconButton('clock', 'Remove timeout', () => attempt(() => api.put(`/api/servers/${id}/members/${user.id}/timeout`, { seconds: 0 })), 'on')
              : iconButton('clock', 'Time out', () => openModerate(s, user, 'timeout'))),
            outranks && iconButton('logout', 'Kick', () => openModerate(s, user, 'kick'), 'danger'),
            outranks && iconButton('ban', 'Ban', () => openModerate(s, user, 'ban'), 'danger')));
      }));
    draw();
    const search = h('label', { class: 'member-search' }, icon('search', 16),
      h('input', { type: 'search', placeholder: 'Search members', oninput: (e) => { query = e.target.value.trim().toLowerCase(); draw(); } }));
    return [settingsCard(`Members — ${all.length}`, search, list)];
  }

  // --- Bans ---
  function bans() {
    const list = h('div', { class: 'manage-list' }, h('p', { class: 'loading' }, 'Loading…'));
    const load = async () => {
      const rows = await api.get(`/api/servers/${id}/bans`).catch(() => []);
      list.replaceChildren(...(rows.length ? rows.map(({ user, reason, bannedAt }) => h('div', { class: 'manage-row' },
        avatar(user, { size: 36 }),
        h('span', { class: 'manage-main' }, h('strong', {}, user.displayName), h('span', {}, [`@${user.username}`, `banned ${formatDate(bannedAt)}`, reason].filter(Boolean).join(' · '))),
        h('span', { class: 'manage-actions' }, button('Unban', () => attempt(async () => { await api.del(`/api/servers/${id}/bans/${user.id}`); load(); }), 'ghost small'))))
        : [emptyState('ban', 'Nobody is banned')]));
    };
    load();
    return [settingsCard('Banned', list)];
  }

  // --- Emoji ---
  function emoji() {
    const s = current();
    const list = s.emojis || [];
    const upload = async () => {
      const files = await pickFiles({ accept: 'image/png,image/jpeg,image/gif,image/webp', multiple: true });
      for (const file of files) {
        const name = file.name.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 32).padEnd(2, '_');
        await attempt(() => fetch(`/api/servers/${id}/emojis?name=${encodeURIComponent(name)}`, { method: 'POST', body: file, headers: { 'Content-Type': 'application/octet-stream' } })
          .then(async (r) => { if (!r.ok) throw new Error((await r.json()).error); }));
      }
    };
    return [
      settingsCard('Upload',
        settingRow(`${list.length} of 100 used`, button('Upload emoji', upload, 'ghost small'))),
      settingsCard(`Emoji — ${list.length}`, list.length ? h('div', { class: 'manage-list' }, list.map((e) => {
        const nameInput = h('input', {
          class: 'input inline-input', value: e.name, maxLength: 32,
          onchange: () => attempt(() => api.patch(`/api/servers/${id}/emojis/${e.id}`, { name: nameInput.value })),
        });
        return h('div', { class: 'manage-row' },
          h('img', { class: 'manage-emoji', src: e.url, alt: e.name }),
          h('span', { class: 'manage-main' }, h('span', { class: 'emoji-name-field' }, ':', nameInput, ':')),
          h('span', { class: 'manage-actions' }, confirmButton({
            label: 'Delete emoji', confirmLabel: 'Delete', face: icon('trash'), className: 'icon-button danger',
            onConfirm: () => api.del(`/api/servers/${id}/emojis/${e.id}`),
          })));
      })) : emptyState('smile', 'No custom emoji yet')),
    ];
  }

  // --- Audit log ---
  const ACTIONS = {
    'server.update': ['settings', 'changed the server'], 'server.icon': ['image', 'changed the server icon'], 'server.icon_remove': ['image', 'removed the server icon'],
    'server.banner': ['image', 'changed the server banner'], 'server.banner_remove': ['image', 'removed the server banner'],
    'role.create': ['tag', 'created the role'], 'role.update': ['tag', 'changed the role'], 'role.delete': ['tag', 'deleted the role'],
    'role.give': ['tag', 'gave a role to'], 'role.take': ['tag', 'took a role from'],
    'server.transfer': ['crown', 'handed the server to'], 'member.join': ['userPlus', 'joined'], 'member.leave': ['logout', 'left'],
    'member.kick': ['logout', 'kicked'], 'member.ban': ['ban', 'banned'], 'member.unban': ['ban', 'unbanned'],
    'member.timeout': ['clock', 'timed out'], 'member.timeout_remove': ['clock', 'removed the timeout on'],
    'member.admin_add': ['shield', 'made an admin:'], 'member.admin_remove': ['shield', 'removed admin from'],
    'channel.create': ['hash', 'created'], 'channel.update': ['hash', 'changed'], 'channel.delete': ['hash', 'deleted'], 'channel.reorder': ['hash', 'reordered channels in'],
    'category.create': ['folder', 'created the category'], 'category.update': ['folder', 'changed the category'], 'category.delete': ['folder', 'deleted the category'],
    'invite.create': ['link', 'created invite'], 'invite.delete': ['link', 'revoked invite'],
    'emoji.create': ['smile', 'added emoji'], 'emoji.update': ['smile', 'renamed emoji'], 'emoji.delete': ['smile', 'deleted emoji'],
    'message.delete': ['trash', 'deleted a message in'],
    'bot.create': ['bot', 'created the bot'], 'bot.update': ['bot', 'changed the bot'], 'bot.delete': ['bot', 'deleted the bot'],
  };

  function auditLog() {
    let filter = 'all';
    let entries = [];
    const list = h('div', { class: 'manage-list' }, h('p', { class: 'loading' }, 'Loading…'));
    const groups = { all: () => true, members: (a) => a.startsWith('member.') || a === 'server.transfer', channels: (a) => a.startsWith('channel.') || a.startsWith('category.'), other: (a) => !a.startsWith('member.') && !a.startsWith('channel.') && !a.startsWith('category.') };
    const draw = () => {
      const shown = entries.filter((e) => groups[filter](e.action));
      list.replaceChildren(...(shown.length ? shown.map((e) => {
        const [iconName, verb] = ACTIONS[e.action] || ['scroll', e.action];
        return h('div', { class: 'manage-row audit-row' },
          h('span', { class: 'manage-icon' }, icon(iconName, 18)),
          h('span', { class: 'manage-main' },
            h('span', { class: 'audit-line' }, h('strong', {}, e.actor?.displayName || 'Someone'), ` ${verb} `, e.target && h('strong', {}, e.target)),
            h('span', {}, [formatStamp(e.createdAt), e.details].filter(Boolean).join(' · '))));
      }) : [emptyState('scroll', 'Nothing logged yet')]));
    };
    api.get(`/api/servers/${id}/audit-log`).then((rows) => { entries = rows; draw(); }).catch(() => {});
    return [settingsCard(null, settingRow('Show', segmented([['all', 'Everything'], ['members', 'Members'], ['channels', 'Channels'], ['other', 'Other']], filter, (v) => { filter = v; draw(); }))),
      settingsCard('Recent actions', list)];
  }

  // --- Bots ---
  function bots() {
    const list = h('div', { class: 'manage-list' }, h('p', { class: 'loading' }, 'Loading…'));
    const name = h('input', { class: 'input', maxLength: 32, placeholder: 'Bot name', required: true });
    const load = async () => {
      const rows = await api.get(`/api/servers/${id}/bots`).catch(() => []);
      list.replaceChildren(...(rows.length ? rows.map((bot) => h('div', { class: 'manage-row' },
        avatar(bot.user, { size: 36 }),
        h('span', { class: 'manage-main' }, h('strong', {}, bot.user.displayName, h('span', { class: 'member-tag bot' }, 'Bot')),
          h('span', {}, `${bot.program.length} script${bot.program.length === 1 ? '' : 's'} · ${bot.enabled ? 'on' : 'off'}`)),
        h('span', { class: 'manage-actions always' },
          button('Edit blocks', () => openBotBuilder(current(), bot), 'ghost small'),
          iconButton(bot.enabled ? 'play' : 'x', bot.enabled ? 'Turn off' : 'Turn on', () => attempt(async () => { await api.patch(`/api/servers/${id}/bots/${bot.id}`, { enabled: !bot.enabled }); load(); }), bot.enabled ? 'on' : ''),
          confirmButton({
            label: 'Delete bot', confirmLabel: 'Delete', face: icon('trash'), className: 'icon-button danger',
            onConfirm: async () => { await api.del(`/api/servers/${id}/bots/${bot.id}`); load(); },
          })))) : [emptyState('bot', 'No bots yet')]));
    };
    load();
    return [
      settingsCard('New bot', form({
        submitLabel: 'Create bot',
        onSubmit: async () => {
          const bot = await api.post(`/api/servers/${id}/bots`, { name: name.value });
          name.value = '';
          load();
          openBotBuilder(current(), bot);
        },
      }, field('Name', name))),
      settingsCard('Bots', list),
    ];
  }

  function remove() {
    return [dangerCard(settingRow('Delete this server for everyone', confirmButton({
      label: 'Delete server', confirmLabel: 'Click again to delete',
      onConfirm: async () => { await api.del(`/api/servers/${id}`); page.close(); },
    })))];
  }

  const page = openSectionedPage({
    title: 'Server settings',
    groups: [
      [server.name, [['overview', 'Overview', overview, 'name icon description banner'], ['channels', 'Channels', channels, 'order slowmode topic category voice'],
        ['emoji', 'Emoji', emoji, 'custom emoji sticker'], ['invites', 'Invites', invites, 'link code']]],
      ['People', [['roles', 'Roles', () => rolesSection(id), 'roles colour color hoist permissions'], ['members', 'Members', members, 'kick ban owner admin timeout roles'], ['bans', 'Bans', bans, 'unban']]],
      ['Tools', [['bots', 'Bot builder', bots, 'bot blocks scratch automation'], ['audit', 'Audit log', auditLog, 'history log actions']]],
      server.ownerId === state.me.id && ['', [['delete', 'Delete server', remove, 'remove danger']]],
    ].filter(Boolean),
  });

  // Live changes (renames, new channels, members joining) redraw the open section, unless a field has focus.
  const redraw = () => {
    const layout = document.querySelector('.settings-layout');
    if (!layout) return stop();
    if (layout.contains(document.activeElement) && document.activeElement.matches('input:not([type=search]), textarea')) return;
    if (!state.servers.has(id)) { page.close(); return stop(); }
    layout.dispatchEvent(new Event('redraw'));
  };
  const stop = on('servers members', redraw);
}
