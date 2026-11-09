import * as api from '../api.js';
import { h } from '../dom.js';
import { attempt, button, confirmButton, field, form, pickFiles, serverIcon, toast } from '../ui.js';
import { openPage } from './page.js';

// Owner only: name, icon, delete.
export function openServerSettings(server) {
  let current = server;
  const name = h('input', { class: 'input', required: true, maxLength: 100, value: server.name });
  const iconPreview = h('span');
  const drawIcon = () => iconPreview.replaceChildren(serverIcon(current, 64));

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

  drawIcon();
  const page = openPage({
    title: 'Server settings',
    content: h('div', { class: 'narrow' },
      h('div', { class: 'row wrap icon-row' }, iconPreview, button('Change icon', changeIcon, 'ghost small'), button('Remove', removeIcon, 'ghost small')),
      form({
        submitLabel: 'Save name',
        onSubmit: async () => {
          current = await api.patch(`/api/servers/${server.id}`, { name: name.value });
          toast('Server renamed.', 'ok');
        },
      }, field('Server name', name)),
      h('div', { class: 'section' }, h('h3', {}, 'Delete server'),
        h('p', { class: 'note' }, 'Every channel, message and file in it is deleted for everyone. This cannot be undone.'),
        h('div', {}, confirmButton({
          label: 'Delete this server', confirmLabel: 'Click again to delete it',
          onConfirm: async () => {
            await api.del(`/api/servers/${server.id}`);
            page.close();
          },
        })))),
  });
}
