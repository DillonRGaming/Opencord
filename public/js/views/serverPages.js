import * as api from '../api.js';
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { state, emit, upsertChannel } from '../store.js';
import { navigate, paths } from '../router.js';
import { joinInvite, parseInviteCode } from '../actions.js';
import { attempt, button, confirmButton, copyText, field, form, segmented, serverIcon, settingRow, settingsCard, settingsHero, toast } from '../ui.js';
import { openPage } from './page.js';

export function inviteCard(invite) {
  const count = invite.server.memberCount;
  return h('div', { class: 'invite-card' }, serverIcon(invite.server, 52),
    h('span', {}, h('strong', {}, invite.server.name), h('span', {}, `${count} member${count === 1 ? '' : 's'}`)));
}

// The + button on the rail: the same sectioned layout as settings, with Create and Join.
export async function openAddServer(start = 'create') {
  const { openSectionedPage } = await import('./settings.js');

  function create() {
    const name = h('input', { class: 'input', required: true, maxLength: 100, value: `${state.me.displayName}'s server` });
    const hero = h('div');
    const drawHero = () => hero.replaceChildren(settingsHero(serverIcon({ name: name.value || '?' }, 72), name.value || 'Your server', 'A #general channel is made for you'));
    name.addEventListener('input', drawHero);
    drawHero();
    return [hero, settingsCard('Details', form({
      submitLabel: 'Create server',
      onSubmit: async () => {
        const server = await api.post('/api/servers', { name: name.value });
        state.servers.set(server.id, server);
        emit('servers');
        page.close();
        navigate(paths.channel(server.id, server.channels[0].id));
      },
    }, field('Server name', name)))];
  }

  function join() {
    const link = h('input', { class: 'input', required: true, placeholder: `${location.origin}/invite/abcd2345` });
    const preview = h('div');
    return [settingsCard('Invite', form({
      submitLabel: 'Look up invite',
      onSubmit: async () => {
        preview.replaceChildren();
        const invite = await api.get(`/api/invites/${encodeURIComponent(parseInviteCode(link.value))}`);
        preview.replaceChildren(invitePreview(invite, () => page.close()));
      },
    }, field('Invite link or code', link))), preview];
  }

  const page = openSectionedPage({
    title: 'Add a server',
    groups: [['Add a server', [['create', 'Create a server', create, 'new make'], ['join', 'Join with an invite', join, 'invite code link']]]],
    start,
  });
}

function invitePreview(invite, done) {
  const join = button('Join server', async () => {
    join.disabled = true;
    try {
      await joinInvite(invite.code);
      done();
    } catch (err) {
      toast(err.message);
      join.disabled = false;
    }
  }, 'accent');
  const count = invite.server.memberCount;
  return settingsHero(serverIcon(invite.server, 72), invite.server.name, `${count} member${count === 1 ? '' : 's'}`, join);
}

// Shown when a logged-in user opens an /invite/<code> link.
export function openInvite(invite) {
  const page = openPage({
    title: 'You’ve been invited',
    content: h('div', { class: 'settings-content' }, invitePreview(invite, () => page.close())),
  });
}

export async function openInviteLink(server) {
  const invite = await api.post(`/api/servers/${server.id}/invites`);
  const link = h('input', { class: 'input', readOnly: true, value: `${location.origin}/invite/${invite.code}`, onfocus: () => link.select() });
  const copy = button('Copy', async () => {
    await copyText(link.value);
    copy.textContent = 'Copied';
    setTimeout(() => { copy.textContent = 'Copy'; }, 1500);
  });
  openPage({
    title: `Invite people to ${server.name}`,
    content: h('div', { class: 'settings-content' },
      settingsHero(serverIcon(server, 72), server.name, 'Anyone with this link can join'),
      settingsCard('Invite link', h('div', { class: 'input-row' }, link, copy))),
  });
}

const SLOWMODE = [[0, 'Off'], [5, '5s'], [30, '30s'], [60, '1m'], [300, '5m'], [3600, '1h']];

const KIND_LABEL = { text: 'Text', voice: 'Voice', posts: 'Posts', whiteboard: 'Whiteboard', calendar: 'Calendar', music: 'Music', wiki: 'Wiki', category: 'Category' };
// The kinds you can make, as cards with a line about each.
const KIND_CARDS = [
  ['text', 'hash', 'Text', 'Messages, files and replies'],
  ['voice', 'volume', 'Voice', 'Talk, video and screen share'],
  ['posts', 'posts', 'Posts', 'Each post gets its own replies'],
  ['whiteboard', 'whiteboard', 'Whiteboard', 'An endless canvas to draw on together'],
  ['calendar', 'calendar', 'Calendar', 'Events people can say they’re going to'],
  ['music', 'music', 'Music', 'A shared queue that plays in sync'],
  ['wiki', 'book', 'Wiki', 'Pages anyone can write and edit'],
  ['category', 'folder', 'Category', 'A folder for other channels'],
];

function kindPicker(current, onPick) {
  const el = h('div', { class: 'kind-picker', role: 'radiogroup', 'aria-label': 'Channel type' }, KIND_CARDS.map(([id, iconName, label, hint]) => h('button', {
    type: 'button', class: 'kind-card', role: 'radio', 'aria-checked': String(id === current),
    onclick: (event) => {
      for (const other of el.children) other.setAttribute('aria-checked', String(other === event.currentTarget));
      onPick(id);
    },
  }, icon(iconName, 20), h('span', { class: 'kind-text' }, h('strong', {}, label), h('span', {}, hint)))));
  return el;
}

// Tap roles to pick them: the chips light up. Used for "who can see it" and "who can post".
function rolePicker(roles, picked, onChange, note) {
  const chosen = new Set(picked);
  const el = h('div', { class: 'role-picker' },
    roles.length
      ? roles.map((role) => h('button', {
        type: 'button', class: 'role-chip pick', 'aria-pressed': String(chosen.has(role.id)), style: role.color ? { '--role': role.color } : null,
        onclick: (event) => {
          if (chosen.has(role.id)) chosen.delete(role.id); else chosen.add(role.id);
          event.currentTarget.setAttribute('aria-pressed', String(chosen.has(role.id)));
          onChange([...chosen]);
        },
      }, h('span', { class: 'role-dot', style: { background: role.color || 'var(--text-faint)' } }), role.name))
      : h('span', { class: 'muted' }, 'This server has no roles yet. Make some in Server settings → Roles.'),
    note && h('p', { class: 'muted role-picker-note' }, note));
  return el;
}

// Linked channels: share this channel's messages with channels in your other servers.
function linksCard(channel) {
  const body = h('div', { class: 'form' }, h('p', { class: 'loading' }, 'Loading…'));
  const load = () => api.get(`/api/channels/${channel.id}/links`).then(({ linked, candidates }) => {
    const pick = h('select', { class: 'input', 'aria-label': 'Channel to link' },
      candidates.map((c) => h('option', { value: c.id }, `${c.serverName} · #${c.name}`)));
    body.replaceChildren(
      h('p', { class: 'muted' }, 'Messages posted in any linked channel show up in all of them, with where they came from. Only channels in servers you own can be linked.'),
      linked.length
        ? h('div', { class: 'manage-list' }, linked.map((c) => h('div', { class: 'manage-row' },
          h('span', { class: 'attachment-icon' }, icon('link', 18)),
          h('span', { class: 'manage-main' }, h('strong', {}, `#${c.name}`), h('span', {}, c.serverName)))))
        : h('p', { class: 'muted' }, 'Not linked to anything yet.'),
      candidates.length
        ? h('div', { class: 'button-row' }, pick, button('Link', () => attempt(async () => {
          await api.post(`/api/channels/${channel.id}/links`, { channelId: pick.value });
          load();
        }), 'primary small'))
        : h('p', { class: 'muted' }, 'You need another server of your own to link to.'),
      linked.length > 0 && h('div', {}, button('Unlink this channel', () => attempt(async () => {
        await api.del(`/api/channels/${channel.id}/links`);
        load();
      }), 'ghost small')));
  }).catch((err) => body.replaceChildren(h('p', { class: 'muted' }, err.message)));
  load();
  return settingsCard('Linked channels', body);
}

// Create a channel (no `channel`) or edit / delete one. Admins and the owner.
// `options.kind` / `options.parentId` preselect what a new one is and where it goes.
export function openChannelPage(server, channel, options = {}) {
  let kind = channel?.kind || options.kind || 'text';
  let parentId = channel ? channel.parentId || null : options.parentId || null;
  let slowmode = channel?.slowmode || 0;
  let readOnly = Boolean(channel?.readOnly);
  let viewRoles = channel?.viewRoles || null; // null = everyone
  let postRoles = channel?.postRoles || [];
  const roles = server.roles || [];
  const categories = server.channels.filter((c) => c.kind === 'category').sort((a, b) => a.position - b.position);

  const name = h('input', { class: 'input', required: true, maxLength: 100, value: channel?.name || '', placeholder: kind === 'category' ? 'Category name' : 'new-channel' });
  const topic = h('input', { class: 'input', maxLength: 1024, value: channel?.topic || '', placeholder: 'What this channel is for' });
  const extras = h('div', { class: 'form' });

  const drawExtras = () => extras.replaceChildren(...[
    kind !== 'category' && categories.length > 0 && settingRow('Category',
      segmented([[null, 'None'], ...categories.map((c) => [c.id, c.name])], parentId, (value) => { parentId = value; })),
    channel && ['text', 'posts', 'calendar', 'music', 'wiki'].includes(kind) && field('Topic', topic),
    channel && kind === 'text' && settingRow('Slowmode', segmented(SLOWMODE, slowmode, (value) => { slowmode = value; })),
    // Permissions, kept to two plain questions: who can see it, and who can post in it.
    channel && kind !== 'category' && settingRow('Who can see it', segmented([[false, 'Everyone'], [true, 'Only some roles']], Boolean(viewRoles), (value) => {
      viewRoles = value ? (viewRoles || []) : null;
      drawExtras();
    })),
    channel && viewRoles && rolePicker(roles, viewRoles, (next) => { viewRoles = next; }, 'Admins and people who can manage channels always see it.'),
    channel && ['text', 'posts', 'calendar', 'music', 'wiki'].includes(kind) && settingRow({ posts: 'Who can start posts', calendar: 'Who can add events', music: 'Who can add songs', wiki: 'Who can write pages' }[kind] || 'Who can post', segmented([[false, 'Everyone'], [true, 'Only some roles']], readOnly, (value) => { readOnly = value; drawExtras(); })),
    channel && readOnly && ['text', 'posts', 'calendar', 'music', 'wiki'].includes(kind) && rolePicker(roles, postRoles, (next) => { postRoles = next; }, 'Admins and the owner always can.'),
  ].filter(Boolean));

  const editor = form({
    submitLabel: channel ? 'Save changes' : `Create ${KIND_LABEL[kind].toLowerCase()}${kind === 'category' ? '' : ' channel'}`,
    onSubmit: async () => {
      if (channel) {
        const body = { name: name.value };
        if (kind === 'text') Object.assign(body, { topic: topic.value, slowmode, readOnly, postRoles });
        if (['posts', 'calendar', 'music', 'wiki'].includes(kind)) Object.assign(body, { topic: topic.value, readOnly, postRoles });
        if (kind !== 'category') body.viewRoles = viewRoles;
        await api.patch(`/api/channels/${channel.id}`, body);
        if (kind !== 'category' && (parentId || null) !== (channel.parentId || null)) {
          await api.put(`/api/servers/${server.id}/channels/order`, { items: [{ id: channel.id, parentId }] });
        }
        page.close();
        return;
      }
      const created = await api.post(`/api/servers/${server.id}/channels`, { name: name.value, kind, parentId: kind === 'category' ? null : parentId });
      upsertChannel(created);
      page.close();
      if (!['voice', 'category'].includes(kind)) navigate(paths.channel(server.id, created.id));
    },
  }, !channel && kindPicker(kind, (value) => {
    kind = value;
    name.placeholder = kind === 'category' ? 'Category name' : 'new-channel';
    editor.querySelector('button[type=submit]').textContent = `Create ${KIND_LABEL[kind].toLowerCase()}${kind === 'category' ? '' : ' channel'}`;
    drawExtras();
  }), field(kind === 'category' ? 'Name' : 'Channel name', name), extras);
  drawExtras();

  const what = kind === 'category' ? 'category' : 'channel';
  const page = openPage({
    title: channel ? (['text', 'voice'].includes(kind) ? `${kind === 'voice' ? '🔊' : '#'} ${channel.name}` : channel.name) : `New in ${server.name}`,
    content: h('div', { class: 'settings-content' },
      settingsCard(channel ? KIND_LABEL[kind] : null, editor),
      channel && kind === 'text' && server.ownerId === state.me.id && linksCard(channel),
      channel && h('section', { class: 'settings-card danger' }, h('h2', { class: 'settings-card-title' }, 'Danger zone'),
        settingRow(kind === 'category' ? 'Delete this category (its channels stay)' : kind === 'posts' ? 'Delete this channel and every post in it'
          : kind === 'text' ? 'Delete this channel and its messages' : `Delete this ${KIND_LABEL[kind].toLowerCase()} channel and everything in it`, confirmButton({
          label: `Delete ${what}`, confirmLabel: 'Click again to delete',
          onConfirm: async () => {
            await api.del(`/api/channels/${channel.id}`);
            page.close();
          },
        })))),
  });
}
