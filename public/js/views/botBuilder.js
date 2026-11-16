// The bot builder: drag blocks from the palette onto the canvas and snap them together, like Scratch.
// A program is a list of scripts { trigger, blocks, x, y }; blocks can hold more blocks (`do`, `else`).
// Programs are plain data; the server checks them and runs them with hard limits (server/lib/bots.js).
import * as api from '../api.js';
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { attempt, button, toast } from '../ui.js';
import { openPage } from './page.js';
import { colorField } from '../colorPicker.js';
import { aiPanel } from './botAi.js';

// --- block definitions ---
// Each part of `parts` is a word, or a field: { key, kind: 'text' | 'number' | 'select' | 'lines' | 'channel', … }.

const CATEGORIES = [
  { id: 'events', label: 'Events', colors: ['#ffbf00', '#e6ac00', '#cc9900'] },
  { id: 'messages', label: 'Messages', colors: ['#9966ff', '#855cd6', '#774dcb'] },
  { id: 'ai', label: 'AI', colors: ['#5b6ee1', '#4c5fd4', '#3c4cb8'] },
  { id: 'control', label: 'Control', colors: ['#ffab19', '#ec9c13', '#cf8b17'] },
  { id: 'voice', label: 'Voice', colors: ['#cf63cf', '#c94fc9', '#bd42bd'] },
  { id: 'variables', label: 'Variables', colors: ['#ff8c1a', '#ff8000', '#db6e00'] },
  { id: 'data', label: 'Data & web', colors: ['#4cb4d8', '#3ea6ca', '#2f8db0'] },
  { id: 'admin', label: 'Admin', colors: ['#ff6680', '#ff4d6a', '#ff3355'], admin: true },
  { id: 'roles', label: 'Roles', colors: ['#0fbd8c', '#0da57a', '#0b8e69'], admin: true },
  { id: 'values', label: 'Values', colors: ['#59c059', '#46b946', '#389438'] },
];
const TARGET = [['person', 'the person'], ['mentioned', 'the mentioned person']];

const MATCH = [['contains', 'contains'], ['starts', 'starts with'], ['equals', 'is exactly'], ['any', 'is anything']];
const OPS = [['equals', '='], ['not', '≠'], ['contains', 'contains'], ['starts', 'starts with'], ['greater', '>'], ['less', '<'],
  ['has_role', 'person has role'], ['not_role', 'person lacks role']];
const MATH = [['+', '+'], ['-', '−'], ['*', '×'], ['/', '÷'], ['%', 'remainder'], ['min', 'smaller of'], ['max', 'bigger of'], ['round', 'rounded']];
const CASES = [['upper', 'UPPERCASE'], ['lower', 'lowercase'], ['length', 'the length'], ['reverse', 'reversed'], ['trim', 'trimmed']];

const BLOCKS = {
  // triggers ("hats")
  message: { hat: true, category: 'events', parts: ['when a message', { key: 'match', kind: 'select', options: MATCH }, { key: 'text', kind: 'text', placeholder: 'hello', hideWhen: (b) => b.match === 'any' }], make: () => ({ type: 'message', match: 'contains', text: 'hello' }) },
  command: { hat: true, category: 'events', parts: ['when someone types /', { key: 'name', kind: 'text', placeholder: 'ping', width: 6 }, 'described as', { key: 'description', kind: 'text', placeholder: 'shown in the / list' }], make: () => ({ type: 'command', name: 'ping', description: '' }) },
  button: { hat: true, category: 'events', parts: ['when the button', { key: 'text', kind: 'text', placeholder: 'any button' }, 'is clicked'], make: () => ({ type: 'button', text: '' }) },
  reaction: { hat: true, category: 'events', parts: ['when someone reacts with', { key: 'emoji', kind: 'text', placeholder: 'any emoji', width: 6 }], make: () => ({ type: 'reaction', emoji: '' }) },
  menu: { hat: true, category: 'events', parts: ['when someone picks', { key: 'text', kind: 'text', placeholder: 'anything' }, 'from a menu'], make: () => ({ type: 'menu', text: '' }) },
  leave: { hat: true, category: 'events', parts: ['when someone leaves the server'], make: () => ({ type: 'leave' }) },
  join: { hat: true, category: 'events', parts: ['when someone joins the server'], make: () => ({ type: 'join' }) },
  timer: { hat: true, category: 'events', parts: ['every', { key: 'minutes', kind: 'number', width: 3 }, 'minutes in', { key: 'channel', kind: 'channel' }], make: () => ({ type: 'timer', minutes: 60, channel: '' }) },

  // AI: tools the model can call (the blocks under the hat run), and blocks that use the model
  tool: { hat: true, category: 'ai', parts: ['the AI can use the tool', { key: 'name', kind: 'text', placeholder: 'roll_dice', width: 8 }, 'to', { key: 'description', kind: 'text', placeholder: 'what it does, for the AI' }, 'given', { key: 'options', kind: 'lines', placeholder: 'one per line, like\ncity: the city name\ndays (number): how many\nunits?: optional' }], make: () => ({ type: 'tool', name: 'roll_dice', description: 'Roll a dice for someone', options: ['sides (number): how many sides the dice has'] }) },
  ai_message: { hat: true, category: 'ai', parts: ['when someone talks to me'], make: () => ({ type: 'ai_message' }) },
  ai_reply: { category: 'ai', parts: ['answer them with AI, also told', { key: 'text', kind: 'text', placeholder: 'nothing extra' }], make: () => ({ type: 'ai_reply', text: '' }) },
  ai_ask: { category: 'ai', parts: ['ask the AI', { key: 'text', kind: 'text', placeholder: 'Write a haiku about {args}' }, { key: 'mode', kind: 'select', options: [['plain', 'without tools'], ['tools', 'with tools']] }, 'and keep the answer in', { key: 'name', kind: 'text', placeholder: 'answer', width: 6 }], make: () => ({ type: 'ai_ask', text: 'Write a haiku about {args}', mode: 'plain', name: 'answer' }) },
  ai_tell: { category: 'ai', parts: ['tell the AI', { key: 'text', kind: 'text', placeholder: 'Rolled {var.roll}' }], make: () => ({ type: 'ai_tell', text: 'Rolled {var.roll}' }) },
  ai_instructions: { category: 'ai', parts: ['add AI instructions', { key: 'text', kind: 'text', placeholder: 'Talk like a pirate' }], make: () => ({ type: 'ai_instructions', text: 'Talk like a pirate.' }) },
  ai_model: { category: 'ai', parts: ['use the model', { key: 'value', kind: 'text', placeholder: 'model id', width: 10 }], make: () => ({ type: 'ai_model', value: '' }) },
  ai_remember: { category: 'ai', parts: ['AI: remember', { key: 'text', kind: 'text', placeholder: '{user} likes cats' }], make: () => ({ type: 'ai_remember', text: '{user} likes cats' }) },
  ai_forget: { category: 'ai', parts: ['AI: forget', { key: 'what', kind: 'select', options: [['chat', 'this conversation'], ['memory', 'everything it remembers']] }], make: () => ({ type: 'ai_forget', what: 'chat' }) },

  // messages
  send: { category: 'messages', parts: ['send', { key: 'text', kind: 'text', placeholder: 'Hi {user}!' }, 'in', { key: 'channel', kind: 'channel', here: true }], make: () => ({ type: 'send', text: 'Hi {user}!', channel: '' }) },
  reply: { category: 'messages', parts: ['reply', { key: 'text', kind: 'text', placeholder: 'Pong!' }], make: () => ({ type: 'reply', text: 'Pong!' }) },
  random: { category: 'messages', parts: ['send one of', { key: 'options', kind: 'lines', placeholder: 'one line per choice' }], make: () => ({ type: 'random', options: ['Heads', 'Tails'] }) },
  react: { category: 'messages', parts: ['react with', { key: 'emoji', kind: 'text', width: 4, placeholder: '👍' }], make: () => ({ type: 'react', emoji: '👍' }) },
  ping: { category: 'messages', parts: ['ping', { key: 'target', kind: 'select', options: TARGET }, 'and say', { key: 'text', kind: 'text', placeholder: 'hi!' }], make: () => ({ type: 'ping', target: 'person', text: 'hi!' }) },
  dm: { category: 'messages', parts: ['DM', { key: 'target', kind: 'select', options: TARGET }, { key: 'text', kind: 'text', placeholder: 'Welcome!' }], make: () => ({ type: 'dm', target: 'person', text: 'Welcome to {server}!' }) },
  pin: { category: 'messages', parts: ['pin the message'], make: () => ({ type: 'pin' }) },
  menu_send: { category: 'messages', parts: ['send', { key: 'text', kind: 'text', placeholder: 'Pick a game:' }, 'with a menu called', { key: 'name', kind: 'text', placeholder: 'Pick one', width: 8 }, 'of', { key: 'options', kind: 'lines', placeholder: 'one choice per line' }, 'in', { key: 'channel', kind: 'channel', here: true }], make: () => ({ type: 'menu_send', text: 'What should we play?', name: 'Pick a game', options: ['Minecraft', 'Among Us', 'Chess'], channel: '' }) },
  unpin: { category: 'messages', parts: ['unpin the message'], make: () => ({ type: 'unpin' }) },
  buttons: { category: 'messages', parts: ['send', { key: 'text', kind: 'text', placeholder: 'Pick one:' }, 'with buttons', { key: 'options', kind: 'lines', placeholder: 'one button per line' }, 'in', { key: 'channel', kind: 'channel', here: true }], make: () => ({ type: 'buttons', text: 'Pick a team:', options: ['Red', 'Blue'], channel: '' }) },

  // voice
  join_voice: { category: 'voice', parts: ['join voice channel', { key: 'channel', kind: 'voice' }], make: () => ({ type: 'join_voice', channel: '' }) },
  leave_voice: { category: 'voice', parts: ['leave voice'], make: () => ({ type: 'leave_voice' }) },

  // control
  wait: { category: 'control', parts: ['wait', { key: 'seconds', kind: 'number', width: 2 }, 'seconds'], make: () => ({ type: 'wait', seconds: 1 }) },
  if: { category: 'control', parts: ['if', { key: 'left', kind: 'text', placeholder: '{args}', width: 6 }, { key: 'op', kind: 'select', options: OPS }, { key: 'right', kind: 'text', placeholder: 'yes', width: 6 }], mouths: ['do', 'else'], make: () => ({ type: 'if', left: '{args}', op: 'equals', right: 'yes', do: [], else: [] }) },
  repeat: { category: 'control', parts: ['repeat', { key: 'times', kind: 'number', width: 2 }, 'times'], mouths: ['do'], make: () => ({ type: 'repeat', times: 3, do: [] }) },
  forever: { category: 'control', cap: true, parts: ['forever'], mouths: ['do'], make: () => ({ type: 'forever', do: [] }) },
  until: { category: 'control', parts: ['repeat until', { key: 'left', kind: 'text', placeholder: '{var.score}', width: 6 }, { key: 'op', kind: 'select', options: OPS }, { key: 'right', kind: 'text', placeholder: '10', width: 4 }], mouths: ['do'], make: () => ({ type: 'until', left: '{var.score}', op: 'greater', right: '10', do: [] }) },
  stop: { category: 'control', cap: true, parts: ['stop this script'], make: () => ({ type: 'stop' }) },

  // variables
  set: { category: 'variables', parts: ['set', { key: 'name', kind: 'text', placeholder: 'score', width: 5 }, 'to', { key: 'value', kind: 'text', placeholder: '0', width: 5 }], make: () => ({ type: 'set', name: 'score', value: '0' }) },
  invite: { category: 'admin', parts: ['make an invite into', { key: 'name', kind: 'text', placeholder: 'invite', width: 5 }], make: () => ({ type: 'invite', name: 'invite' }) },
  everyone: { category: 'admin', parts: ['ping @everyone', { key: 'text', kind: 'text', placeholder: 'news!' }, 'in', { key: 'channel', kind: 'channel', here: true }], make: () => ({ type: 'everyone', text: 'Big news!', channel: '' }) },
  delete: { category: 'admin', parts: ['delete the message'], make: () => ({ type: 'delete' }) },
  purge: { category: 'admin', parts: ['delete the last', { key: 'count', kind: 'number', width: 2 }, 'messages in', { key: 'channel', kind: 'channel', here: true }], make: () => ({ type: 'purge', count: 10, channel: '' }) },
  create_channel: { category: 'admin', parts: ['create', { key: 'kind', kind: 'select', options: [['text', 'text'], ['voice', 'voice']] }, 'channel', { key: 'name', kind: 'text', placeholder: 'new-channel' }], make: () => ({ type: 'create_channel', kind: 'text', name: '{arg1}' }) },
  delete_channel: { category: 'admin', parts: ['delete channel named', { key: 'name', kind: 'text', placeholder: 'old-channel' }], make: () => ({ type: 'delete_channel', name: '{arg1}' }) },
  rename_channel: { category: 'admin', parts: ['rename', { key: 'channel', kind: 'channel', here: true }, 'to', { key: 'name', kind: 'text', placeholder: 'new-name' }], make: () => ({ type: 'rename_channel', channel: '', name: '{args}' }) },
  topic: { category: 'admin', parts: ['set topic of', { key: 'channel', kind: 'channel', here: true }, 'to', { key: 'text', kind: 'text', placeholder: 'topic' }], make: () => ({ type: 'topic', channel: '', text: '{args}' }) },
  slowmode: { category: 'admin', parts: ['set slowmode in', { key: 'channel', kind: 'channel', here: true }, 'to', { key: 'slow', kind: 'number', width: 3 }, 'seconds'], make: () => ({ type: 'slowmode', channel: '', slow: 10 }) },
  lock: { category: 'admin', parts: [{ key: 'lock', kind: 'select', options: [['lock', 'lock'], ['unlock', 'unlock']] }, { key: 'channel', kind: 'channel', here: true }], make: () => ({ type: 'lock', lock: 'lock', channel: '' }) },
  kick: { category: 'admin', parts: ['kick', { key: 'target', kind: 'select', options: TARGET }, 'because', { key: 'reason', kind: 'text', placeholder: 'reason' }], make: () => ({ type: 'kick', target: 'mentioned', reason: '' }) },
  ban: { category: 'admin', parts: ['ban', { key: 'target', kind: 'select', options: TARGET }, 'because', { key: 'reason', kind: 'text', placeholder: 'reason' }], make: () => ({ type: 'ban', target: 'mentioned', reason: '' }) },
  timeout: { category: 'admin', parts: ['time out', { key: 'target', kind: 'select', options: TARGET }, 'for', { key: 'minutes', kind: 'number', width: 3 }, 'minutes'], make: () => ({ type: 'timeout', target: 'mentioned', minutes: 10 }) },
  untimeout: { category: 'admin', parts: ['remove timeout from', { key: 'target', kind: 'select', options: TARGET }], make: () => ({ type: 'untimeout', target: 'mentioned' }) },
  // roles (by name, so {arg1} works too; roles with admin powers are off limits)
  give_role: { category: 'roles', parts: ['give', { key: 'target', kind: 'select', options: TARGET }, 'the role', { key: 'role', kind: 'role' }], make: () => ({ type: 'give_role', target: 'person', role: '' }) },
  take_role: { category: 'roles', parts: ['take the role', { key: 'role', kind: 'role' }, 'from', { key: 'target', kind: 'select', options: TARGET }], make: () => ({ type: 'take_role', target: 'person', role: '' }) },
  toggle_role: { category: 'roles', parts: ['toggle the role', { key: 'role', kind: 'role' }, 'for', { key: 'target', kind: 'select', options: TARGET }], make: () => ({ type: 'toggle_role', target: 'person', role: '' }) },
  create_role: { category: 'roles', parts: ['create a role named', { key: 'role', kind: 'text', placeholder: 'Members' }, 'coloured', { key: 'color', kind: 'color' }], make: () => ({ type: 'create_role', role: '{arg1}', color: '#a99bf0' }) },
  rename_role: { category: 'roles', parts: ['rename role', { key: 'role', kind: 'role' }, 'to', { key: 'name', kind: 'text', placeholder: 'new name' }], make: () => ({ type: 'rename_role', role: '', name: '{args}' }) },
  color_role: { category: 'roles', parts: ['colour role', { key: 'role', kind: 'role' }, { key: 'color', kind: 'color' }], make: () => ({ type: 'color_role', role: '', color: '#8fc1d6' }) },
  delete_role: { category: 'roles', parts: ['delete the role', { key: 'role', kind: 'role' }], make: () => ({ type: 'delete_role', role: '' }) },
  // data & web
  http: { category: 'data', parts: ['get', { key: 'url', kind: 'text', placeholder: 'https://api.example.com/{arg1}' }, 'and keep', { key: 'field', kind: 'text', placeholder: 'all of it (or a.json.path)' }, 'in', { key: 'name', kind: 'text', placeholder: 'response', width: 6 }], make: () => ({ type: 'http', url: 'https://api.adviceslip.com/advice', field: 'slip.advice', name: 'advice' }) },
  math: { category: 'data', parts: ['set', { key: 'name', kind: 'text', placeholder: 'total', width: 5 }, 'to', { key: 'left', kind: 'text', placeholder: '{var.a}', width: 5 }, { key: 'math', kind: 'select', options: MATH }, { key: 'right', kind: 'text', placeholder: '2', width: 4 }], make: () => ({ type: 'math', name: 'total', left: '{var.score}', math: '*', right: '2' }) },
  random_number: { category: 'data', parts: ['set', { key: 'name', kind: 'text', placeholder: 'roll', width: 5 }, 'to a random number from', { key: 'min', kind: 'number', width: 3 }, 'to', { key: 'max', kind: 'number', width: 3 }], make: () => ({ type: 'random_number', name: 'roll', min: 1, max: 6 }) },
  text_case: { category: 'data', parts: ['set', { key: 'name', kind: 'text', placeholder: 'shout', width: 5 }, 'to', { key: 'textCase', kind: 'select', options: CASES }, 'of', { key: 'value', kind: 'text', placeholder: '{args}', width: 6 }], make: () => ({ type: 'text_case', name: 'shout', textCase: 'upper', value: '{args}' }) },
  list_add: { category: 'data', parts: ['add', { key: 'value', kind: 'text', placeholder: '{user}', width: 6 }, 'to list', { key: 'name', kind: 'text', placeholder: 'queue', width: 5 }], make: () => ({ type: 'list_add', value: '{user}', name: 'queue' }) },
  list_remove: { category: 'data', parts: ['remove', { key: 'value', kind: 'text', placeholder: '{user}', width: 6 }, 'from list', { key: 'name', kind: 'text', placeholder: 'queue', width: 5 }], make: () => ({ type: 'list_remove', value: '{user}', name: 'queue' }) },
  list_pick: { category: 'data', parts: ['pick a random item from list', { key: 'name', kind: 'text', placeholder: 'queue', width: 5 }, 'into', { key: 'value', kind: 'text', placeholder: 'picked', width: 5 }], make: () => ({ type: 'list_pick', name: 'queue', value: 'picked' }) },
  list_clear: { category: 'data', parts: ['empty the list', { key: 'name', kind: 'text', placeholder: 'queue', width: 5 }], make: () => ({ type: 'list_clear', name: 'queue' }) },
  change: { category: 'variables', parts: ['change', { key: 'name', kind: 'text', placeholder: 'score', width: 5 }, 'by', { key: 'value', kind: 'text', placeholder: '1', width: 3 }], make: () => ({ type: 'change', name: 'score', value: '1' }) },
};

// Values are chips: click one to drop it into the field you last typed in.
const VALUES = [
  ['{user}', 'their name'], ['{mention}', '@them'], ['{args}', 'command words'], ['{arg1}', 'first word'],
  ['{message}', 'the message'], ['{channel}', 'channel name'], ['{server}', 'server name'],
  ['{var.score}', 'a variable'], ['{random 1 10}', 'random number'], ['{roles}', 'their roles'],
  ['{button}', 'button clicked'], ['{choice}', 'menu choice'], ['{emoji}', 'reaction emoji'], ['{list.queue}', 'a list'], ['{list.queue.length}', 'list size'],
  ['{time}', 'the time'], ['{date}', 'the date'],
  ['{prompt}', 'what they said to the AI'], ['{param.sides}', 'a tool parameter'], ['{params}', 'all tool parameters'],
  ['{answer}', 'the AI’s last answer'], ['{ai.model}', 'the model'], ['{ai.error}', 'why the AI failed'],
];

const categoryOf = (type) => CATEGORIES.find((c) => c.id === BLOCKS[type].category);
// Primary, secondary (dropdowns) and tertiary (outlines) colours, as CSS variables on the block.
const tones = (colors) => ({ '--bb': colors[0], '--bb2': colors[1], '--bb3': colors[2] });
const colorOf = (type) => tones(categoryOf(type).colors);

// --- Scratch 3 block outlines (geometry from scratch-blocks' vertical renderer) ---
const SVG = 'http://www.w3.org/2000/svg';
const R = 4; // corner radius
const NOTCH_AT = 12; // where the notch starts, from the block's left edge
const NOTCH_W = 36;
const NOTCH_LEFT = 'c 2,0 3,1 4,2 l 4,4 c 1,1 2,2 4,2 h 12 c 2,0 3,-1 4,-2 l 4,-4 c 1,-1 2,-2 4,-2';
const NOTCH_RIGHT = 'c -2,0 -3,1 -4,2 l -4,4 c -1,1 -2,2 -4,2 h -12 c -2,0 -3,-1 -4,-2 l -4,-4 c -1,-1 -2,-2 -4,-2';
const HAT = 'c 25,-22 71,-22 96,0';
const ARM = 16; // width of a C block's arm

function blockPath(el) {
  const hat = el.classList.contains('hat');
  const cap = el.classList.contains('cap');
  const top = el.querySelector(':scope > .bb-row');
  const parts = [...el.querySelectorAll(':scope > .bb-mouth, :scope > .bb-else, :scope > .bb-foot')];
  const y0 = top.offsetTop;
  const w = Math.max(top.offsetWidth, hat ? 100 : 64);
  const d = [];
  if (hat) d.push(`M 0,${y0}`, HAT, `H ${w - R}`, `a ${R},${R} 0 0 1 ${R},${R}`);
  else d.push(`M 0,${y0 + R}`, `a ${R},${R} 0 0 1 ${R},-${R}`, `H ${NOTCH_AT}`, NOTCH_LEFT, `H ${w - R}`, `a ${R},${R} 0 0 1 ${R},${R}`);
  let bottom = y0 + top.offsetHeight;
  for (const part of parts) {
    if (part.classList.contains('bb-mouth')) {
      // Down the right side, in along the inner top (with a notch for the blocks inside), down the arm, back out.
      const end = part.offsetTop + part.offsetHeight;
      d.push(`V ${bottom - R}`, `a ${R},${R} 0 0 1 -${R},${R}`, `H ${ARM + NOTCH_AT + NOTCH_W}`, NOTCH_RIGHT,
        `H ${ARM + R}`, `a ${R},${R} 0 0 0 -${R},${R}`, `V ${end - R}`, `a ${R},${R} 0 0 0 ${R},${R}`, `H ${w - R}`, `a ${R},${R} 0 0 1 ${R},${R}`);
      bottom = end;
    } else {
      bottom = part.offsetTop + part.offsetHeight;
    }
  }
  d.push(`V ${bottom - R}`, `a ${R},${R} 0 0 1 -${R},${R}`);
  if (!cap) d.push(`H ${NOTCH_AT + NOTCH_W}`, NOTCH_RIGHT);
  d.push(`H ${R}`, `a ${R},${R} 0 0 1 -${R},-${R}`, 'Z');
  return d.join(' ');
}

function shapeBlock(el) {
  if (!el.isConnected || !el.querySelector(':scope > .bb-row')) return;
  let svg = el.querySelector(':scope > .bb-shape');
  if (!svg) {
    svg = document.createElementNS(SVG, 'svg');
    svg.classList.add('bb-shape');
    const path = document.createElementNS(SVG, 'path');
    path.style.fill = 'var(--bb)';
    path.style.stroke = 'var(--bb3)';
    svg.append(path);
    el.prepend(svg);
  }
  svg.setAttribute('width', el.offsetWidth + 2);
  svg.setAttribute('height', el.offsetHeight + 10);
  svg.firstChild.setAttribute('d', blockPath(el));
}

// Outlines follow their blocks: when a block (or anything inside a C block) changes size, redraw it.
const resizes = new ResizeObserver((entries) => {
  for (const entry of entries) shapeBlock(entry.target);
});

function shapeAll(root) {
  for (const el of root.querySelectorAll('.bb-block')) {
    shapeBlock(el);
    resizes.observe(el);
  }
}
const clone = (value) => JSON.parse(JSON.stringify(value));

// --- the editor ---

export function openBotBuilder(server, bot, { ai: openAi = false } = {}) {
  let program = clone(bot.program || []);
  let dirty = false;
  let lastField = null;
  let drag = null; // { kind: 'new' | 'move', type, payload, ghost, from }

  const textChannels = server.channels.filter((c) => c.kind === 'text').sort((a, b) => a.position - b.position);
  const voiceChannels = server.channels.filter((c) => c.kind === 'voice').sort((a, b) => a.position - b.position);
  let admin = Boolean(bot.admin);
  const roleList = h('datalist', { id: `bb-roles-${bot.id}` }, (server.roles || []).filter((r) => !r.admin).map((r) => h('option', { value: r.name })));
  const canvas = h('div', { class: 'bb-canvas' }, roleList);
  const status = h('span', { class: 'bb-status' }, 'Saved');
  const nameInput = h('input', { class: 'input bb-name', value: bot.user.displayName, maxLength: 32, oninput: () => markDirty() });

  function markDirty() {
    dirty = true;
    status.textContent = 'Unsaved changes';
    status.classList.add('dirty');
  }

  // --- paths: ['s', i] is script i; then pairs of [listKey, index] walk down into blocks ---
  function listAt(path) {
    // path: [scriptIndex, key, idx, key, idx, …, key] → the array at the end
    let node = program[path[0]];
    for (let i = 1; i < path.length - 1; i += 2) node = node[path[i]][path[i + 1]];
    return node[path.at(-1)];
  }

  // --- fields ---
  function fieldView(block, part) {
    const set = (value) => { block[part.key] = value; markDirty(); };
    const remember = (el) => el.addEventListener('focus', () => { lastField = { el, block, key: part.key }; });
    if (part.kind === 'select') {
      const el = h('select', { class: 'bb-field', onchange: () => { set(el.value); draw(); } },
        part.options.map(([value, label]) => h('option', { value, selected: block[part.key] === value }, label)));
      return el;
    }
    if (part.kind === 'channel' || part.kind === 'voice') {
      const list = part.kind === 'voice' ? voiceChannels : textChannels;
      const el = h('select', { class: 'bb-field', onchange: () => set(el.value) },
        part.here && h('option', { value: '' }, 'this channel'),
        !part.here && h('option', { value: '' }, 'pick a channel'),
        list.map((c) => h('option', { value: c.id, selected: block[part.key] === c.id }, `${part.kind === 'voice' ? '🔊 ' : '#'}${c.name}`)));
      return el;
    }
    if (part.kind === 'color') {
      return colorField({ value: block[part.key], label: 'Colour', onChange: (c) => set(c) });
    }
    if (part.kind === 'role') {
      // Pick a role, or type a name (or {arg1}) for one that doesn't exist yet.
      const el = h('input', {
        class: 'bb-field', type: 'text', value: block[part.key] ?? '', placeholder: 'role name', list: roleList.id,
        style: { width: `${Math.max(8, String(block[part.key] || '').length) + 1.5}ch` },
        oninput: () => { set(el.value); el.style.width = `${Math.max(8, el.value.length) + 1.5}ch`; },
      });
      remember(el);
      return el;
    }
    if (part.kind === 'lines') {
      const el = h('textarea', {
        class: 'bb-field bb-lines', rows: Math.max(2, (block[part.key] || []).length), placeholder: part.placeholder,
        style: { width: `${Math.min(48, Math.max(18, ...(block[part.key] || []).map((l) => l.length + 2)))}ch` },
        value: (block[part.key] || []).join('\n'),
        oninput: () => { block[part.key] = el.value.split('\n'); el.rows = Math.max(2, block[part.key].length); markDirty(); },
      });
      remember(el);
      return el;
    }
    const el = h('input', {
      class: `bb-field${part.kind === 'number' ? ' number' : ''}`, type: part.kind === 'number' ? 'number' : 'text',
      value: block[part.key] ?? '', placeholder: part.placeholder || '',
      style: { width: `${Math.max(part.kind === 'number' ? 2 : 3, String(block[part.key] || part.placeholder || '').length) + 0.5}ch` },
      oninput: () => {
        set(part.kind === 'number' ? Number(el.value) : el.value);
        el.style.width = `${Math.max(part.kind === 'number' ? 2 : 3, (el.value || part.placeholder || '').length) + 0.5}ch`;
      },
    });
    remember(el);
    return el;
  }

  function label(block, def) {
    return def.parts.map((part) => (typeof part === 'string'
      ? h('span', { class: 'bb-word' }, part)
      : part.hideWhen?.(block) ? null : fieldView(block, part)));
  }

  // --- drawing ---
  function slot(path) {
    return h('div', { class: 'bb-slot', dataset: { path: JSON.stringify(path) } });
  }

  function stackView(path) {
    const list = listAt(path);
    const el = h('div', { class: 'bb-stack' }, slot([...path, 0]));
    list.forEach((block, i) => {
      el.append(blockView(block, [...path, i]));
      if (!BLOCKS[block.type].cap) el.append(slot([...path, i + 1]));
    });
    return el;
  }

  function blockView(block, path) {
    const def = BLOCKS[block.type];
    const locked = categoryOf(block.type).admin && !admin;
    const el = h('div', { class: `bb-block${def.mouths ? ' c' : ''}${def.cap ? ' cap' : ''}${locked ? ' locked' : ''}`, style: colorOf(block.type), title: locked ? 'Turn on Admin for this block to run' : null },
      h('div', { class: 'bb-row', onpointerdown: (event) => afterNudge(event, (e) => startMove(e, path)) }, label(block, def)));
    for (const [i, mouth] of (def.mouths || []).entries()) {
      if (i > 0) el.append(h('div', { class: 'bb-row bb-else' }, h('span', { class: 'bb-word' }, 'else')));
      el.append(h('div', { class: 'bb-mouth' }, stackView([...path, mouth])));
    }
    if (def.mouths) el.append(h('div', { class: 'bb-foot' }));
    return el;
  }

  // A script without a trigger is a loose stack: it sits on the canvas and doesn't run until a "when…" goes on top.
  function scriptView(script, index) {
    const el = h('div', { class: `bb-script${script.trigger ? '' : ' loose'}`, style: { left: `${script.x}px`, top: `${script.y}px` } });
    if (script.trigger) {
      const def = BLOCKS[script.trigger.type];
      el.append(h('div', { class: 'bb-block hat', style: colorOf(script.trigger.type) },
        h('div', { class: 'bb-row', onpointerdown: (event) => afterNudge(event, (e) => startMoveScript(e, index)) }, label(script.trigger, def))));
    }
    el.append(stackView([index, 'blocks']));
    return el;
  }

  const HAT_HEIGHT = 70;

  function dropPoint(event) {
    const box = wrap.getBoundingClientRect();
    const inside = event.clientX > box.left && event.clientX < box.right && event.clientY > box.top && event.clientY < box.bottom;
    if (!inside) return null;
    const at = toCanvas(event);
    return { x: Math.max(0, Math.round(at.x - drag.offX / zoom)), y: Math.max(0, Math.round(at.y - drag.offY / zoom)) };
  }

  // Empty loose stacks disappear.
  function tidy() {
    program = program.filter((script) => script.trigger || script.blocks.length);
  }

  function draw() {
    canvas.replaceChildren(roleList, ...program.map(scriptView));
    shapeAll(canvas);
  }

  // --- dragging ---
  function ghostFor(type, payload) {
    const tmp = { ...payload };
    const def = BLOCKS[type];
    const el = h('div', { class: `bb-ghost bb-block${def.hat ? ' hat' : ''}${def.mouths ? ' c' : ''}`, style: colorOf(type) },
      h('div', { class: 'bb-row' }, def.parts.map((p) => (typeof p === 'string' ? h('span', { class: 'bb-word' }, p) : h('span', { class: `bb-field fake${p.kind === 'select' || p.kind === 'channel' ? ' select' : ''}` }, String(tmp[p.key] ?? p.placeholder ?? '…'))))));
    if (def.mouths) el.append(h('div', { class: 'bb-mouth' }), h('div', { class: 'bb-foot' }));
    document.body.append(el);
    shapeBlock(el);
    return el;
  }

  function begin(event, info) {
    event.preventDefault();
    drag = { ...info, ghost: ghostFor(info.type, info.payload[0] || info.payload), offX: 12, offY: 12 };
    if (info.kind === 'move-script') {
      const box = event.currentTarget.getBoundingClientRect();
      drag.offX = event.clientX - box.left;
      drag.offY = event.clientY - box.top;
      drag.ghost.remove();
      drag.ghost = null;
    }
    document.body.classList.add('bb-dragging');
    move(event);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end, { once: true });
  }

  // Nothing is picked up until the pointer has moved a few pixels, so clicking into a block is safe.
  function afterNudge(event, start) {
    if (event.button !== 0 || event.target.closest('input, select, textarea')) return;
    const x = event.clientX;
    const y = event.clientY;
    const target = event.currentTarget;
    const moved = (e) => {
      if (Math.hypot(e.clientX - x, e.clientY - y) < 5) return;
      cancel();
      start({ clientX: e.clientX, clientY: e.clientY, preventDefault: () => {}, currentTarget: target });
    };
    const cancel = () => {
      window.removeEventListener('pointermove', moved);
      window.removeEventListener('pointerup', cancel);
    };
    window.addEventListener('pointermove', moved);
    window.addEventListener('pointerup', cancel);
  }

  function startNew(event, type) {
    begin(event, { kind: 'new', type, payload: BLOCKS[type].make() });
  }

  function startMove(event, path) {
    // Takes the block and everything under it, like Scratch.
    const list = listAt(path.slice(0, -1));
    const index = path.at(-1);
    const taken = list.splice(index);
    tidy();
    markDirty();
    draw();
    begin(event, { kind: 'move', type: taken[0].type, payload: taken });
  }

  function startMoveScript(event, index) {
    begin(event, { kind: 'move-script', type: program[index].trigger.type, payload: program[index], index });
  }

  let hovered = null;
  function move(event) {
    if (!drag) return;
    if (drag.kind === 'move-script') {
      const at = toCanvas(event);
      const script = program[drag.index];
      script.x = Math.max(0, Math.round(at.x - drag.offX / zoom));
      script.y = Math.max(0, Math.round(at.y - drag.offY / zoom));
      canvas.children[drag.index].style.left = `${script.x}px`;
      canvas.children[drag.index].style.top = `${script.y}px`;
      markDirty();
      return;
    }
    drag.ghost.style.left = `${event.clientX - drag.offX}px`;
    drag.ghost.style.top = `${event.clientY - drag.offY}px`;
    hovered?.classList.remove('active');
    hovered = null;
    if (BLOCKS[drag.type].hat) return;
    // The nearest slot within reach of the pointer.
    let best = null;
    let bestDist = 40;
    for (const s of canvas.querySelectorAll('.bb-slot')) {
      const r = s.getBoundingClientRect();
      const dist = Math.hypot(event.clientX - drag.offX + 6 - r.left, (event.clientY - drag.offY) - r.top);
      if (dist < bestDist) { best = s; bestDist = dist; }
    }
    hovered = best;
    hovered?.classList.add('active');
  }

  function end(event) {
    window.removeEventListener('pointermove', move);
    document.body.classList.remove('bb-dragging');
    drag.ghost?.remove();
    const overPalette = event.clientX < wrap.getBoundingClientRect().left;
    if (drag.kind === 'move-script') {
      if (overPalette) { program.splice(drag.index, 1); markDirty(); }
    } else if (BLOCKS[drag.type].hat && drag.kind === 'new') {
      const at = !overPalette && dropPoint(event);
      if (at) {
        // Dropped just above a loose stack: it becomes that stack's trigger.
        const loose = program.find((script) => !script.trigger && Math.abs(script.x - at.x) < 50 && Math.abs(script.y - (at.y + HAT_HEIGHT)) < 50);
        if (loose) {
          loose.trigger = drag.payload;
          loose.y = Math.max(0, loose.y - HAT_HEIGHT);
        } else {
          program.push({ trigger: drag.payload, blocks: [], x: at.x, y: at.y });
        }
        markDirty();
      }
    } else if (hovered && !overPalette) {
      const path = JSON.parse(hovered.dataset.path);
      const list = listAt(path.slice(0, -1));
      const blocks = drag.kind === 'new' ? [drag.payload] : drag.payload;
      list.splice(path.at(-1), 0, ...blocks);
      markDirty();
    } else if (!overPalette && dropPoint(event)) {
      // Dropped on empty canvas: it stays there as a loose stack.
      const at = dropPoint(event);
      program.push({ trigger: null, blocks: drag.kind === 'new' ? [drag.payload] : drag.payload, x: at.x, y: at.y });
      markDirty();
    } else if (drag.kind === 'move') {
      // Dropped on the palette: the blocks are deleted.
      markDirty();
    }
    tidy();
    hovered?.classList.remove('active');
    hovered = null;
    drag = null;
    draw();
  }

  // --- palette ---
  // --- canvas position, zoom and tidy-up ---
  let zoom = 1;
  function toCanvas(event) {
    const box = canvas.getBoundingClientRect();
    return { x: (event.clientX - box.left) / zoom, y: (event.clientY - box.top) / zoom };
  }
  function setZoom(value) {
    zoom = Math.min(Math.max(Math.round(value * 100) / 100, 0.5), 1.5);
    canvas.style.zoom = zoom;
  }
  function cleanUp() {
    let y = 32;
    [...canvas.children].forEach((el, i) => {
      program[i].x = 32;
      program[i].y = y + (program[i].trigger ? 0 : 0);
      y += el.offsetHeight + 40;
    });
    markDirty();
    draw();
  }
  const controls = h('div', { class: 'bb-controls' },
    h('button', { type: 'button', title: 'Zoom in', onclick: () => setZoom(zoom + 0.1) }, icon('plus', 18)),
    h('button', { type: 'button', title: 'Zoom out', onclick: () => setZoom(zoom - 0.1) }, icon('minus', 18)),
    h('button', { type: 'button', title: 'Reset zoom', onclick: () => setZoom(1) }, '='),
    h('button', { type: 'button', title: 'Clean up blocks', onclick: cleanUp }, icon('scroll', 17)));
  const wrap = h('div', { class: 'bb-canvas-wrap' }, canvas);

  // --- category rail (like Scratch's coloured circles) ---
  const rail = h('nav', { class: 'bb-rail', 'aria-label': 'Block categories' });
  const drawRail = () => rail.replaceChildren(...CATEGORIES.filter((cat) => !cat.admin || admin).map((cat) => h('button', {
    type: 'button', class: 'bb-rail-item', dataset: { cat: cat.id },
    onclick: () => palette.querySelector(`[data-cat="${cat.id}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }),
  }, h('span', { class: 'bb-rail-dot', style: { background: cat.colors[0], borderColor: cat.colors[2] } }), cat.label)));
  const markRail = () => {
    const top = palette.getBoundingClientRect().top;
    let current = null;
    for (const group of palette.querySelectorAll('.bb-group')) if (group.getBoundingClientRect().top - top < 60) current = group.dataset.cat;
    for (const item of rail.children) item.classList.toggle('active', item.dataset.cat === (current || rail.firstChild?.dataset.cat));
  };

  const palette = h('div', { class: 'bb-palette', onscroll: () => markRail() });
  const drawPalette = () => palette.replaceChildren(...CATEGORIES.filter((cat) => !cat.admin || admin).map((cat) => h('div', { class: 'bb-group', dataset: { cat: cat.id } },
    h('div', { class: 'bb-group-title' }, h('span', { class: 'bb-dot', style: { background: cat.colors[0] } }), cat.label),
    cat.id === 'values'
      ? h('div', { class: 'bb-values' }, VALUES.map(([value, title]) => h('button', {
        type: 'button', class: 'bb-value', title,
        onmousedown: (event) => event.preventDefault(),
        onclick: () => {
          if (!lastField?.el.isConnected) return toast('Click into a block’s text box first, then pick a value.');
          const { el } = lastField;
          el.setRangeText(value, el.selectionStart ?? el.value.length, el.selectionEnd ?? el.value.length, 'end');
          el.dispatchEvent(new Event('input'));
          el.focus();
        },
      }, value)))
      : Object.entries(BLOCKS).filter(([, def]) => def.category === cat.id).map(([type, def]) => h('div', {
        class: `bb-block palette${def.hat ? ' hat' : ''}${def.mouths ? ' c' : ''}${def.cap ? ' cap' : ''}`, style: tones(cat.colors),
        onpointerdown: (event) => afterNudge(event, (e) => startNew(e, type)),
      }, h('div', { class: 'bb-row' }, def.parts.map((p) => (typeof p === 'string'
        ? h('span', { class: 'bb-word' }, p)
        : h('span', { class: `bb-field fake${['select', 'channel', 'voice'].includes(p.kind) ? ' select' : ''}` }, p.kind === 'select' ? (p.options.find(([v]) => v === def.make()[p.key]) || p.options[0])[1] : p.kind === 'channel' ? (p.here ? 'this channel' : 'channel') : p.kind === 'voice' ? 'voice channel' : p.kind === 'role' ? 'role' : p.kind === 'color' ? '●' : [def.make()[p.key] ?? p.placeholder ?? ''].flat().join(', '))))),
      def.mouths && [h('div', { class: 'bb-mouth' }), h('div', { class: 'bb-foot' })])))));
  drawPalette();
  shapeAll(palette);
  drawRail();
  requestAnimationFrame(markRail);

  // Admin: the bot becomes a server admin and the Admin blocks appear.
  const adminToggle = h('button', {
    type: 'button', class: 'bb-admin-toggle',
    onclick: () => attempt(async () => {
      const updated = await api.patch(`/api/servers/${server.id}/bots/${bot.id}`, { admin: !admin });
      admin = updated.admin;
      bot.admin = admin;
      drawAdmin();
      drawPalette();
      shapeAll(palette);
      drawRail();
      markRail();
      draw();
      toast(admin ? `${bot.user.displayName} is an admin now. Admin blocks are unlocked.` : `${bot.user.displayName} is no longer an admin.`, 'ok');
    }),
  });
  const drawAdmin = () => {
    adminToggle.replaceChildren(h('span', { class: `bb-switch${admin ? ' on' : ''}` }), 'Admin');
    adminToggle.setAttribute('aria-pressed', String(admin));
  };
  drawAdmin();

  // --- saving ---
  async function save() {
    const cleaned = program.map((s) => ({ ...s, blocks: s.blocks }));
    const updated = await api.patch(`/api/servers/${server.id}/bots/${bot.id}`, { program: cleaned, name: nameInput.value.trim() || bot.user.displayName });
    program = clone(updated.program);
    bot.program = updated.program;
    dirty = false;
    status.textContent = 'Saved';
    status.classList.remove('dirty');
    draw();
  }

  const saveButton = button('Save', () => attempt(save), 'primary small');
  // The AI drawer: settings (endpoint, key, model…) and a test chat. Testing saves the blocks first, so the
  // AI sees the tools as they are on screen.
  const ai = aiPanel({ server, bot, program: () => program, saveFirst: async () => { if (dirty) await save(); } });
  const page = openPage({
    title: 'Bot builder',
    actions: h('div', { class: 'bb-actions' }, nameInput,
      h('button', { type: 'button', class: 'bb-admin-toggle', title: 'Name, picture, bio, banner…', onclick: async () => {
        if (dirty) await attempt(save);
        const { openBotSettings } = await import('./botSettings.js');
        openBotSettings(server, bot);
      } }, icon('settings', 16), 'Settings'),
      ai.button, adminToggle, status, saveButton),
    content: h('div', { class: 'bb' }, rail, palette, h('div', { class: 'bb-stage' }, wrap, controls, ai.el)),
    onClose: () => { if (dirty) toast('Your bot had unsaved changes.'); },
  });
  page.el?.classList.add('wide');
  draw();
  if (openAi) ai.toggle(true);

  const keys = (event) => {
    if (!canvas.isConnected) return window.removeEventListener('keydown', keys);
    if ((event.ctrlKey || event.metaKey) && event.key === 's') {
      event.preventDefault();
      attempt(save);
    }
  };
  window.addEventListener('keydown', keys);
  return page;
}

