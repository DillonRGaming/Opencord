import * as api from '../api.js';
import { h } from '../dom.js';
import { state, emit, upsertChannel } from '../store.js';
import { navigate, paths } from '../router.js';
import { joinInvite, parseInviteCode } from '../actions.js';
import { button, confirmButton, copyText, field, form, serverIcon, toast } from '../ui.js';
import { openPage } from './page.js';

export function inviteCard(invite) {
  const count = invite.server.memberCount;
  return h('div', { class: 'invite-card' }, serverIcon(invite.server, 52),
    h('span', {}, h('strong', {}, invite.server.name), h('span', {}, `${count} member${count === 1 ? '' : 's'}`)));
}

function card(title, text, ...children) {
  return h('div', { class: 'card' }, h('h2', {}, title), text && h('p', { class: 'note' }, text), children);
}

// The + button on the rail: make a new server, or join one from an invite, side by side.
export function openAddServer() {
  const name = h('input', { class: 'input', required: true, maxLength: 100, value: `${state.me.displayName}'s server` });
  const create = form({
    submitLabel: 'Create server',
    onSubmit: async () => {
      const server = await api.post('/api/servers', { name: name.value });
      state.servers.set(server.id, server);
      emit('servers');
      page.close();
      navigate(paths.channel(server.id, server.channels[0].id));
    },
  }, field('Server name', name));

  const link = h('input', { class: 'input', required: true, placeholder: `${location.origin}/invite/abcd2345` });
  const preview = h('div', { class: 'form' });
  const join = form({
    submitLabel: 'Look up invite',
    kind: 'ghost',
    onSubmit: async () => {
      preview.replaceChildren();
      const invite = await api.get(`/api/invites/${encodeURIComponent(parseInviteCode(link.value))}`);
      preview.replaceChildren(invitePreview(invite, () => page.close()));
    },
  }, field('Invite link or code', link));

  const page = openPage({
    title: 'Add a server',
    content: h('div', { class: 'card-grid' },
      card('Create your own', 'A new server with a #general channel. You can add more channels after.', create),
      card('Join a friend’s', 'Paste the invite link they sent you.', join, preview)),
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
  return h('div', { class: 'form' }, inviteCard(invite), h('div', { class: 'form-actions' }, join));
}

// Shown when a logged-in user opens an /invite/<code> link.
export function openInvite(invite) {
  const page = openPage({
    title: 'You’ve been invited',
    content: h('div', { class: 'narrow' }, invitePreview(invite, () => page.close())),
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
    content: h('div', { class: 'narrow form' },
      h('p', { class: 'note' }, 'Send this link to a friend. Anyone with the link can join, and it never runs out.'),
      h('div', { class: 'row' }, link, copy)),
  });
}

// Create a channel (no `channel`) or edit / delete one. Owner only.
export function openChannelPage(server, channel) {
  const name = h('input', { class: 'input', required: true, maxLength: 100, value: channel?.name || '' });
  const topic = h('input', { class: 'input', maxLength: 1024, value: channel?.topic || '', placeholder: 'What this channel is for' });
  const editor = form({
    submitLabel: channel ? 'Save' : 'Create channel',
    onSubmit: async () => {
      if (channel) {
        await api.patch(`/api/channels/${channel.id}`, { name: name.value, topic: topic.value });
        page.close();
        return;
      }
      const created = await api.post(`/api/servers/${server.id}/channels`, { name: name.value });
      upsertChannel(created);
      page.close();
      navigate(paths.channel(server.id, created.id));
    },
  }, field('Channel name', name, 'Lower case, spaces become dashes.'), channel && field('Topic', topic));

  const page = openPage({
    title: channel ? `#${channel.name}` : `New channel in ${server.name}`,
    content: h('div', { class: 'narrow' },
      editor,
      channel && h('div', { class: 'section' },
        h('h3', {}, 'Delete channel'),
        h('p', { class: 'note' }, 'Removes all of its messages and files for everyone.'),
        h('div', {}, confirmButton({
          label: 'Delete channel', confirmLabel: 'Click again to delete',
          onConfirm: async () => {
            await api.del(`/api/channels/${channel.id}`);
            page.close();
          },
        })))),
  });
}
