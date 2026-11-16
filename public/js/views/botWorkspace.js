// The bot workspace (/bots): laid out like a server. The left column lists your bots, or, with a bot open,
// holds its blocks; the main column holds the canvas, or the bot's profile. Developer mode puts a bot button
// next to Settings to get here.
import * as api from '../api.js';
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { state, emit, can } from '../store.js';
import { navigate, paths } from '../router.js';
import { attempt, avatar, emptyList, switchControl, toast } from '../ui.js';
import { showMenu } from '../contextMenu.js';
import { createBotBuilder } from './botBuilder.js';
import { botProfileView } from './botSettings.js';

const LAST_BOT = 'oc:lastBot';
let lists = new Map(); // serverId → that server's bots
let loading = null;
let ws = null; // the open bot: { key, server, bot, builder, side, mountedOnce }

// Servers where you can make and edit bots.
const manageable = () => [...state.servers.values()].filter((s) => can(s.id, 'manageBots')).sort((a, b) => a.name.localeCompare(b.name));

async function loadBots(force = false) {
  if (loading && !force) return loading;
  loading = Promise.all(manageable().map(async (s) => [s.id, await api.get(`/api/servers/${s.id}/bots`).catch(() => [])]))
    .then((pairs) => { lists = new Map(pairs); emit('botws'); });
  return loading;
}

const findBot = (serverId, botId) => (lists.get(serverId) || []).find((b) => b.id === botId) || null;

// Where the bot button goes: the bot you had open last, or the list.
export function lastBotPath() {
  try { return localStorage.getItem(LAST_BOT) || paths.bots(); } catch { return paths.bots(); }
}

// A new bot starts as "New bot" with the robot picture; its Profile tab is where it gets a name.
async function newBot(server) {
  await attempt(async () => {
    const bot = await api.post(`/api/servers/${server.id}/bots`, { name: 'New bot' });
    await loadBots(true);
    navigate(paths.bots(server.id, bot.id, 'profile'));
  });
}

// --- the left column ---

function botRow(server, bot, active) {
  return h('button', {
    type: 'button', class: `nav-item bot-ws-item${active ? ' active' : ''}`,
    onclick: () => navigate(paths.bots(server.id, bot.id)),
  }, avatar(bot.user, { size: 28 }), h('span', { class: 'nav-label' }, bot.user.displayName),
  h('span', { class: `bot-ws-state${bot.enabled ? ' on' : ''}`, title: bot.enabled ? 'On' : 'Off' }));
}

function botList() {
  const servers = manageable();
  const route = state.route;
  return h('div', { class: 'bot-ws-side' },
    h('div', { class: 'sidebar-header' }, icon('bot', 20), h('span', { class: 'sidebar-title' }, 'Bots')),
    h('div', { class: 'sidebar-scroll' },
      servers.length ? servers.map((s) => [
        h('div', { class: 'sidebar-heading' }, s.name),
        (lists.get(s.id) || []).map((b) => botRow(s, b, route.botId === b.id)),
        h('button', { type: 'button', class: 'nav-item bot-ws-new', onclick: () => newBot(s) }, icon('plus', 18), h('span', { class: 'nav-label' }, 'New bot')),
      ]) : h('p', { class: 'field-hint bot-ws-none' }, 'You need a server where you can manage bots.')));
}

// The header above the blocks: the bot's name, which opens a menu to switch bots.
function botHeader() {
  const { server, bot } = ws;
  const others = manageable().flatMap((s) => (lists.get(s.id) || []).filter((b) => b.id !== bot.id).map((b) => ({ s, b })));
  return h('button', {
    type: 'button', class: 'sidebar-header', title: 'Switch bot',
    onclick: (event) => showMenu(event, [
      { label: 'All bots', icon: 'bot', onClick: () => navigate(paths.bots()) },
      others.length > 0 && '-',
      ...others.map(({ s, b }) => ({ label: `${b.user.displayName} · ${s.name}`, onClick: () => navigate(paths.bots(s.id, b.id)) })),
      '-',
      { label: `New bot in ${server.name}`, icon: 'plus', onClick: () => newBot(server) },
    ]),
  }, avatar(bot.user, { size: 24 }), h('span', { class: 'sidebar-title' }, bot.user.displayName), icon('chevronDown', 18));
}

// What the sidebar shows (called by views/sidebar.js on every redraw; the same element comes back while the
// same bot is open, so the palette keeps its scroll position).
export function botWorkspaceSidebar() {
  const route = state.route;
  if (ws && ws.key === `${route.serverId}/${route.botId}`) {
    ws.head.replaceChildren(botHeader());
    return ws.side;
  }
  if (!lists.size && !loading) loadBots();
  return botList();
}

// --- the main column ---

export async function showBotWorkspace(main) {
  const route = state.route;
  document.body.classList.add('bots-mode');
  if (!lists.size) await loadBots();
  if (state.route !== route) return; // moved on while loading

  if (!route.botId) {
    await leaveBotWorkspace();
    main.replaceChildren(h('div', { class: 'bot-ws-empty' },
      emptyList('bot', 'Pick a bot', manageable().length ? 'Choose one on the left, or make a new one.' : 'You need a server where you can manage bots.')));
    emit('botws');
    return;
  }

  const server = state.servers.get(route.serverId);
  const bot = server && findBot(route.serverId, route.botId);
  if (!bot) {
    navigate(paths.bots(), { replace: true });
    return;
  }
  try { localStorage.setItem(LAST_BOT, paths.bots(server.id, bot.id)); } catch { /* storage off */ }

  const key = `${server.id}/${bot.id}`;
  if (ws?.key !== key) {
    await leaveBotWorkspace();
    const builder = createBotBuilder(server, bot);
    const head = h('div', { class: 'bot-ws-head' });
    ws = { key, server, bot, builder, head, side: h('div', { class: 'bot-ws-side' }, head, builder.side), mountedOnce: false };
  }
  emit('botws');
  main.replaceChildren(workspaceMain(route.tab));
  if (route.tab === 'blocks') {
    // Shapes are measured, so they're drawn once both columns are on screen.
    requestAnimationFrame(() => ws?.builder.mounted());
  }
}

function workspaceMain(tab) {
  const { server, bot, builder } = ws;
  const tabs = h('div', { class: 'tabs bot-ws-tabs', role: 'tablist' }, [['blocks', 'Blocks'], ['profile', 'Profile']].map(([id, label]) => h('button', {
    type: 'button', role: 'tab', class: 'tab', 'aria-selected': String(tab === id),
    onclick: () => navigate(paths.bots(server.id, bot.id, id), { replace: true }),
  }, label)));
  const onSwitch = switchControl(Boolean(bot.enabled), (on) => attempt(async () => {
    Object.assign(bot, await api.patch(`/api/servers/${server.id}/bots/${bot.id}`, { enabled: on }));
    toast(on ? `${bot.user.displayName} is on.` : `${bot.user.displayName} is off: no blocks or AI run.`, 'ok');
    emit('botws');
  }), 'Bot on or off');
  const header = h('header', { class: 'main-header bot-ws-header' },
    h('div', { class: 'main-title' }, avatar(bot.user, { size: 24 }), h('span', {}, bot.user.displayName)),
    tabs,
    h('span', { class: 'main-spacer' }),
    h('label', { class: 'bot-ws-toggle' }, onSwitch, 'On'),
    builder.adminToggle,
    builder.status);
  const body = tab === 'profile'
    ? h('div', { class: 'page-scroll' }, h('div', { class: 'page-content' }, botProfileView(server, bot, {
      onChange: () => { emit('botws'); },
      onDelete: async () => { ws = null; await loadBots(true); navigate(paths.bots(), { replace: true }); toast('Bot deleted.', 'ok'); },
    })))
    : builder.stage;
  return h('div', { class: `bot-ws${tab === 'profile' ? ' profile' : ''}` }, header, body);
}

// Leaving the workspace (or switching bots) saves first.
export async function leaveBotWorkspace() {
  document.body.classList.toggle('bots-mode', state.route.name === 'bots');
  if (!ws) return;
  const { builder } = ws;
  ws = null;
  try { await builder.flush(); } catch { toast('Your last bot changes could not be saved.'); }
}
