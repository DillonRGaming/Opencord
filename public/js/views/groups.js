import * as api from '../api.js';
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { state, on, relationsWith, dmName, dmPeople } from '../store.js';
import { navigate, paths } from '../router.js';
import { attempt, avatar, button, confirmButton, field, form, settingRow, settingsCard, toast } from '../ui.js';
import { openPage } from './page.js';

const GROUP_MAX = 10;

// A searchable list of friends with tick boxes. `exclude` hides people already in the group.
function friendPicker({ exclude = [], max, onChange }) {
  const chosen = new Set();
  let query = '';
  const list = h('div', { class: 'manage-list picker' });
  const friends = relationsWith('friend').map((r) => r.user).filter((u) => !exclude.includes(u.id))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
  const draw = () => list.replaceChildren(...(friends.length ? friends
    .filter((u) => `${u.displayName}\n${u.username}`.toLowerCase().includes(query))
    .map((user) => {
      const on = chosen.has(user.id);
      return h('button', {
        type: 'button', class: `manage-row pick${on ? ' chosen' : ''}`, 'aria-pressed': String(on),
        onclick: () => {
          if (on) chosen.delete(user.id);
          else if (chosen.size < max) chosen.add(user.id);
          else toast(`Groups can have up to ${GROUP_MAX} people.`);
          draw();
          onChange([...chosen]);
        },
      }, avatar(user, { size: 36, presence: true }),
      h('span', { class: 'manage-main' }, h('strong', {}, user.displayName), h('span', {}, `@${user.username}`)),
      h('span', { class: 'pick-box' }, on && icon('check', 16)));
    }) : [h('p', { class: 'note' }, 'Add some friends first, then you can make a group with them.')]));
  draw();
  const search = h('label', { class: 'member-search' }, icon('search', 16),
    h('input', { type: 'search', placeholder: 'Search friends', oninput: (e) => { query = e.target.value.trim().toLowerCase(); draw(); } }));
  return [search, list];
}

export function openNewGroup() {
  let picked = [];
  const name = h('input', { class: 'input', maxLength: 100, placeholder: 'Optional' });
  const count = h('span', { class: 'note' }, `0 of ${GROUP_MAX - 1} picked`);
  const page = openPage({
    title: 'New group',
    content: h('div', { class: 'settings-content' },
      settingsCard('People', count, friendPicker({
        max: GROUP_MAX - 1,
        onChange: (ids) => { picked = ids; count.textContent = `${ids.length} of ${GROUP_MAX - 1} picked`; },
      })),
      settingsCard('Group', form({
        submitLabel: 'Create group',
        onSubmit: async () => {
          if (picked.length < 2) throw new Error('Pick at least 2 friends. For one person, just message them.');
          const group = await api.post('/api/dms/group', { userIds: picked, name: name.value });
          state.dms.set(group.id, group);
          page.close();
          navigate(paths.dm(group.id));
        },
      }, field('Group name', name)))),
  });
}

export function openGroupSettings(dm) {
  const content = h('div', { class: 'settings-content' });
  const draw = () => {
    const group = state.dms.get(dm.id);
    if (!group) return page.close();
    const owner = group.ownerId === state.me.id;
    const name = h('input', { class: 'input', maxLength: 100, value: group.name, placeholder: dmName(group) });
    let adding = [];
    const people = [state.me, ...dmPeople(group)];
    content.replaceChildren(
      settingsCard('Name', form({
        submitLabel: 'Save',
        onSubmit: async () => { await api.patch(`/api/dms/${group.id}`, { name: name.value }); toast('Group renamed.', 'ok'); },
      }, field('Group name', name))),
      settingsCard(`Members — ${people.length}`, h('div', { class: 'manage-list' }, people.map((user) => h('div', { class: 'manage-row' },
        avatar(user, { size: 36, presence: true }),
        h('span', { class: 'manage-main' }, h('strong', {}, user.displayName, user.id === group.ownerId && h('span', { class: 'member-tag' }, 'Owner')),
          h('span', {}, `@${user.username}`)),
        owner && user.id !== state.me.id && h('span', { class: 'manage-actions' }, confirmButton({
          label: 'Remove from group', confirmLabel: 'Remove', face: icon('x'), className: 'icon-button danger',
          onConfirm: () => api.del(`/api/dms/${group.id}/members/${user.id}`),
        })))))),
      people.length < GROUP_MAX && settingsCard('Add people', friendPicker({
        exclude: people.map((u) => u.id), max: GROUP_MAX - people.length, onChange: (ids) => { adding = ids; },
      }), h('div', {}, button('Add to group', () => attempt(async () => {
        for (const id of adding) await api.put(`/api/dms/${group.id}/members/${id}`);
        if (adding.length) toast('Added.', 'ok');
      }), 'ghost small'))),
      h('section', { class: 'settings-card danger' }, h('h2', { class: 'settings-card-title' }, 'Leave'),
        settingRow('Leave this group', confirmButton({
          label: 'Leave group', confirmLabel: 'Click again to leave',
          onConfirm: async () => { await api.del(`/api/dms/${group.id}/members/@me`); page.close(); },
        }))),
    );
  };
  const page = openPage({ title: dmName(dm), content });
  draw();
  const stop = on('dms', () => {
    if (!content.isConnected) return stop();
    if (!content.contains(document.activeElement)) draw();
  });
}

