// Custom roles: the chips on a profile (with add/remove for admins) and the Roles section of server settings.
import * as api from '../api.js';
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { state, memberRoles, roleOf, canModerate } from '../store.js';
import { showMenu } from '../contextMenu.js';
import { attempt, button, iconButton, segmented, settingRow, settingsCard, toast } from '../ui.js';

const COLORS = ['#e3a3a3', '#e0a07e', '#d6bb84', '#c8cf9e', '#a9c79a', '#8fc1d6', '#a99bf0', '#d6a8c8', '#b9bdb5'];

const isOwner = (serverId) => state.servers.get(serverId)?.ownerId === state.me.id;

// Admins can hand out roles; only the owner can hand out (or take away) one with admin powers,
// and only the owner can change the roles of another admin.
function canGive(serverId, role) {
  return canModerate(serverId) && (!role.admin || isOwner(serverId));
}

export function canEditRolesOf(serverId, userId) {
  if (!canModerate(serverId)) return false;
  const theirs = roleOf(serverId, userId);
  if (theirs === 'owner') return isOwner(serverId);
  return isOwner(serverId) || theirs === 'member' || userId === state.me.id;
}

const swatch = (color) => h('span', { class: 'role-dot', style: { background: color || 'var(--text-faint)' } });

function setRole(serverId, userId, roleId, on) {
  return attempt(() => (on ? api.put : api.del)(`/api/servers/${serverId}/members/${userId}/roles/${roleId}`));
}

// The roles someone has in a server, as small chips. Admins get an × on each and a + to add more.
export function roleChips(serverId, user) {
  const server = state.servers.get(serverId);
  if (!server || user.bot) return null;
  const mine = memberRoles(serverId, user.id);
  const editable = canEditRolesOf(serverId, user.id);
  const addable = editable ? (server.roles || []).filter((r) => !mine.includes(r) && canGive(serverId, r)) : [];
  if (!mine.length && !addable.length) return null;
  return h('div', { class: 'profile-roles' },
    h('div', { class: 'profile-roles-title' }, mine.length ? 'Roles' : 'No roles'),
    h('div', { class: 'role-chips' },
      mine.map((role) => h('span', { class: 'role-chip', style: role.color ? { '--role': role.color } : null },
        swatch(role.color), h('span', {}, role.name),
        editable && canGive(serverId, role) && h('button', {
          type: 'button', class: 'role-chip-x', title: `Remove ${role.name}`, 'aria-label': `Remove ${role.name}`,
          onclick: () => setRole(serverId, user.id, role.id, false),
        }, icon('x', 12)))),
      addable.length > 0 && h('button', {
        type: 'button', class: 'role-chip add', title: 'Add a role', 'aria-label': 'Add a role',
        onclick: (event) => {
          const box = event.currentTarget.getBoundingClientRect();
          showMenu({ clientX: box.left, clientY: box.bottom + 4, preventDefault() {}, stopPropagation() {} },
            addable.map((role) => ({ label: role.name, swatch: role.color, onClick: () => setRole(serverId, user.id, role.id, true) })));
        },
      }, icon('plus', 14))));
}

// --- server settings ---

export function rolesSection(serverId) {
  const server = state.servers.get(serverId);
  const roles = server.roles || [];
  const owner = isOwner(serverId);
  const members = state.members.get(serverId) || [];
  const count = (role) => members.filter((m) => m.roleIds?.includes(role.id)).length;

  const create = () => attempt(async () => {
    await api.post(`/api/servers/${serverId}/roles`, { name: 'New role', color: COLORS[roles.length % COLORS.length] });
    toast('Role created. Give it a name below.', 'ok');
  });
  const move = (index, by) => attempt(async () => {
    const ids = roles.map((r) => r.id);
    [ids[index], ids[index + by]] = [ids[index + by], ids[index]];
    await api.put(`/api/servers/${serverId}/roles/order`, { ids });
  });

  const roleCard = (role, index) => {
    const locked = role.admin && !owner;
    const save = (fields) => attempt(() => api.patch(`/api/servers/${serverId}/roles/${role.id}`, fields));
    const name = h('input', {
      class: 'input inline-input', value: role.name, maxLength: 40, disabled: locked, 'aria-label': 'Role name',
      onchange: () => name.value.trim() && save({ name: name.value.trim() }),
    });
    const color = h('input', { class: 'color-input', type: 'color', value: role.color || '#b9bdb5', disabled: locked, onchange: () => save({ color: color.value }) });
    return h('div', { class: 'role-row', style: role.color ? { '--role': role.color } : null },
      h('div', { class: 'role-row-head' },
        swatch(role.color), name,
        h('span', { class: 'role-count' }, `${count(role)} member${count(role) === 1 ? '' : 's'}`),
        h('span', { class: 'manage-actions always' },
          iconButton('arrowUp', 'Move up', () => move(index, -1), index === 0 ? 'hidden-action' : ''),
          iconButton('arrowDown', 'Move down', () => move(index, 1), index === roles.length - 1 ? 'hidden-action' : ''),
          !locked && iconButton('trash', `Delete ${role.name}`, () => attempt(() => api.del(`/api/servers/${serverId}/roles/${role.id}`)), 'danger'))),
      !locked && h('div', { class: 'role-row-body' },
        settingRow('Colour', [color, h('div', { class: 'role-colors' }, COLORS.map((c) => h('button', {
          type: 'button', class: 'role-color', style: { background: c }, title: c, 'aria-label': `Colour ${c}`, onclick: () => save({ color: c }),
        })), button('None', () => save({ color: null }), 'ghost small'))]),
        settingRow('List separately', segmented([[true, 'Yes'], [false, 'No']], role.hoist, (v) => save({ hoist: v }))),
        owner && settingRow('Admin powers', segmented([[true, 'Yes'], [false, 'No']], role.admin, (v) => save({ admin: v })))));
  };

  return [
    settingsCard(null, h('p', { class: 'muted' }, 'Roles give people a coloured name and can list them separately. The highest role with a colour wins.'),
      h('div', {}, button('Create role', create, 'primary small'))),
    roles.length
      ? settingsCard('Roles — highest first', h('div', { class: 'role-list' }, roles.map(roleCard)))
      : settingsCard('Roles', h('div', { class: 'empty-state small' }, h('span', { class: 'empty-icon' }, icon('tag', 22)), h('strong', {}, 'No roles yet'))),
    settingsCard('Give roles', h('p', { class: 'muted' }, 'Open someone’s profile and use the + under Roles, or the tag button next to them under Members.')),
  ];
}

// The role toggles for one member in the Members section.
export function memberRoleButton(serverId, user) {
  const server = state.servers.get(serverId);
  if (!server?.roles?.length || user.bot || !canEditRolesOf(serverId, user.id)) return null;
  return iconButton('tag', 'Roles', (event) => {
    const mine = memberRoles(serverId, user.id);
    const box = event.currentTarget.getBoundingClientRect();
    showMenu({ clientX: box.left, clientY: box.bottom + 4, preventDefault() {}, stopPropagation() {} },
      server.roles.filter((r) => canGive(serverId, r)).map((role) => ({
        label: `${role.name}${mine.includes(role) ? '  ✓' : ''}`, swatch: role.color,
        onClick: () => setRole(serverId, user.id, role.id, !mine.includes(role)),
      })));
  });
}
