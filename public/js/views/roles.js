// Custom roles: the chips on a profile (with add/remove for admins) and the Roles section of server settings.
import * as api from '../api.js';
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { state, memberRoles, roleOf, canModerate, can, PERMISSIONS } from '../store.js';
import { showMenu } from '../contextMenu.js';
import { attempt, avatar, button, confirmButton, iconButton, switchControl } from '../ui.js';
import { colorField } from '../colorPicker.js';
import { ensureMembers } from './members.js';

const COLORS = ['#e3a3a3', '#e0a07e', '#d6bb84', '#c8cf9e', '#a9c79a', '#8fc1d6', '#a99bf0', '#d6a8c8', '#b9bdb5'];

const isOwner = (serverId) => state.servers.get(serverId)?.ownerId === state.me.id;

// Admins can hand out roles; only the owner can hand out (or take away) one with admin powers,
// and only the owner can change the roles of another admin.
// People who can manage roles but aren't admins hand out plain roles only (no admin powers, no permissions).
function canGive(serverId, role) {
  if (!can(serverId, 'manageRoles')) return false;
  if (role.admin) return isOwner(serverId);
  return canModerate(serverId) || !role.perms?.length;
}

export function canEditRolesOf(serverId, userId) {
  if (!can(serverId, 'manageRoles')) return false;
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

let openRoleId = null; // the role whose editor is open in settings
let memberQuery = '';

const switchButton = switchControl;

// What the role lets people do: one switch per permission, with a line saying what it means. Admin powers
// include all of them. Only admins and the owner can change these.
function permissionsBlock(serverId, role, save) {
  const editable = canModerate(serverId) && (!role.admin || isOwner(serverId));
  const perms = new Set(role.perms || []);
  return h('div', { class: 'role-perms' },
    h('div', { class: 'role-people-title' }, 'Permissions'),
    role.admin && h('p', { class: 'muted' }, 'Admin powers include all of these.'),
    PERMISSIONS.map(([key, name, about]) => h('label', { class: 'perm-row' },
      h('span', { class: 'perm-text' }, h('strong', {}, name), h('span', {}, about)),
      switchControl(role.admin || perms.has(key), (on) => {
        if (on) perms.add(key); else perms.delete(key);
        save({ perms: [...perms] });
      }, name, !editable || role.admin))));
}

// A compact list of roles; tapping one opens its editor underneath (name, colour, switches and who has it).
export function rolesSection(serverId) {
  const server = state.servers.get(serverId);
  const roles = server.roles || [];
  const owner = isOwner(serverId);
  ensureMembers(serverId);
  const members = (state.members.get(serverId) || []).filter((m) => !m.user.bot);
  const holders = (role) => members.filter((m) => m.roleIds?.includes(role.id));
  if (openRoleId && !roles.some((r) => r.id === openRoleId)) openRoleId = null;

  const redraw = () => document.querySelector('.settings-layout')?.dispatchEvent(new Event('redraw'));
  const create = () => attempt(async () => {
    const role = await api.post(`/api/servers/${serverId}/roles`, { name: 'New role', color: COLORS[roles.length % COLORS.length] });
    openRoleId = role.id;
  });
  const move = (index, by) => attempt(async () => {
    const ids = roles.map((r) => r.id);
    [ids[index], ids[index + by]] = [ids[index + by], ids[index]];
    await api.put(`/api/servers/${serverId}/roles/order`, { ids });
  });

  const editor = (role, index) => {
    const locked = role.admin && !owner;
    const save = (fields) => attempt(() => api.patch(`/api/servers/${serverId}/roles/${role.id}`, fields));
    const name = h('input', {
      class: 'input', value: role.name, maxLength: 40, disabled: locked, 'aria-label': 'Role name',
      onchange: () => name.value.trim() && save({ name: name.value.trim() }),
      onkeydown: (event) => { if (event.key === 'Enter') name.blur(); },
    });
    const has = holders(role);
    const canEdit = canGive(serverId, role);
    const others = members.filter((m) => !m.roleIds?.includes(role.id) && canEditRolesOf(serverId, m.user.id));
    const results = h('div', { class: 'role-add-list' });
    const drawResults = () => {
      const q = memberQuery.trim().toLowerCase();
      const found = q ? others.filter((m) => `${m.user.displayName} ${m.user.username}`.toLowerCase().includes(q)).slice(0, 8) : [];
      results.replaceChildren(...found.map((m) => h('button', {
        type: 'button', class: 'role-add-person', onclick: () => { memberQuery = ''; setRole(serverId, m.user.id, role.id, true); },
      }, avatar(m.user, { size: 24 }), h('span', {}, m.user.displayName), icon('plus', 15))));
    };
    const search = h('input', {
      class: 'input', placeholder: others.length ? 'Add someone…' : 'Everyone has this role', disabled: !canEdit || !others.length,
      value: memberQuery, 'aria-label': 'Add someone to this role',
      oninput: () => { memberQuery = search.value; drawResults(); },
    });
    drawResults();

    return h('div', { class: 'role-editor' },
      h('div', { class: 'role-edit-top' },
        colorField({ value: role.color, allowNone: true, disabled: locked, label: 'Role colour', onChange: (c) => save({ color: c }) }),
        name),
      h('div', { class: 'role-switches' },
        h('label', { class: 'role-switch' }, h('span', {}, 'Show separately in the member list'),
          switchButton(role.hoist, (v) => save({ hoist: v }), 'Show separately', locked)),
        h('label', { class: 'role-switch' }, h('span', {}, 'Anyone can @mention this role'),
          switchButton(role.mentionable, (v) => save({ mentionable: v }), 'Mentionable', locked)),
        owner && h('label', { class: 'role-switch' }, h('span', {}, 'Admin powers'),
          switchButton(role.admin, (v) => save({ admin: v }), 'Admin powers'))),
      permissionsBlock(serverId, role, save),
      h('div', { class: 'role-people' },
        h('div', { class: 'role-people-title' }, `People · ${has.length}`),
        has.length > 0 && h('div', { class: 'role-chips' }, has.map((m) => h('span', { class: 'role-chip person' },
          avatar(m.user, { size: 18 }), h('span', {}, m.user.displayName),
          canEdit && canEditRolesOf(serverId, m.user.id) && h('button', {
            type: 'button', class: 'role-chip-x', title: `Take ${role.name} from ${m.user.displayName}`, 'aria-label': `Remove ${m.user.displayName}`,
            onclick: () => setRole(serverId, m.user.id, role.id, false),
          }, icon('x', 12))))),
        canEdit && search, results),
      h('div', { class: 'role-edit-actions' },
        iconButton('arrowUp', 'Move up', () => move(index, -1), index === 0 ? 'hidden-action' : ''),
        iconButton('arrowDown', 'Move down', () => move(index, 1), index === roles.length - 1 ? 'hidden-action' : ''),
        h('span', { class: 'main-spacer' }),
        !locked && confirmButton({
          label: 'Delete role', confirmLabel: 'Delete?', face: icon('trash'), className: 'icon-button danger',
          onConfirm: () => api.del(`/api/servers/${serverId}/roles/${role.id}`),
        })));
  };

  const row = (role, index) => {
    const open = openRoleId === role.id;
    return h('div', { class: `role-item${open ? ' open' : ''}` },
      h('button', {
        type: 'button', class: 'role-head', 'aria-expanded': String(open),
        onclick: () => { openRoleId = open ? null : role.id; memberQuery = ''; redraw(); },
      }, swatch(role.color),
      h('span', { class: 'role-name', style: role.color ? { color: role.color } : null }, role.name),
      role.admin && icon('shield', 14),
      h('span', { class: 'role-count' }, String(holders(role).length)),
      icon('chevronDown', 16)),
      open && editor(role, index));
  };

  return [
    h('section', { class: 'settings-card' },
      h('div', { class: 'card-head' }, h('h2', { class: 'settings-card-title' }, 'Roles'), button('Create role', create, 'primary small')),
      roles.length
        ? h('div', { class: 'role-list' }, roles.map(row))
        : h('div', { class: 'empty-state small' }, h('span', { class: 'empty-icon' }, icon('tag', 22)), h('strong', {}, 'No roles yet'))),
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
        label: role.name, checked: mine.includes(role), swatch: role.color,
        onClick: () => setRole(serverId, user.id, role.id, !mine.includes(role)),
      })));
  });
}
