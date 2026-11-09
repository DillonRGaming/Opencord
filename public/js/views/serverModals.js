import * as api from '../api.js';
import { h } from '../dom.js';
import { state, emit, upsertChannel } from '../store.js';
import { navigate, paths } from '../router.js';
import { joinInvite, parseInviteCode } from '../actions.js';
import { button, copyText, field, form, segmented, serverIcon, toast } from '../ui.js';
import { openModal } from './modals.js';

export function inviteCard(invite) {
  const count = invite.server.memberCount;
  return h('div', { class: 'invite-card' }, serverIcon(invite.server, 56),
    h('span', {}, h('strong', {}, invite.server.name), h('span', {}, `${count} member${count === 1 ? '' : 's'}`)));
}

// The + button on the rail: make a new server, or join one from an invite.
export function openAddServer() {
  const body = h('div', { class: 'form' });
  const modal = openModal({
    title: 'Add a server',
    content: [segmented([['create', 'Create my own'], ['join', 'Join with an invite']], 'create', show), body],
  });

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
        modal.close();
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
        preview.replaceChildren(invitePreview(invite, modal.close));
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
  });
  return h('div', { class: 'form' }, inviteCard(invite), h('div', { class: 'form-actions' }, join));
}

// Shown when a logged-in user opens an /invite/<code> link.
export function openInvite(invite) {
  const modal = openModal({ title: "You've been invited", content: invitePreview(invite, () => modal.close()) });
}

export async function openInviteLink(server) {
  const invite = await api.post(`/api/servers/${server.id}/invites`);
  const link = h('input', { class: 'input', readOnly: true, value: `${location.origin}/invite/${invite.code}`, onfocus: () => link.select() });
  const copy = button('Copy', async () => {
    await copyText(link.value);
    copy.textContent = 'Copied';
    setTimeout(() => { copy.textContent = 'Copy'; }, 1500);
  });
  openModal({
    title: `Invite people to ${server.name}`,
    content: [
      h('p', { class: 'modal-text' }, 'Send this link to a friend. Anyone with the link can join.'),
      h('div', { class: 'row' }, link, copy),
    ],
  });
}

// Create a channel (no `channel`) or edit / delete one. Owner only.
export function openChannelModal(server, channel) {
  const name = h('input', { class: 'input', required: true, maxLength: 100, value: channel?.name || '' });
  const topic = h('input', { class: 'input', maxLength: 1024, value: channel?.topic || '' });
  const modal = openModal({
    title: channel ? `Edit #${channel.name}` : 'Create a channel',
    content: [
      form({
        submitLabel: channel ? 'Save' : 'Create channel',
        onSubmit: async () => {
          if (channel) {
            await api.patch(`/api/channels/${channel.id}`, { name: name.value, topic: topic.value });
          } else {
            const created = await api.post(`/api/servers/${server.id}/channels`, { name: name.value });
            upsertChannel(created);
            navigate(paths.channel(server.id, created.id));
          }
          modal.close();
        },
      }, field('Channel name', name), channel && field('Topic', topic)),
      channel && h('div', { class: 'modal-section' },
        h('p', { class: 'modal-text' }, 'Deleting a channel removes all of its messages and files for everyone.'),
        h('div', {}, deleteChannelButton(channel, () => modal.close()))),
    ],
  });
}

function deleteChannelButton(channel, done) {
  let armed = false;
  const el = button('Delete channel', async () => {
    if (!armed) {
      armed = true;
      el.textContent = 'Click again to delete';
      return;
    }
    try {
      await api.del(`/api/channels/${channel.id}`);
      done();
    } catch (err) {
      toast(err.message);
    }
  }, 'danger small');
  return el;
}
