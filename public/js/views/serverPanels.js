import * as api from '../api.js';
import { h } from '../dom.js';
import { state, emit, upsertChannel } from '../store.js';
import { navigate, paths } from '../router.js';
import { joinInvite, parseInviteCode } from '../actions.js';
import { button, confirmButton, copyText, field, form, segmented, serverIcon, toast } from '../ui.js';
import { openPanel } from './side.js';

export function inviteCard(invite) {
  const count = invite.server.memberCount;
  return h('div', { class: 'invite-card' }, serverIcon(invite.server, 52),
    h('span', {}, h('strong', {}, invite.server.name), h('span', {}, `${count} member${count === 1 ? '' : 's'}`)));
}

// The + button on the rail: make a new server, or join one from an invite.
export function openAddServer() {
  const body = h('div', { class: 'form' });
  const switcher = segmented([['create', 'Create'], ['join', 'Join with invite']], 'create', show);
  const panel = openPanel({ title: 'Add a server', build: () => [switcher, body] });

  function show(mode) {
    body.replaceChildren(mode === 'create' ? createForm() : joinForm());
    body.querySelector('input').focus();
  }

  function createForm() {
    const name = h('input', { class: 'input', required: true, maxLength: 100, value: `${state.me.displayName}'s server` });
    return form({
      submitLabel: 'Create server',
      onSubmit: async () => {
        const server = await api.post('/api/servers', { name: name.value });
        state.servers.set(server.id, server);
        emit('servers');
        panel.close();
        navigate(paths.channel(server.id, server.channels[0].id));
      },
    }, field('Server name', name));
  }

  function joinForm() {
    const link = h('input', { class: 'input', required: true, placeholder: `${location.origin}/invite/abcd2345` });
    const preview = h('div', { class: 'form' });
    return h('div', { class: 'form' }, form({
      submitLabel: 'Look up',
      kind: 'ghost',
      onSubmit: async () => {
        preview.replaceChildren();
        const invite = await api.get(`/api/invites/${encodeURIComponent(parseInviteCode(link.value))}`);
        preview.replaceChildren(invitePreview(invite, panel.close));
      },
    }, field('Invite link or code', link)), preview);
  }

  show('create');
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
  }, 'accent wide');
  return h('div', { class: 'form' }, inviteCard(invite), join);
}

// Shown when a logged-in user opens an /invite/<code> link.
export function openInvite(invite) {
  const panel = openPanel({ title: "You've been invited", build: () => invitePreview(invite, () => panel.close()) });
}

export async function openInviteLink(server) {
  const invite = await api.post(`/api/servers/${server.id}/invites`);
  const link = h('input', { class: 'input', readOnly: true, value: `${location.origin}/invite/${invite.code}`, onfocus: () => link.select() });
  const copy = button('Copy link', async () => {
    await copyText(link.value);
    copy.textContent = 'Copied';
    setTimeout(() => { copy.textContent = 'Copy link'; }, 1500);
  }, 'primary wide');
  openPanel({
    title: `Invite to ${server.name}`,
    build: () => [h('p', { class: 'note' }, 'Send this link to a friend. Anyone with the link can join.'), link, copy],
  });
}

// Create a channel (no `channel`) or edit / delete one. Owner only.
export function openChannelPanel(server, channel) {
  const name = h('input', { class: 'input', required: true, maxLength: 100, value: channel?.name || '' });
  const topic = h('input', { class: 'input', maxLength: 1024, value: channel?.topic || '' });
  const editor = form({
    submitLabel: channel ? 'Save' : 'Create channel',
    onSubmit: async () => {
      if (channel) {
        await api.patch(`/api/channels/${channel.id}`, { name: name.value, topic: topic.value });
        panel.close();
        return;
      }
      const created = await api.post(`/api/servers/${server.id}/channels`, { name: name.value });
      upsertChannel(created);
      panel.close();
      navigate(paths.channel(server.id, created.id));
    },
  }, field('Channel name', name), channel && field('Topic', topic));

  const panel = openPanel({
    title: channel ? `Edit #${channel.name}` : 'New channel',
    build: () => [
      editor,
      channel && h('div', { class: 'section' },
        h('h3', {}, 'Delete channel'),
        h('p', { class: 'note' }, 'Removes all of its messages and files for everyone.'),
        h('div', {}, confirmButton({
          label: 'Delete channel', confirmLabel: 'Click again to delete',
          onConfirm: async () => {
            await api.del(`/api/channels/${channel.id}`);
            panel.close();
          },
        }))),
    ],
  });
}
