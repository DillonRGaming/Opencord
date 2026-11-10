import * as api from '../api.js';
import { h } from '../dom.js';
import { state, emit, upsertChannel } from '../store.js';
import { navigate, paths } from '../router.js';
import { joinInvite, parseInviteCode } from '../actions.js';
import { button, confirmButton, copyText, field, form, segmented, serverIcon, settingRow, settingsCard, settingsHero, toast } from '../ui.js';
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

const KIND_LABEL = { text: 'Text', voice: 'Voice', category: 'Category' };

// Create a channel (no `channel`) or edit / delete one. Admins and the owner.
// `options.kind` / `options.parentId` preselect what a new one is and where it goes.
export function openChannelPage(server, channel, options = {}) {
  let kind = channel?.kind || options.kind || 'text';
  let parentId = channel ? channel.parentId || null : options.parentId || null;
  let slowmode = channel?.slowmode || 0;
  let readOnly = Boolean(channel?.readOnly);
  const categories = server.channels.filter((c) => c.kind === 'category').sort((a, b) => a.position - b.position);

  const name = h('input', { class: 'input', required: true, maxLength: 100, value: channel?.name || '', placeholder: kind === 'category' ? 'Category name' : 'new-channel' });
  const topic = h('input', { class: 'input', maxLength: 1024, value: channel?.topic || '', placeholder: 'What this channel is for' });
  const extras = h('div', { class: 'form' });

  const drawExtras = () => extras.replaceChildren(...[
    kind !== 'category' && categories.length > 0 && settingRow('Category',
      segmented([[null, 'None'], ...categories.map((c) => [c.id, c.name])], parentId, (value) => { parentId = value; })),
    channel && kind === 'text' && field('Topic', topic),
    channel && kind === 'text' && settingRow('Slowmode', segmented(SLOWMODE, slowmode, (value) => { slowmode = value; })),
    channel && kind === 'text' && settingRow('Who can post', segmented([[false, 'Everyone'], [true, 'Admins and owner']], readOnly, (value) => { readOnly = value; })),
  ].filter(Boolean));

  const editor = form({
    submitLabel: channel ? 'Save changes' : `Create ${KIND_LABEL[kind].toLowerCase()}${kind === 'category' ? '' : ' channel'}`,
    onSubmit: async () => {
      if (channel) {
        const body = { name: name.value };
        if (kind === 'text') Object.assign(body, { topic: topic.value, slowmode, readOnly });
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
      if (kind === 'text') navigate(paths.channel(server.id, created.id));
    },
  }, !channel && settingRow('Type', segmented([['text', 'Text'], ['voice', 'Voice'], ['category', 'Category']], kind, (value) => {
    kind = value;
    name.placeholder = kind === 'category' ? 'Category name' : 'new-channel';
    editor.querySelector('button[type=submit]').textContent = `Create ${KIND_LABEL[kind].toLowerCase()}${kind === 'category' ? '' : ' channel'}`;
    drawExtras();
  })), field(kind === 'category' ? 'Name' : 'Channel name', name), extras);
  drawExtras();

  const what = kind === 'category' ? 'category' : 'channel';
  const page = openPage({
    title: channel ? (kind === 'category' ? channel.name : `${kind === 'voice' ? '🔊' : '#'} ${channel.name}`) : `New in ${server.name}`,
    content: h('div', { class: 'settings-content' },
      settingsCard(channel ? KIND_LABEL[kind] : null, editor),
      channel && h('section', { class: 'settings-card danger' }, h('h2', { class: 'settings-card-title' }, 'Danger zone'),
        settingRow(kind === 'category' ? 'Delete this category (its channels stay)' : 'Delete this channel and its messages', confirmButton({
          label: `Delete ${what}`, confirmLabel: 'Click again to delete',
          onConfirm: async () => {
            await api.del(`/api/channels/${channel.id}`);
            page.close();
          },
        })))),
  });
}
