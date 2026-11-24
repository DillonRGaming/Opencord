// The node bot builder: nodes on a canvas joined by wires, n8n-style. Trigger nodes start a flow, action nodes
// run one after another along the wires, and value nodes plug into the inputs of other nodes.
// The graph ({ nodes, edges }) is what you edit; on save it's turned into the same program the block builder
// made (scripts of blocks with reporters), so the server runs it unchanged (server/lib/bots.js).
import * as api from '../api.js';
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { attempt, toast, switchControl } from '../ui.js';
import { showMenu } from '../contextMenu.js';
import { CATEGORIES, BLOCKS, REPORTERS, upgrade } from './botBuilder.js';

const catById = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));
const clone = (value) => JSON.parse(JSON.stringify(value));
const newId = () => Math.random().toString(36).slice(2, 10);
const SLOT_KINDS = ['text', 'number', 'bool', 'role', 'secret'];
const CLIP_KEY = 'opencord.nodeClipboard';

// --- node definitions, built from the block definitions ---

const NAMES = {
  message: 'On message', ai_message: 'On talk to me', join: 'On member join', leave: 'On member leave',
  reaction: 'On reaction', button: 'On button click', menu: 'On menu pick', timer: 'Every few minutes', tool: 'AI tool',
  send: 'Send message', reply: 'Reply', dm: 'Direct message', react: 'React', buttons: 'Send buttons', menu_send: 'Send menu',
  pin: 'Pin message', unpin: 'Unpin message', wait: 'Wait', repeat: 'Repeat', forever: 'Forever', if: 'If', if_else: 'If / else',
  wait_until: 'Wait until', until: 'Repeat until', stop: 'Stop', set: 'Set variable', change: 'Change variable',
  list_add: 'Add to list', list_delete: 'Delete from list', list_clear: 'Clear list', list_insert: 'Insert into list',
  list_replace: 'Replace in list', ai_connect: 'Connect AI', ai_instructions: 'AI instructions', ai_reply: 'Answer with AI',
  ai_tell: 'Tell the AI', join_voice: 'Join voice', leave_voice: 'Leave voice', delete: 'Delete message', purge: 'Purge messages',
  everyone: 'Ping everyone', kick: 'Kick', ban: 'Ban', timeout: 'Time out', untimeout: 'End time out', create_channel: 'Create channel',
  delete_channel: 'Delete channel', rename_channel: 'Rename channel', topic: 'Set topic', slowmode: 'Slowmode', lock: 'Lock channel',
  invite: 'Make invite', give_role: 'Give role', take_role: 'Take role', toggle_role: 'Toggle role', create_role: 'Create role',
  rename_role: 'Rename role', color_role: 'Colour role', delete_role: 'Delete role',
  ping: 'Ping', random: 'Send random', http: 'Fetch data', math: 'Maths', random_number: 'Random number', text_case: 'Text case',
  list_remove: 'Remove from list', list_pick: 'Pick from list', ai_ask: 'Ask the AI',
  // values
  'r:add': 'Add', 'r:sub': 'Subtract', 'r:mul': 'Multiply', 'r:div': 'Divide', 'r:random': 'Random number', 'r:gt': 'Greater than',
  'r:lt': 'Less than', 'r:eq': 'Equals', 'r:and': 'And', 'r:or': 'Or', 'r:not': 'Not', 'r:join': 'Join text', 'r:letter': 'Letter of',
  'r:length': 'Length of text', 'r:contains': 'Contains', 'r:starts': 'Starts with', 'r:mod': 'Remainder', 'r:round': 'Round',
  'r:math': 'Maths function', 'r:case': 'Change case', 'r:var': 'Variable', 'r:list': 'List', 'r:item': 'List item',
  'r:list_random': 'Random list item', 'r:list_length': 'List length', 'r:list_contains': 'List contains',
  'r:user_name': 'Their name', 'r:user_mention': '@Them', 'r:user_id': 'Their username', 'r:message': 'The message',
  'r:said': 'What they said', 'r:words': 'Command words', 'r:word': 'Command word', 'r:mentioned_name': 'Mentioned name',
  'r:mentioned_mention': '@Mentioned', 'r:has_role': 'Has role', 'r:channel_name': 'Channel name', 'r:server_name': 'Server name',
  'r:member_count': 'Member count', 'r:button': 'Button clicked', 'r:choice': 'Menu choice', 'r:emoji': 'Reaction emoji',
  'r:now': 'Current time', 'r:web': 'Web data', 'r:ai_answer': 'AI answer', 'r:tool_input': 'Tool input', 'r:ai_error': 'AI error',
};
const LABELS = {
  text: 'Text', channel: 'Channel', emoji: 'Emoji', target: 'Who', options: 'Options (one per line)', seconds: 'Seconds',
  times: 'Times', cond: 'Condition', name: 'Name', value: 'Value', index: 'Position', url: 'URL', key: 'API key', model: 'Model',
  count: 'How many', reason: 'Reason', minutes: 'Minutes', kind: 'Kind', slow: 'Seconds between messages', lock: 'Action',
  role: 'Role', color: 'Colour', match: 'Match', description: 'Description', fn: 'Function', a: 'Value', b: 'Second value',
  left: 'Left', right: 'Right', field: 'Field', min: 'Min', max: 'Max', math: 'Operation', textCase: 'Case',
};
const OUT_LABELS = { if: { do: 'true' }, if_else: { do: 'true', else: 'false' }, repeat: { do: 'loop' }, forever: { do: 'loop' }, until: { do: 'loop' } };

// Each def: { id, kind: 'trigger'|'action'|'value', category, title, inputs: [part], outs(node) → [{ key, label }],
//   make(), bool (value nodes), legacy, block }
const DEFS = {};
for (const [type, block] of Object.entries(BLOCKS)) {
  if (type === 'command') continue; // the Commands node, below, does commands
  const inputs = block.parts.filter((p) => typeof p === 'object');
  const mouths = block.mouths || [];
  DEFS[type] = {
    id: type, kind: block.hat ? 'trigger' : 'action', category: block.category, title: NAMES[type] || type, inputs,
    legacy: block.legacy, parts: block.parts,
    outs: () => [
      ...mouths.map((m) => ({ key: m, label: OUT_LABELS[type]?.[m] || m })),
      ...(block.cap ? [] : [{ key: 'next', label: mouths.length ? 'after' : '' }]),
    ],
    make: () => { const d = block.make(); delete d.type; return d; },
  };
}
DEFS.commands = {
  id: 'commands', kind: 'trigger', category: 'events', title: 'Slash commands',
  inputs: [{ key: 'names', kind: 'lines', label: 'Commands (one per line)' }],
  parts: ['when someone types', { key: 'names', kind: 'lines' }],
  outs: (node) => cmdNames(node).map((n) => ({ key: `cmd:${n}`, label: `/${n}` })),
  make: () => ({ names: ['start', 'help'] }),
};
for (const [type, rep] of Object.entries(REPORTERS)) {
  DEFS[`r:${type}`] = {
    id: `r:${type}`, kind: 'value', category: rep.category, title: NAMES[`r:${type}`] || type, inputs: rep.parts.filter((p) => typeof p === 'object'),
    parts: rep.parts, bool: rep.shape === 'bool', outs: () => [],
    make: () => { const d = rep.make(['var', 'item', 'list_random', 'list_length', 'list_contains'].includes(type) ? '' : undefined); delete d.r; if ('name' in d && !d.name) d.name = type === 'var' ? 'my variable' : 'my list'; return d; },
  };
}
const cmdNames = (node) => [...new Set((node.data.names || []).map((n) => String(n).trim().replace(/^[!/]/, '').toLowerCase().replace(/\s+/g, '')).filter(Boolean))].slice(0, 25);
const isSlot = (part) => SLOT_KINDS.includes(part.kind);
const ICONS = { events: 'flag', messages: 'message', control: 'refresh', operators: 'plus', variables: 'tag', lists: 'scroll', info: 'search', ai: 'sparkles', voice: 'volume', admin: 'shield', roles: 'crown' };
const colorOf = (def) => catById[def.category]?.colors[0] || '#999';

// --- graph ⇄ program ---

// Turns the graph into the program the server runs.
export function compile(graph) {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const wireFrom = (id, out) => graph.edges.find((e) => e.from === id && e.out === out);
  const wireInto = (id, key) => graph.edges.find((e) => e.to === id && e.in === key);

  function value(node, depth = 0) {
    const def = DEFS[node.def];
    const out = { r: node.def.slice(2) };
    for (const part of def.inputs) {
      const wire = isSlot(part) && wireInto(node.id, part.key);
      const from = wire && byId.get(wire.from);
      out[part.key] = from && depth < 12 ? value(from, depth + 1) : (node.data[part.key] ?? '');
    }
    return out;
  }
  function action(node, seen) {
    const def = DEFS[node.def];
    const out = { type: node.def };
    for (const part of def.inputs) {
      const wire = isSlot(part) && wireInto(node.id, part.key);
      const from = wire && byId.get(wire.from);
      if (from && DEFS[from.def]?.kind === 'value') out[part.key] = value(from);
      else if (part.kind !== 'bool') out[part.key] = node.data[part.key] ?? '';
    }
    for (const m of BLOCKS[node.def].mouths || []) out[m] = chain(wireFrom(node.id, m)?.to, seen);
    return out;
  }
  // Follows the wires from one node: each node runs, then the node its "next" wire goes to. A node switched
  // off is passed over; a wire back to a node already in this flow stops it (no loops through wires).
  function chain(id, seen = new Set()) {
    const blocks = [];
    const here = new Set(seen);
    while (id && byId.has(id) && !here.has(id)) {
      here.add(id);
      const node = byId.get(id);
      if (DEFS[node.def]?.kind !== 'action') break;
      if (!node.off) blocks.push(action(node, here));
      id = wireFrom(id, 'next')?.to;
    }
    return blocks;
  }
  const program = [];
  for (const node of graph.nodes) {
    const def = DEFS[node.def];
    if (!def || def.kind !== 'trigger' || node.off) continue;
    const at = { x: Math.round(node.x), y: Math.round(node.y) };
    if (node.def === 'commands') {
      for (const name of cmdNames(node)) program.push({ trigger: { type: 'command', name }, blocks: chain(wireFrom(node.id, `cmd:${name}`)?.to), ...at });
    } else {
      const trigger = { type: node.def };
      for (const part of def.inputs) trigger[part.key] = node.data[part.key] ?? '';
      program.push({ trigger, blocks: chain(wireFrom(node.id, 'next')?.to), ...at });
    }
  }
  return program.slice(0, 30);
}

// About how tall a node is drawn (its settings are inside it), for laying nodes out without overlaps.
const isLong = (def, part) => part.kind === 'text' && ['text', 'description'].includes(part.key) && def.kind !== 'value';
function est(defId) {
  const def = DEFS[defId];
  let tall = 56;
  for (const p of def.inputs) tall += p.kind === 'lines' ? 104 : isLong(def, p) ? 92 : 60;
  return tall + 30 * def.outs({ data: { names: [] } }).filter((o) => o.label).length + 12;
}

// Lays out a program made elsewhere (the block builder, the AI) as nodes: each script a row going right,
// what's inside an if or a loop on the rows under it, values under the node they plug into.
export function decompile(program) {
  const graph = { nodes: [], edges: [] };
  const COL = 360;
  const ROW = 120;
  let y = 60;
  const add = (def, data, x, top) => {
    const node = { id: newId(), def, x, y: top, data };
    graph.nodes.push(node);
    return node;
  };
  const link = (from, out, to, key = 'exec') => from && graph.edges.push({ id: newId(), from: from.id, out, to: to.id, in: key });
  // Values go under their node, one per row; returns the next free row.
  function values(holder, node, x, row) {
    const def = DEFS[node.def];
    for (const part of def.inputs) {
      const v = holder[part.key];
      if (!v || typeof v !== 'object' || Array.isArray(v) || typeof v.r !== 'string' || !DEFS[`r:${v.r}`]) continue;
      const data = {};
      for (const [k, val] of Object.entries(v)) if (k !== 'r' && (typeof val !== 'object' || Array.isArray(val))) data[k] = val;
      const child = add(`r:${v.r}`, data, x - 290, row);
      link(child, 'value', node, part.key);
      row = values(v, child, x - 290, row + est(`r:${v.r}`) + 30);
      delete node.data[part.key];
    }
    return row;
  }
  function blocks(list, x, row, prev, out) {
    let bottom = row;
    for (const b of list || []) {
      if (!DEFS[b.type] || DEFS[b.type].kind !== 'action') continue;
      const data = {};
      for (const [k, val] of Object.entries(b)) if (!['type', 'do', 'else'].includes(k) && (typeof val !== 'object' || Array.isArray(val))) data[k] = val;
      const node = add(b.type, data, x, row);
      link(prev, out, node);
      const tall = est(b.type);
      // Values sit under it, and never up beside the (often tall) trigger on the left.
      const start = Math.max(row + Math.max(ROW, tall + 40), x - 290 < 400 ? clearY : 0);
      const end = values(b, node, x, start);
      bottom = Math.max(bottom, end > start ? end - 30 - ROW : row + tall - ROW + 40);
      for (const m of BLOCKS[b.type].mouths || []) bottom = blocks(b[m], x + COL, bottom + ROW, node, m);
      prev = node;
      out = 'next';
      x += COL;
    }
    return bottom;
  }
  let clearY = 0;
  const commands = program.filter((s) => s.trigger?.type === 'command');
  for (const script of program) {
    if (!script.trigger) continue;
    if (script.trigger.type === 'command') continue;
    if (!DEFS[script.trigger.type]) continue;
    const data = { ...script.trigger };
    delete data.type;
    const node = add(script.trigger.type, data, 60, y);
    clearY = y + est(script.trigger.type) + 40;
    y = blocks(script.blocks, 60 + COL, y, node, 'next') + ROW * 1.4;
  }
  if (commands.length) {
    const node = add('commands', { names: commands.map((s) => s.trigger.name) }, 60, y);
    clearY = y + est('commands') + 30 * commands.length + 40;
    for (const script of commands) y = blocks(script.blocks, 60 + COL * 1.3, y, node, `cmd:${script.trigger.name}`) + ROW;
  }
  return graph;
}


// --- the editor ---

// Same parts as the block builder gave the workspace: `side` (node list), `stage` (the canvas), `status`,
// `adminToggle`, `mounted()` and `flush()`. Every setting is edited right inside its node.
export function createBotBuilder(server, bot) {
  let graph;
  if (bot.graph?.nodes) graph = clone(bot.graph);
  else {
    const program = clone(bot.program || []);
    for (const s of program) upgrade(s.blocks);
    graph = decompile(program);
  }
  let view = graph.view || { x: 40, y: 40, zoom: 1 };
  let selected = null; // node id
  let selectedWire = null; // edge id
  let dirty = false;
  let admin = Boolean(bot.admin);

  const textChannels = server.channels.filter((c) => c.kind === 'text').sort((a, b) => a.position - b.position);
  const voiceChannels = server.channels.filter((c) => c.kind === 'voice').sort((a, b) => a.position - b.position);
  const status = h('span', { class: 'bb-status' }, 'Saved');

  const NS = 'http://www.w3.org/2000/svg';
  const wires = document.createElementNS(NS, 'svg');
  wires.classList.add('nb-wires');
  const world = h('div', { class: 'nb-world' }, wires);
  const viewport = h('div', { class: 'nb-view', tabindex: '-1' }, world);
  const picker = h('div', { class: 'nb-picker', hidden: true });
  const empty = h('div', { class: 'nb-empty', hidden: true },
    h('strong', {}, 'What should start this bot?'),
    h('span', {}, 'Every flow starts with a trigger, like a slash command or someone joining.'),
    h('button', { type: 'button', class: 'button primary', onclick: (e) => openPicker(e.currentTarget.getBoundingClientRect(), { kinds: ['trigger'] }) }, icon('plus', 16), 'Add a trigger'));
  const zoomLabel = h('span', { class: 'nb-zoom-label' });
  const toolbar = h('div', { class: 'nb-toolbar' },
    h('button', { type: 'button', title: 'Add a node', onclick: (e) => openPicker(e.currentTarget.getBoundingClientRect(), {}) }, icon('plus', 16), h('span', {}, 'Add node')),
    h('span', { class: 'nb-toolbar-gap' }),
    h('button', { type: 'button', title: 'Undo (Ctrl+Z)', 'aria-label': 'Undo', onclick: () => undo() }, icon('undo', 16)),
    h('button', { type: 'button', title: 'Zoom out', 'aria-label': 'Zoom out', onclick: () => zoomBy(1 / 1.2) }, icon('minus', 16)),
    zoomLabel,
    h('button', { type: 'button', title: 'Zoom in', 'aria-label': 'Zoom in', onclick: () => zoomBy(1.2) }, icon('plus', 16)),
    h('button', { type: 'button', title: 'Fit everything', onclick: () => fit() }, h('span', {}, 'Fit')));
  const stage = h('div', { class: 'bb-stage nb-stage' }, viewport, empty, toolbar, picker);

  const byId = (id) => graph.nodes.find((n) => n.id === id);
  const defOf = (node) => DEFS[node.def];
  const locked = (def) => !admin && catById[def.category]?.admin;
  const wireInto = (id, key) => graph.edges.find((e) => e.to === id && e.in === key);
  const wireFrom = (id, out) => graph.edges.find((e) => e.from === id && e.out === out);

  // --- history and saving ---
  const history = [JSON.stringify(graph.nodes) + JSON.stringify(graph.edges)];
  let future = [];
  let saveTimer = null;
  let saving = null;
  const snap = () => JSON.stringify({ nodes: graph.nodes, edges: graph.edges });
  history[0] = snap();

  function changed({ redraw = true } = {}) {
    const now = snap();
    if (history.at(-1) !== now) { history.push(now); if (history.length > 200) history.shift(); future = []; }
    dirty = true;
    status.textContent = 'Saving soon…';
    status.classList.add('dirty');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(autosave, 1200);
    if (redraw) draw();
  }
  function restore(json) {
    Object.assign(graph, JSON.parse(json));
    if (selected && !byId(selected)) selected = null;
    dirty = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(autosave, 1200);
    draw();
  }
  function undo() {
    if (history.length < 2) return;
    future.push(history.pop());
    restore(history.at(-1));
  }
  function redo() {
    if (!future.length) return;
    history.push(future.pop());
    restore(history.at(-1));
  }
  async function autosave() {
    if (dragging) { saveTimer = setTimeout(autosave, 600); return; }
    if (!dirty) return;
    try { await save(); } catch (err) { status.textContent = 'Not saved'; toast(`Couldn't save: ${err.message}`); }
  }
  async function save() {
    if (saving) return saving.then(() => (dirty ? save() : null));
    clearTimeout(saveTimer);
    graph.view = view;
    const sent = JSON.stringify(graph);
    status.textContent = 'Saving…';
    saving = api.patch(`/api/servers/${server.id}/bots/${bot.id}`, { program: compile(graph), graph: JSON.parse(sent) })
      .finally(() => { saving = null; });
    const updated = await saving;
    bot.program = updated.program;
    bot.graph = updated.graph;
    if (JSON.stringify(graph) === sent) {
      dirty = false;
      status.textContent = 'Saved';
      status.classList.remove('dirty');
    }
  }

  // --- view: pan and zoom ---
  function applyView() {
    world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`;
    zoomLabel.textContent = `${Math.round(view.zoom * 100)}%`;
  }
  function zoomAt(factor, cx, cy) {
    const zoom = Math.min(1.5, Math.max(0.3, view.zoom * factor));
    const k = zoom / view.zoom;
    view.x = cx - (cx - view.x) * k;
    view.y = cy - (cy - view.y) * k;
    view.zoom = zoom;
    applyView();
  }
  function zoomBy(factor) {
    const box = viewport.getBoundingClientRect();
    zoomAt(factor, box.width / 2, box.height / 2);
  }
  function fit() {
    const els = [...world.querySelectorAll('.nb-node')];
    if (!els.length) { view = { x: 40, y: 40, zoom: 1 }; applyView(); return; }
    const minX = Math.min(...els.map((el) => el.offsetLeft));
    const minY = Math.min(...els.map((el) => el.offsetTop));
    const maxX = Math.max(...els.map((el) => el.offsetLeft + el.offsetWidth));
    const maxY = Math.max(...els.map((el) => el.offsetTop + el.offsetHeight));
    const box = viewport.getBoundingClientRect();
    // Readable first: never smaller than 60%, so a big bot starts at its top left instead of as specks.
    const zoom = Math.min(1, Math.max(0.6, Math.min((box.width - 120) / (maxX - minX), (box.height - 140) / (maxY - minY))));
    view = { zoom, x: 60 - minX * zoom, y: 40 - minY * zoom };
    applyView();
  }
  const toWorld = (clientX, clientY) => {
    const box = viewport.getBoundingClientRect();
    return { x: (clientX - box.left - view.x) / view.zoom, y: (clientY - box.top - view.y) / view.zoom };
  };
  viewport.addEventListener('wheel', (event) => {
    if (event.target.closest('textarea, select') && !event.ctrlKey) return;
    event.preventDefault();
    const box = viewport.getBoundingClientRect();
    if (event.ctrlKey || event.metaKey) zoomAt(Math.exp(-event.deltaY * 0.0025), event.clientX - box.left, event.clientY - box.top);
    else { view.x -= event.deltaX; view.y -= event.deltaY; applyView(); }
  }, { passive: false });

  // --- the fields inside a node ---
  const knownNames = (kind) => {
    const out = new Set(kind === 'list' ? ['my list'] : ['my variable']);
    for (const n of graph.nodes) for (const p of defOf(n)?.inputs || []) if (p.kind === kind && n.data[p.key]) out.add(n.data[p.key]);
    return [...out].sort();
  };
  const listIds = { role: `nb-roles-${bot.id}`, var: `nb-var-${bot.id}`, list: `nb-list-${bot.id}` };
  const datalists = h('div', { hidden: true });
  function fillDatalists() {
    datalists.replaceChildren(
      h('datalist', { id: listIds.role }, (server.roles || []).filter((r) => !r.admin).map((r) => h('option', { value: r.name }))),
      h('datalist', { id: listIds.var }, knownNames('var').map((n) => h('option', { value: n }))),
      h('datalist', { id: listIds.list }, knownNames('list').map((n) => h('option', { value: n }))));
  }
  stage.append(datalists);

  function control(node, part) {
    const def = defOf(node);
    const v = node.data[part.key];
    // Typing saves without redrawing (so the box keeps focus); changes that alter the node's shape redraw it.
    const set = (value) => { node.data[part.key] = value; changed({ redraw: false }); };
    const reshape = () => { redrawNode(node); changed({ redraw: false }); };
    const wire = isSlot(part) && wireInto(node.id, part.key);
    if (wire) {
      const from = byId(wire.from);
      return h('div', { class: 'nb-wired' }, icon('link', 13), h('span', {}, defOf(from).title),
        h('button', { type: 'button', class: 'nb-mini', title: 'Unplug', onclick: () => removeWire(wire.id) }, icon('x', 13)));
    }
    const plug = isSlot(part) && h('button', {
      type: 'button', class: 'nb-mini nb-plug', title: part.kind === 'bool' ? 'Add a true/false check' : 'Use a value instead (their name, a variable, maths…)',
      onclick: (e) => openPicker(e.currentTarget.getBoundingClientRect(), { to: node.id, in: part.key, bool: part.kind === 'bool', at: { x: node.x - 300, y: node.y } }),
    }, icon(part.kind === 'bool' ? 'plus' : 'link', 13));
    let el;
    switch (part.kind) {
      case 'bool':
        el = h('button', { type: 'button', class: 'nb-input nb-ghost', onclick: (e) => plug.click(e) }, 'Add a check…');
        break;
      case 'select':
        el = h('select', { class: 'nb-input', onchange: (e) => { node.data[part.key] = e.target.value; reshape(); } }, part.options.map(([val, label]) => h('option', { value: val, selected: v === val }, label)));
        break;
      case 'channel':
      case 'voice': {
        const list = part.kind === 'voice' ? voiceChannels : textChannels;
        el = h('select', { class: 'nb-input', onchange: (e) => set(e.target.value) },
          h('option', { value: '', selected: !v }, part.here ? 'This channel' : 'Pick a channel'),
          list.map((c) => h('option', { value: c.id, selected: v === c.id }, `${part.kind === 'voice' ? '🔊 ' : '#'}${c.name}`)));
        break;
      }
      case 'lines':
        el = h('textarea', {
          class: 'nb-input', rows: 3, value: (v || []).join('\n'), placeholder: part.placeholder || 'One per line',
          oninput: (e) => set(e.target.value.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 25)),
          onchange: () => { if (node.def === 'commands') reshape(); },
        });
        break;
      case 'color':
        el = h('input', { class: 'nb-input nb-color', type: 'color', value: v || '#a99bf0', oninput: (e) => set(e.target.value) });
        break;
      case 'secret':
        el = h('input', { class: 'nb-input', type: 'password', autocomplete: 'off', value: v ?? '', placeholder: 'Paste the key', oninput: (e) => set(e.target.value) });
        break;
      case 'number':
        el = h('input', { class: 'nb-input', type: 'number', value: v ?? '', oninput: (e) => set(e.target.value === '' ? '' : Number(e.target.value)) });
        break;
      case 'var':
      case 'list':
      case 'role':
        el = h('input', { class: 'nb-input', value: v ?? '', list: listIds[part.kind], placeholder: part.kind === 'role' ? 'Role name' : part.kind === 'list' ? 'List name' : 'Variable name', onfocus: fillDatalists, oninput: (e) => set(e.target.value) });
        break;
      default:
        el = isLong(def, part)
          ? h('textarea', { class: 'nb-input', rows: 2, value: v ?? '', placeholder: part.placeholder || '', oninput: (e) => set(e.target.value) })
          : h('input', { class: 'nb-input', value: v ?? '', placeholder: part.placeholder || '', oninput: (e) => set(e.target.value) });
    }
    return plug ? h('div', { class: 'nb-input-wrap' }, el, plug) : el;
  }

  // --- drawing nodes ---
  const nodeEls = new Map();
  // An output: a small dot on the card's edge once it's wired; before that, a + you can click (to pick what
  // comes next) or drag (to wire it to a node that's already there).
  const outPort = (node, key) => {
    const free = !wireFrom(node.id, key);
    return h('span', { class: `nb-port out exec${free ? ' free' : ''}`, dataset: { port: key }, title: free ? 'Add what happens next (or drag to a node)' : 'Drag to rewire' },
      free && icon('plus', 12));
  };
  function nodeEl(node) {
    const def = defOf(node);
    const outs = def.outs(node);
    const mainOut = outs.length === 1 && !outs[0].label ? outs[0] : null;
    const fields = def.inputs.filter((p) => !p.hideWhen?.(node.data));
    const menu = (event) => showMenu(event, [
      { label: node.off ? 'Turn on' : 'Turn off', icon: 'eye', onClick: () => { node.off = !node.off; changed(); } },
      { label: 'Duplicate', icon: 'copy', onClick: () => duplicate(node) },
      '-',
      { label: 'Delete', icon: 'trash', danger: true, onClick: () => removeNode(node.id) },
    ]);
    const el = h('div', {
      class: `nb-node ${def.kind}${node.id === selected ? ' selected' : ''}${node.off ? ' off' : ''}${locked(def) ? ' locked' : ''}`,
      style: { left: `${node.x}px`, top: `${node.y}px` },
      dataset: { id: node.id },
      oncontextmenu: menu,
    },
    h('div', { class: 'nb-head' },
      def.kind === 'action' && h('span', { class: 'nb-port in exec', dataset: { port: 'exec' } }),
      h('span', { class: 'nb-icon' }, icon(locked(def) ? 'lock' : ICONS[def.category] || 'bot', 15)),
      h('span', { class: 'nb-title' }, def.title),
      node.off && h('span', { class: 'nb-kind' }, 'Off'),
      h('button', { type: 'button', class: 'nb-mini', title: 'More', onclick: menu }, icon('more', 15)),
      mainOut && outPort(node, mainOut.key),
      def.kind === 'value' && h('span', { class: `nb-port out value${def.bool ? ' bool' : ''}`, dataset: { port: 'value' }, title: 'Drag onto a field of another node' }),
      ),
    fields.length > 0 && h('div', { class: 'nb-fields' }, fields.map((p) => h('div', { class: 'nb-field' },
      isSlot(p) && h('span', { class: `nb-port in value${p.kind === 'bool' ? ' bool' : ''}`, dataset: { port: p.key } }),
      h('span', { class: 'nb-label' }, p.label || LABELS[p.key] || p.key),
      control(node, p)))),
    !mainOut && outs.length > 0 && h('div', { class: 'nb-outs' }, outs.map((o) => h('div', { class: 'nb-out' },
      h('span', {}, o.label || 'next'),
      outPort(node, o.key)))));
    return el;
  }
  // Wires follow nodes as they grow (typing in a box, more commands).
  let wireFrame = 0;
  const sizes = new ResizeObserver(() => {
    cancelAnimationFrame(wireFrame);
    wireFrame = requestAnimationFrame(() => drawWires());
  });
  function redrawNode(node) {
    const old = nodeEls.get(node.id);
    if (!old) return;
    const fresh = nodeEl(node);
    old.replaceWith(fresh);
    sizes.unobserve(old);
    sizes.observe(fresh);
    nodeEls.set(node.id, fresh);
    drawWires();
  }
  function draw() {
    for (const el of world.querySelectorAll('.nb-node')) { sizes.unobserve(el); el.remove(); }
    nodeEls.clear();
    for (const node of graph.nodes) {
      if (!defOf(node)) continue;
      const el = nodeEl(node);
      nodeEls.set(node.id, el);
      world.append(el);
      sizes.observe(el);
    }
    empty.hidden = graph.nodes.length > 0;
    applyView();
    drawWires();
  }

  // --- wires ---
  function portAt(nodeId, port, dir) {
    const dot = nodeEls.get(nodeId)?.querySelector(`.nb-port.${dir}[data-port="${CSS.escape(port)}"]`);
    if (!dot) return null;
    const box = dot.getBoundingClientRect();
    return toWorld(box.left + box.width / 2, box.top + box.height / 2);
  }
  const curve = (a, b) => {
    const dx = Math.max(50, Math.abs(b.x - a.x) * 0.5);
    return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
  };
  function drawWires(temp) {
    wires.replaceChildren();
    for (const edge of graph.edges) {
      const a = portAt(edge.from, edge.out, 'out');
      const b = portAt(edge.to, edge.in, 'in');
      if (!a || !b) continue;
      const d = curve(a, b);
      const g = document.createElementNS(NS, 'g');
      g.classList.add('nb-wire');
      if (edge.in !== 'exec') g.classList.add('value');
      if (edge.id === selectedWire) g.classList.add('selected');
      const hit = document.createElementNS(NS, 'path');
      hit.setAttribute('d', d);
      hit.classList.add('hit');
      hit.addEventListener('pointerdown', (event) => { event.stopPropagation(); selectedWire = edge.id; selected = null; markSelection(); drawWires(); });
      const line = document.createElementNS(NS, 'path');
      line.setAttribute('d', d);
      line.classList.add('line');
      g.append(hit, line);
      if (edge.id === selectedWire) {
        const x = document.createElementNS(NS, 'g');
        x.classList.add('nb-wire-x');
        x.setAttribute('transform', `translate(${(a.x + b.x) / 2} ${(a.y + b.y) / 2})`);
        x.innerHTML = '<circle r="10"></circle><path d="M -3.5 -3.5 L 3.5 3.5 M 3.5 -3.5 L -3.5 3.5"></path>';
        x.addEventListener('pointerdown', (event) => { event.stopPropagation(); removeWire(edge.id); });
        g.append(x);
      }
      wires.append(g);
    }
    if (temp) {
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('d', temp.reverse ? curve(temp.b, temp.a) : curve(temp.a, temp.b));
      p.classList.add('nb-temp');
      wires.append(p);
    }
  }
  function removeWire(id) {
    graph.edges = graph.edges.filter((e) => e.id !== id);
    selectedWire = null;
    changed();
  }
  function canWire(fromId, out, toId, key) {
    if (fromId === toId) return false;
    const from = byId(fromId);
    const to = byId(toId);
    if (!from || !to) return false;
    const fd = defOf(from);
    const td = defOf(to);
    if (key === 'exec') return out !== 'value' && td.kind === 'action';
    if (out !== 'value' || fd.kind !== 'value') return false;
    const part = td.inputs.find((p) => p.key === key);
    if (!part || !isSlot(part)) return false;
    if (part.kind === 'bool' && !fd.bool) return false;
    const feeds = (id, seen = new Set()) => {
      if (id === toId) return true;
      if (seen.has(id)) return false;
      seen.add(id);
      return graph.edges.filter((e) => e.to === id && e.in !== 'exec').some((e) => feeds(e.from, seen));
    };
    return !feeds(fromId);
  }
  function connect(fromId, out, toId, key) {
    if (!canWire(fromId, out, toId, key)) return false;
    graph.edges = graph.edges.filter((e) => !(key === 'exec' ? e.from === fromId && e.out === out : e.to === toId && e.in === key));
    graph.edges.push({ id: newId(), from: fromId, out, to: toId, in: key });
    return true;
  }

  // --- pointer: move nodes, pan, wire ---
  let dragging = null;
  viewport.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 && event.button !== 1) return;
    closePicker();
    const port = event.target.closest('.nb-port');
    const nodeHit = event.target.closest('.nb-node');
    if (!port && event.target.closest('input, textarea, select, button')) {
      if (nodeHit && selected !== nodeHit.dataset.id) { selected = nodeHit.dataset.id; selectedWire = null; markSelection(); }
      return;
    }
    const start = { x: event.clientX, y: event.clientY };
    viewport.focus({ preventScroll: true });
    if (port && nodeHit) {
      event.preventDefault();
      const id = nodeHit.dataset.id;
      const key = port.dataset.port;
      if (port.classList.contains('out')) dragging = { kind: 'wire', from: id, out: key, a: portAt(id, key, 'out'), start, free: port.classList.contains('free'), rect: port.getBoundingClientRect() };
      else {
        const edge = wireInto(id, key);
        if (edge) {
          graph.edges = graph.edges.filter((e) => e !== edge);
          dragging = { kind: 'wire', from: edge.from, out: edge.out, a: portAt(edge.from, edge.out, 'out'), lifted: true };
        } else dragging = { kind: 'wire-back', to: id, in: key, a: portAt(id, key, 'in') };
      }
      viewport.setPointerCapture(event.pointerId);
      return;
    }
    if (nodeHit) {
      const id = nodeHit.dataset.id;
      if (selected !== id || selectedWire) { selected = id; selectedWire = null; markSelection(); drawWires(); }
      const node = byId(id);
      dragging = { kind: 'node', node, el: nodeHit, ox: node.x, oy: node.y, start, moved: false };
      viewport.setPointerCapture(event.pointerId);
      return;
    }
    if (selected || selectedWire) { selected = null; selectedWire = null; markSelection(); drawWires(); }
    dragging = { kind: 'pan', start, vx: view.x, vy: view.y };
    viewport.classList.add('panning');
    viewport.setPointerCapture(event.pointerId);
  });
  viewport.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    if (dragging.kind === 'pan') {
      view.x = dragging.vx + event.clientX - dragging.start.x;
      view.y = dragging.vy + event.clientY - dragging.start.y;
      applyView();
    } else if (dragging.kind === 'node') {
      const dx = (event.clientX - dragging.start.x) / view.zoom;
      const dy = (event.clientY - dragging.start.y) / view.zoom;
      if (Math.abs(dx) + Math.abs(dy) > 2) dragging.moved = true;
      dragging.node.x = Math.round((dragging.ox + dx) / 10) * 10;
      dragging.node.y = Math.round((dragging.oy + dy) / 10) * 10;
      dragging.el.style.left = `${dragging.node.x}px`;
      dragging.el.style.top = `${dragging.node.y}px`;
      drawWires();
    } else {
      markTargets(event);
      drawWires({ a: dragging.a, b: toWorld(event.clientX, event.clientY), reverse: dragging.kind === 'wire-back' });
    }
  });
  const finish = (event) => {
    if (!dragging) return;
    const d = dragging;
    dragging = null;
    viewport.classList.remove('panning');
    for (const el of world.querySelectorAll('.nb-port.ok')) el.classList.remove('ok');
    if (d.kind === 'pan') return;
    if (d.kind === 'node') { if (d.moved) changed({ redraw: false }); return; }
    const under = document.elementFromPoint(event.clientX, event.clientY);
    const port = under?.closest?.('.nb-port');
    const target = under?.closest?.('.nb-node');
    // A click (no drag) on a free output opens the list of what can come next.
    if (d.kind === 'wire' && d.free && Math.hypot(event.clientX - d.start.x, event.clientY - d.start.y) < 5) {
      const node = byId(d.from);
      openPicker(d.rect, { from: d.from, out: d.out, at: { x: node.x + 340, y: node.y } });
      return;
    }
    if (d.kind === 'wire') {
      if (port && target && port.classList.contains('in') && connect(d.from, d.out, target.dataset.id, port.dataset.port)) return changed();
      if (target && !port) {
        // Dropped on a node: its "runs after" input, or the field under the pointer, or its first free field.
        const to = byId(target.dataset.id);
        const fieldKey = under.closest('.nb-field')?.querySelector('.nb-port')?.dataset.port;
        const keys = d.out === 'value' ? [fieldKey, ...defOf(to).inputs.filter(isSlot).map((p) => p.key)].filter(Boolean) : ['exec'];
        const free = keys.find((k) => k === fieldKey && canWire(d.from, d.out, to.id, k))
          || keys.find((k) => !wireInto(to.id, k) && canWire(d.from, d.out, to.id, k));
        if (free && connect(d.from, d.out, to.id, free)) return changed();
      }
      if (!target && d.out !== 'value' && !d.lifted) {
        const at = toWorld(event.clientX, event.clientY);
        openPicker({ left: event.clientX, top: event.clientY }, { from: d.from, out: d.out, at: { x: at.x + 10, y: at.y - 20 } });
        return;
      }
      if (d.lifted) return changed();
      drawWires();
    } else {
      if (port && target && port.classList.contains('out') && connect(target.dataset.id, port.dataset.port, d.to, d.in)) return changed();
      if (!target && d.in !== 'exec') {
        const at = toWorld(event.clientX, event.clientY);
        const part = defOf(byId(d.to)).inputs.find((p) => p.key === d.in);
        openPicker({ left: event.clientX, top: event.clientY }, { to: d.to, in: d.in, bool: part?.kind === 'bool', at: { x: at.x - 240, y: at.y - 20 } });
        return;
      }
      drawWires();
    }
  };
  viewport.addEventListener('pointerup', finish);
  viewport.addEventListener('pointercancel', finish);
  viewport.addEventListener('dblclick', (event) => {
    if (event.target.closest('.nb-node')) return;
    openPicker({ left: event.clientX, top: event.clientY }, { at: toWorld(event.clientX, event.clientY) });
  });
  viewport.addEventListener('contextmenu', (event) => {
    if (event.target.closest('.nb-node')) return;
    const at = toWorld(event.clientX, event.clientY);
    showMenu(event, [
      { label: 'Add node here', icon: 'plus', onClick: () => openPicker({ left: event.clientX, top: event.clientY }, { at }) },
      { label: 'Paste', icon: 'copy', onClick: () => paste(at) },
      { label: 'Fit everything', icon: 'search', onClick: fit },
    ]);
  });

  function markTargets(event) {
    for (const el of world.querySelectorAll('.nb-port.ok')) el.classList.remove('ok');
    const port = document.elementFromPoint(event.clientX, event.clientY)?.closest?.('.nb-port');
    const target = port?.closest('.nb-node');
    if (!port || !target) return;
    const d = dragging;
    const ok = d.kind === 'wire'
      ? port.classList.contains('in') && canWire(d.from, d.out, target.dataset.id, port.dataset.port)
      : port.classList.contains('out') && canWire(target.dataset.id, port.dataset.port, d.to, d.in);
    if (ok) port.classList.add('ok');
  }
  function markSelection() {
    for (const [id, el] of nodeEls) el.classList.toggle('selected', id === selected);
  }

  // --- adding, removing, copying ---
  function addNode(defId, at, wire = {}) {
    const def = DEFS[defId];
    if (!def) return null;
    if (locked(def)) { toast('Turn on Admin (top right) to use admin and role nodes.'); return null; }
    const node = { id: newId(), def: defId, x: Math.round(at.x / 10) * 10, y: Math.round(at.y / 10) * 10, data: def.make() };
    // Don't land on top of another node.
    while (graph.nodes.some((n) => Math.abs(n.x - node.x) < 40 && Math.abs(n.y - node.y) < 40)) { node.x += 30; node.y += 30; }
    graph.nodes.push(node);
    if (wire.from) connect(wire.from, wire.out, node.id, 'exec');
    if (wire.to) connect(node.id, 'value', wire.to, wire.in);
    selected = node.id;
    selectedWire = null;
    changed();
    requestAnimationFrame(() => {
      const el = nodeEls.get(node.id);
      if (!el) return;
      // Bring it into view if it landed off screen, then put the cursor in its first box, ready to type.
      const box = viewport.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      if (r.right > box.right - 24) view.x -= r.right - box.right + 60;
      if (r.bottom > box.bottom - 80) view.y -= r.bottom - box.bottom + 100;
      if (r.left < box.left + 24) view.x += box.left - r.left + 60;
      if (r.top < box.top + 24) view.y += box.top - r.top + 60;
      applyView();
      drawWires();
      el.querySelector('input:not([type=color]), textarea')?.focus({ preventScroll: true });
    });
    return node;
  }
  function centre() {
    const box = viewport.getBoundingClientRect();
    return toWorld(box.left + box.width * 0.4, box.top + box.height * 0.3);
  }
  function removeNode(id) {
    graph.nodes = graph.nodes.filter((n) => n.id !== id);
    graph.edges = graph.edges.filter((e) => e.from !== id && e.to !== id);
    if (selected === id) selected = null;
    changed();
  }
  function duplicate(node) {
    const copy = { ...clone(node), id: newId(), x: node.x + 40, y: node.y + 40 };
    graph.nodes.push(copy);
    for (const e of graph.edges.filter((w) => w.to === node.id && w.in !== 'exec')) graph.edges.push({ ...e, id: newId(), to: copy.id });
    selected = copy.id;
    changed();
  }
  function paste(at = centre()) {
    let clip = null;
    try { clip = JSON.parse(localStorage.getItem(CLIP_KEY) || 'null'); } catch { /* storage off */ }
    if (!clip?.def || !DEFS[clip.def]) return;
    graph.nodes.push({ ...clip, id: newId(), x: Math.round(at.x), y: Math.round(at.y) });
    selected = graph.nodes.at(-1).id;
    changed();
  }

  // --- the node list (left column) and the quick picker ---
  function library(filter, { onPick, kinds, bool } = {}) {
    const q = filter.trim().toLowerCase();
    const groups = [];
    for (const [kind, label] of [['trigger', 'Triggers'], ['action', 'Actions'], ['value', 'Values']]) {
      if (kinds && !kinds.includes(kind)) continue;
      const items = Object.values(DEFS).filter((d) => d.kind === kind && !d.legacy && (!bool || d.bool)
        && (!q || `${d.title} ${d.category} ${d.parts.filter((p) => typeof p === 'string').join(' ')}`.toLowerCase().includes(q)));
      if (!items.length) continue;
      const ordered = CATEGORIES.flatMap((c) => items.filter((d) => d.category === c.id));
      groups.push(h('div', { class: 'nb-lib-group' },
        h('div', { class: 'sidebar-heading' }, label),
        ordered.map((def) => h('button', {
          type: 'button', class: `nb-lib-item${locked(def) ? ' locked' : ''}`, draggable: !onPick,
          title: locked(def) ? 'Turn on Admin to use this' : def.parts.map((p) => (typeof p === 'string' ? p : '…')).join(' '),
          onclick: () => (onPick ? onPick(def.id) : addNode(def.id, centre())),
          ondragstart: (e) => { e.dataTransfer.setData('text/x-node', def.id); e.dataTransfer.effectAllowed = 'copy'; },
        }, h('span', { class: 'nb-icon' }, icon(locked(def) ? 'lock' : ICONS[def.category] || 'bot', 14)), h('span', { class: 'nb-lib-name' }, def.title)))));
    }
    return groups.length ? groups : [h('p', { class: 'field-hint nb-lib-none' }, 'No nodes match.')];
  }
  viewport.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('text/x-node')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
  viewport.addEventListener('drop', (e) => {
    const id = e.dataTransfer.getData('text/x-node');
    if (!id) return;
    e.preventDefault();
    const at = toWorld(e.clientX, e.clientY);
    addNode(id, { x: at.x - 130, y: at.y - 20 });
  });
  const search = h('input', { class: 'input nb-search', type: 'search', placeholder: 'Search nodes', oninput: () => drawLibrary() });
  const libList = h('div', { class: 'sidebar-scroll nb-lib' });
  const drawLibrary = () => libList.replaceChildren(...library(search.value));
  const side = h('div', { class: 'bb-side nb-side' }, h('div', { class: 'nb-search-wrap' }, search), libList);

  // `wire`: { from, out } adds what runs next; { to, in, bool } adds a value for a field; { kinds } limits the list.
  function openPicker(at, wire = {}) {
    const kinds = wire.kinds || (wire.to ? ['value'] : wire.from ? ['action'] : null);
    const input = h('input', { class: 'input', type: 'search', placeholder: wire.from ? 'What happens next?' : wire.to ? (wire.bool ? 'Which check?' : 'Which value?') : 'Search nodes' });
    const list = h('div', { class: 'nb-picker-list' });
    const fill = () => list.replaceChildren(...library(input.value, {
      kinds, bool: wire.bool,
      onPick: (id) => { closePicker(); addNode(id, wire.at || (at.left != null && at.width == null ? toWorld(at.left, at.top) : centre()), wire); },
    }));
    input.addEventListener('input', fill);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closePicker();
      if (e.key === 'Enter') list.querySelector('.nb-lib-item:not(.locked)')?.click();
    });
    fill();
    picker.replaceChildren(input, list);
    const box = stage.getBoundingClientRect();
    picker.style.left = `${Math.min(Math.max(8, at.left - box.left), box.width - 300)}px`;
    picker.style.top = `${Math.min(Math.max(8, (at.bottom ?? at.top) - box.top + 4), box.height - 380)}px`;
    picker.hidden = false;
    input.focus();
  }
  function closePicker() {
    if (picker.hidden) return;
    picker.hidden = true;
    drawWires();
  }
  document.addEventListener('pointerdown', (e) => { if (!picker.hidden && !picker.contains(e.target) && !stage.contains(e.target)) closePicker(); });

  // --- keys ---
  const keys = (event) => {
    if (!stage.isConnected) return;
    const mod = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    if (mod && key === 's') { event.preventDefault(); attempt(save); return; }
    if (event.target.closest?.('input, textarea, select, [contenteditable]')) return;
    if (!stage.contains(document.activeElement) && document.activeElement !== document.body) return;
    if (mod && key === 'z') { event.preventDefault(); if (event.shiftKey) redo(); else undo(); return; }
    if (mod && key === 'y') { event.preventDefault(); redo(); return; }
    if (mod && key === 'v') { event.preventDefault(); paste(); return; }
    if (key === 'escape') { closePicker(); selected = null; selectedWire = null; markSelection(); drawWires(); return; }
    const node = selected && byId(selected);
    if (mod && key === 'c' && node) { event.preventDefault(); try { localStorage.setItem(CLIP_KEY, JSON.stringify(node)); } catch { /* storage off */ } return; }
    if (mod && key === 'd' && node) { event.preventDefault(); duplicate(node); return; }
    if (key === 'delete' || key === 'backspace') {
      if (selectedWire) { event.preventDefault(); removeWire(selectedWire); } else if (node) { event.preventDefault(); removeNode(node.id); }
    }
  };
  window.addEventListener('keydown', keys);

  // --- Admin ---
  const adminSwitch = switchControl(admin, (on) => attempt(async () => {
    try {
      const updated = await api.patch(`/api/servers/${server.id}/bots/${bot.id}`, { admin: on });
      admin = updated.admin;
      bot.admin = admin;
      drawLibrary();
      draw();
      toast(admin ? `${bot.user.displayName} is an admin now. Admin nodes are unlocked.` : `${bot.user.displayName} is no longer an admin.`, 'ok');
    } catch (err) {
      adminSwitch.classList.toggle('on', admin);
      adminSwitch.setAttribute('aria-checked', String(admin));
      throw err;
    }
  }), 'Admin');
  const adminToggle = h('label', { class: 'bot-ws-toggle', title: 'Lets the bot use admin and role nodes' }, adminSwitch, 'Admin');
  drawLibrary();
  fillDatalists();

  let first = true;
  return {
    side,
    stage,
    status,
    adminToggle,
    mounted() {
      draw();
      requestAnimationFrame(() => {
        drawWires();
        if (first && !bot.graph?.view) fit();
        first = false;
      });
    },
    flush: () => (dirty ? save() : Promise.resolve()),
  };
}
