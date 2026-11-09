import * as api from '../api.js';
import { h } from '../dom.js';
import { attempt, button, field, form, pickFiles, serverIcon, toast } from '../ui.js';
import { confirmDialog, openModal } from './modals.js';
import { openInviteLink } from './serverModals.js';

// Owner only: name, icon, invite link, delete.
export function openServerSettings(server) {
  let current = server;
  const name = h('input', { class: 'input', required: true, maxLength: 100, value: server.name });
  const iconPreview = h('span');
  const drawIcon = () => iconPreview.replaceChildren(serverIcon(current, 56));

  async function changeIcon() {
    const [file] = await pickFiles({ accept: 'image/png,image/jpeg,image/gif,image/webp' });
    if (!file) return;
    await attempt(async () => { current = await api.putFile(`/api/servers/${server.id}/icon`, file); });
    drawIcon();
  }

  async function removeIcon() {
    await attempt(async () => { current = await api.del(`/api/servers/${server.id}/icon`); });
    drawIcon();
  }

  async function deleteServer() {
    const sure = await confirmDialog({
      title: `Delete ${current.name}?`,
      text: 'Every channel, message and file in this server will be deleted for everyone. This cannot be undone.',
      confirmLabel: 'Delete server',
      danger: true,
    });
    if (!sure) return;
    await attempt(() => api.del(`/api/servers/${server.id}`));
    modal.close();
  }

  drawIcon();
  const modal = openModal({
    title: 'Server settings',
    wide: true,
    content: [
      form({
        submitLabel: 'Save name',
        onSubmit: async () => {
          current = await api.patch(`/api/servers/${server.id}`, { name: name.value });
          toast('Server renamed.', 'ok');
        },
      }, field('Server name', name)),
      h('div', { class: 'modal-section' }, h('h3', {}, 'Icon'),
        h('div', { class: 'row wrap' }, iconPreview, button('Change icon', changeIcon, 'ghost'), button('Remove', removeIcon, 'ghost'))),
      h('div', { class: 'modal-section' }, h('h3', {}, 'Invite people'),
        h('div', {}, button('Create invite link', () => attempt(() => openInviteLink(current)), 'ghost'))),
      h('div', { class: 'modal-section' }, h('h3', {}, 'Delete server'),
        h('div', {}, button('Delete this server', deleteServer, 'danger'))),
    ],
  });
}
