// The bot builder: drag blocks from the palette onto the canvas and snap them together, like Scratch.
// A program is a list of scripts { trigger, blocks, x, y }; blocks can hold more blocks (`do`, `else`).
// Inputs hold typed text or reporters: round value blocks and pointed true/false blocks, { r: type, … },
// which can hold more reporters. Programs are plain data; the server checks and runs them (server/lib/bots.js).
import * as api from '../api.js';
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { attempt, toast } from '../ui.js';
import { navigate, paths } from '../router.js';
import { colorField } from '../colorPicker.js';
import { showMenu } from '../contextMenu.js';

// Copied blocks survive switching bots (and reloads), like a clipboard.
const CLIP_KEY = 'opencord.botClipboard';
function readClip() {
  try { return JSON.parse(localStorage.getItem(CLIP_KEY) || 'null'); } catch { return null; }
}
function writeClip(value) {
  try { localStorage.setItem(CLIP_KEY, JSON.stringify(value)); } catch { /* storage off: copy still works this session */ }
  memoryClip = value;
}
let memoryClip = null;

// --- categories (Scratch's colours) ---

export const CATEGORIES = [
  { id: 'events', label: 'Events', colors: ['#ffbf00', '#e6ac00', '#cc9900'] },
  { id: 'messages', label: 'Messages', colors: ['#9966ff', '#855cd6', '#774dcb'] },
  { id: 'control', label: 'Control', colors: ['#ffab19', '#ec9c13', '#cf8b17'] },
  { id: 'operators', label: 'Operators', colors: ['#59c059', '#46b946', '#389438'] },
  { id: 'variables', label: 'Variables', colors: ['#ff8c1a', '#ff8000', '#db6e00'] },
  { id: 'lists', label: 'Lists', colors: ['#ff661a', '#ff5500', '#e64d00'] },
  { id: 'info', label: 'Info', colors: ['#5cb1d6', '#47a8d1', '#2e8eb8'] },
  { id: 'ai', label: 'AI', colors: ['#5b6ee1', '#4c5fd4', '#3c4cb8'] },
  { id: 'voice', label: 'Voice', colors: ['#cf63cf', '#c94fc9', '#bd42bd'] },
  { id: 'admin', label: 'Admin', colors: ['#ff6680', '#ff4d6a', '#ff3355'], admin: true },
  { id: 'roles', label: 'Roles', colors: ['#0fbd8c', '#0da57a', '#0b8e69'], admin: true },
];
const catById = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));
// Primary, secondary (dropdowns) and tertiary (outlines) colours, as CSS variables on the block.
const tones = (cat) => ({ '--bb': catById[cat].colors[0], '--bb2': catById[cat].colors[1], '--bb3': catById[cat].colors[2] });

const TARGET = [['person', 'the person'], ['mentioned', 'the mentioned person']];
const MATCH = [['contains', 'contains'], ['starts', 'starts with'], ['equals', 'is exactly'], ['any', 'is anything']];

// --- stack blocks and hats ---
// `parts` are words, or inputs: { key, kind } where kind is
//   text / number  typed value, or a reporter dropped in        bool    a pointed slot for true/false blocks
//   select         a fixed choice ({ options })                   var / list  a variable or list name
//   channel / voice / role / color / lines / secret

const T = (key, label) => ({ key, kind: 'text', ...(label && { label }) });
const N = (key) => ({ key, kind: 'number' });
const B = (key, label) => ({ key, kind: 'bool', ...(label && { label }) });
const V = { key: 'name', kind: 'var' };
const L = { key: 'name', kind: 'list' };
const CH = { key: 'channel', kind: 'channel', here: true };
const WHO = { key: 'target', kind: 'select', options: TARGET };

export const BLOCKS = {
  // events
  message: { hat: true, category: 'events', parts: ['when a message', { key: 'match', kind: 'select', options: MATCH }, { key: 'text', kind: 'name', hideWhen: (b) => b.match === 'any' }], make: () => ({ type: 'message', match: 'contains', text: 'hello' }) },
  command: { hat: true, category: 'events', parts: ['when someone types /', { key: 'name', kind: 'name' }], make: () => ({ type: 'command', name: 'ping' }) },
  ai_message: { hat: true, category: 'events', parts: ['when someone talks to me'], make: () => ({ type: 'ai_message' }) },
  join: { hat: true, category: 'events', parts: ['when someone joins'], make: () => ({ type: 'join' }) },
  leave: { hat: true, category: 'events', parts: ['when someone leaves'], make: () => ({ type: 'leave' }) },
  reaction: { hat: true, category: 'events', parts: ['when someone reacts with', { key: 'emoji', kind: 'name', placeholder: 'any' }], make: () => ({ type: 'reaction', emoji: '👍' }) },
  button: { hat: true, category: 'events', parts: ['when button', { key: 'text', kind: 'name', placeholder: 'any' }, 'is clicked'], make: () => ({ type: 'button', text: 'Yes' }) },
  menu: { hat: true, category: 'events', parts: ['when someone picks', { key: 'text', kind: 'name', placeholder: 'anything' }, 'from a menu'], make: () => ({ type: 'menu', text: '' }) },
  timer: { hat: true, category: 'events', parts: ['every', { key: 'minutes', kind: 'name' }, 'minutes in', { key: 'channel', kind: 'channel' }], make: () => ({ type: 'timer', minutes: 60, channel: '' }) },

  // messages
  send: { category: 'messages', parts: ['send', T('text'), 'in', CH], make: () => ({ type: 'send', text: 'Hello!', channel: '' }) },
  reply: { category: 'messages', parts: ['reply', T('text')], make: () => ({ type: 'reply', text: 'Hello!' }) },
  dm: { category: 'messages', parts: ['message', WHO, 'privately', T('text')], make: () => ({ type: 'dm', target: 'person', text: 'Welcome!' }) },
  react: { category: 'messages', parts: ['react with', T('emoji')], make: () => ({ type: 'react', emoji: '👍' }) },
  buttons: { category: 'messages', parts: ['send', T('text'), 'with buttons', { key: 'options', kind: 'lines' }, 'in', CH], make: () => ({ type: 'buttons', text: 'Pick one:', options: ['Yes', 'No'], channel: '' }) },
  menu_send: { category: 'messages', parts: ['send', T('text'), 'with a menu', { key: 'options', kind: 'lines' }, 'in', CH], make: () => ({ type: 'menu_send', text: 'Pick one:', options: ['Red', 'Green', 'Blue'], channel: '' }) },
  pin: { category: 'messages', parts: ['pin the message'], make: () => ({ type: 'pin' }) },
  unpin: { category: 'messages', parts: ['unpin the message'], make: () => ({ type: 'unpin' }) },

  // control
  wait: { category: 'control', parts: ['wait', N('seconds'), 'seconds'], make: () => ({ type: 'wait', seconds: 1 }) },
  repeat: { category: 'control', parts: ['repeat', N('times')], mouths: ['do'], make: () => ({ type: 'repeat', times: 10, do: [] }) },
  forever: { category: 'control', cap: true, parts: ['forever'], mouths: ['do'], make: () => ({ type: 'forever', do: [] }) },
  if: { category: 'control', parts: ['if', B('cond'), 'then'], mouths: ['do'], make: () => ({ type: 'if', do: [] }) },
  if_else: { category: 'control', parts: ['if', B('cond'), 'then'], mouths: ['do', 'else'], make: () => ({ type: 'if_else', do: [], else: [] }) },
  wait_until: { category: 'control', parts: ['wait until', B('cond')], make: () => ({ type: 'wait_until' }) },
  until: { category: 'control', parts: ['repeat until', B('cond')], mouths: ['do'], make: () => ({ type: 'until', do: [] }) },
  stop: { category: 'control', cap: true, parts: ['stop this script'], make: () => ({ type: 'stop' }) },

  // variables and lists
  set: { category: 'variables', parts: ['set', V, 'to', T('value')], make: () => ({ type: 'set', name: '', value: '0' }) },
  change: { category: 'variables', parts: ['change', V, 'by', N('value')], make: () => ({ type: 'change', name: '', value: 1 }) },
  list_add: { category: 'lists', parts: ['add', T('value'), 'to', L], make: () => ({ type: 'list_add', value: 'thing', name: '' }) },
  list_delete: { category: 'lists', parts: ['delete', T('index'), 'of', L], make: () => ({ type: 'list_delete', index: '1', name: '' }) },
  list_clear: { category: 'lists', parts: ['delete all of', L], make: () => ({ type: 'list_clear', name: '' }) },
  list_insert: { category: 'lists', parts: ['insert', T('value'), 'at', N('index'), 'of', L], make: () => ({ type: 'list_insert', value: 'thing', index: 1, name: '' }) },
  list_replace: { category: 'lists', parts: ['replace item', T('index'), 'of', L, 'with', T('value')], make: () => ({ type: 'list_replace', index: '1', name: '', value: 'thing' }) },

  // AI
  tool: { hat: true, category: 'ai', parts: ['when the AI uses', { key: 'name', kind: 'name' }, 'to', { key: 'description', kind: 'name', placeholder: 'what it does' }, 'with', { key: 'options', kind: 'lines', placeholder: 'sides (number): how many sides' }], make: () => ({ type: 'tool', name: 'roll_dice', description: 'roll a dice', options: ['sides (number): how many sides'] }) },
  ai_connect: { category: 'ai', parts: ['use AI at', T('url'), 'key', { key: 'key', kind: 'secret' }, 'model', T('model')], make: () => ({ type: 'ai_connect', url: 'https://openrouter.ai/api/v1', key: '', model: 'openrouter/auto' }) },
  ai_instructions: { category: 'ai', parts: ['add AI instructions', T('text')], make: () => ({ type: 'ai_instructions', text: 'Be friendly and short.' }) },
  ai_reply: { category: 'ai', parts: ['answer them with AI'], make: () => ({ type: 'ai_reply' }) },
  ai_tell: { category: 'ai', parts: ['tell the AI', T('text')], make: () => ({ type: 'ai_tell', text: 'done' }) },

  // voice
  join_voice: { category: 'voice', parts: ['join voice', { key: 'channel', kind: 'voice' }], make: () => ({ type: 'join_voice', channel: '' }) },
  leave_voice: { category: 'voice', parts: ['leave voice'], make: () => ({ type: 'leave_voice' }) },

  // admin
  delete: { category: 'admin', parts: ['delete the message'], make: () => ({ type: 'delete' }) },
  purge: { category: 'admin', parts: ['delete the last', N('count'), 'messages in', CH], make: () => ({ type: 'purge', count: 10, channel: '' }) },
  everyone: { category: 'admin', parts: ['ping @everyone', T('text'), 'in', CH], make: () => ({ type: 'everyone', text: 'News!', channel: '' }) },
  kick: { category: 'admin', parts: ['kick', WHO, 'because', T('reason')], make: () => ({ type: 'kick', target: 'mentioned', reason: '' }) },
  ban: { category: 'admin', parts: ['ban', WHO, 'because', T('reason')], make: () => ({ type: 'ban', target: 'mentioned', reason: '' }) },
  timeout: { category: 'admin', parts: ['time out', WHO, 'for', N('minutes'), 'minutes'], make: () => ({ type: 'timeout', target: 'mentioned', minutes: 10 }) },
  untimeout: { category: 'admin', parts: ['end time out for', WHO], make: () => ({ type: 'untimeout', target: 'mentioned' }) },
  create_channel: { category: 'admin', parts: ['create', { key: 'kind', kind: 'select', options: [['text', 'text'], ['voice', 'voice']] }, 'channel', T('name')], make: () => ({ type: 'create_channel', kind: 'text', name: 'new-channel' }) },
  delete_channel: { category: 'admin', parts: ['delete channel', T('name')], make: () => ({ type: 'delete_channel', name: 'old-channel' }) },
  rename_channel: { category: 'admin', parts: ['rename', CH, 'to', T('name')], make: () => ({ type: 'rename_channel', channel: '', name: 'new-name' }) },
  topic: { category: 'admin', parts: ['set topic of', CH, 'to', T('text')], make: () => ({ type: 'topic', channel: '', text: 'Hello' }) },
  slowmode: { category: 'admin', parts: ['set slowmode in', CH, 'to', N('slow'), 'seconds'], make: () => ({ type: 'slowmode', channel: '', slow: 10 }) },
  lock: { category: 'admin', parts: [{ key: 'lock', kind: 'select', options: [['lock', 'lock'], ['unlock', 'unlock']] }, CH], make: () => ({ type: 'lock', lock: 'lock', channel: '' }) },
  invite: { category: 'admin', parts: ['set', V, 'to a new invite link'], make: () => ({ type: 'invite', name: '' }) },

  // roles (by name; roles with admin powers are off limits)
  give_role: { category: 'roles', parts: ['give', WHO, 'the role', { key: 'role', kind: 'role' }], make: () => ({ type: 'give_role', target: 'person', role: '' }) },
  take_role: { category: 'roles', parts: ['take the role', { key: 'role', kind: 'role' }, 'from', WHO], make: () => ({ type: 'take_role', target: 'person', role: '' }) },
  toggle_role: { category: 'roles', parts: ['toggle the role', { key: 'role', kind: 'role' }, 'for', WHO], make: () => ({ type: 'toggle_role', target: 'person', role: '' }) },
  create_role: { category: 'roles', parts: ['create the role', { key: 'role', kind: 'role' }, 'coloured', { key: 'color', kind: 'color' }], make: () => ({ type: 'create_role', role: 'Members', color: '#a99bf0' }) },
  rename_role: { category: 'roles', parts: ['rename role', { key: 'role', kind: 'role' }, 'to', T('name')], make: () => ({ type: 'rename_role', role: '', name: 'New name' }) },
  color_role: { category: 'roles', parts: ['colour role', { key: 'role', kind: 'role' }, { key: 'color', kind: 'color' }], make: () => ({ type: 'color_role', role: '', color: '#8fc1d6' }) },
  delete_role: { category: 'roles', parts: ['delete the role', { key: 'role', kind: 'role' }], make: () => ({ type: 'delete_role', role: '' }) },

  // Older blocks: not in the palette any more, but bots made with them still show and run.
  ping: { legacy: true, category: 'messages', parts: ['ping', WHO, 'and say', T('text')], make: () => ({ type: 'ping', target: 'person', text: '' }) },
  random: { legacy: true, category: 'messages', parts: ['send one of', { key: 'options', kind: 'lines' }], make: () => ({ type: 'random', options: [] }) },
  http: { legacy: true, category: 'info', parts: ['get', T('url'), 'and keep', T('field'), 'in', V], make: () => ({ type: 'http', url: '', field: '', name: '' }) },
  math: { legacy: true, category: 'operators', parts: ['set', V, 'to', T('left'), { key: 'math', kind: 'select', options: [['+', '+'], ['-', '−'], ['*', '×'], ['/', '÷'], ['%', 'mod'], ['min', 'min'], ['max', 'max'], ['round', 'round']] }, T('right')], make: () => ({ type: 'math', name: '', left: '', math: '+', right: '' }) },
  random_number: { legacy: true, category: 'operators', parts: ['set', V, 'to random', N('min'), 'to', N('max')], make: () => ({ type: 'random_number', name: '', min: 1, max: 6 }) },
  text_case: { legacy: true, category: 'operators', parts: ['set', V, 'to', { key: 'textCase', kind: 'select', options: [['upper', 'UPPERCASE'], ['lower', 'lowercase'], ['length', 'length'], ['reverse', 'reversed'], ['trim', 'trimmed']] }, 'of', T('value')], make: () => ({ type: 'text_case', name: '', textCase: 'upper', value: '' }) },
  list_remove: { legacy: true, category: 'lists', parts: ['remove', T('value'), 'from', L], make: () => ({ type: 'list_remove', value: '', name: '' }) },
  list_pick: { legacy: true, category: 'lists', parts: ['pick a random item from', L, 'into', T('value')], make: () => ({ type: 'list_pick', name: '', value: '' }) },
  ai_ask: { legacy: true, category: 'ai', parts: ['ask the AI', T('text'), 'and keep the answer in', V], make: () => ({ type: 'ai_ask', text: '', name: '' }) },
};

// --- reporters: round value blocks and pointed true/false blocks ---

const ROUND = 'round';
const BOOL = 'bool';
export const REPORTERS = {
  // operators
  add: { category: 'operators', parts: [T('a'), '+', T('b')], make: () => ({ r: 'add', a: '', b: '' }) },
  sub: { category: 'operators', parts: [T('a'), '−', T('b')], make: () => ({ r: 'sub', a: '', b: '' }) },
  mul: { category: 'operators', parts: [T('a'), '×', T('b')], make: () => ({ r: 'mul', a: '', b: '' }) },
  div: { category: 'operators', parts: [T('a'), '÷', T('b')], make: () => ({ r: 'div', a: '', b: '' }) },
  random: { category: 'operators', parts: ['pick random', T('a'), 'to', T('b')], make: () => ({ r: 'random', a: '1', b: '10' }) },
  gt: { category: 'operators', shape: BOOL, parts: [T('a'), '>', T('b')], make: () => ({ r: 'gt', a: '', b: '50' }) },
  lt: { category: 'operators', shape: BOOL, parts: [T('a'), '<', T('b')], make: () => ({ r: 'lt', a: '', b: '50' }) },
  eq: { category: 'operators', shape: BOOL, parts: [T('a'), '=', T('b')], make: () => ({ r: 'eq', a: '', b: '50' }) },
  and: { category: 'operators', shape: BOOL, parts: [B('a'), 'and', B('b')], make: () => ({ r: 'and' }) },
  or: { category: 'operators', shape: BOOL, parts: [B('a'), 'or', B('b')], make: () => ({ r: 'or' }) },
  not: { category: 'operators', shape: BOOL, parts: ['not', B('a')], make: () => ({ r: 'not' }) },
  join: { category: 'operators', parts: ['join', T('a'), T('b')], make: () => ({ r: 'join', a: 'apple ', b: 'banana' }) },
  letter: { category: 'operators', parts: ['letter', T('a'), 'of', T('b')], make: () => ({ r: 'letter', a: '1', b: 'apple' }) },
  length: { category: 'operators', parts: ['length of', T('a')], make: () => ({ r: 'length', a: 'apple' }) },
  contains: { category: 'operators', shape: BOOL, parts: [T('a'), 'contains', T('b'), '?'], make: () => ({ r: 'contains', a: 'apple', b: 'a' }) },
  starts: { category: 'operators', shape: BOOL, parts: [T('a'), 'starts with', T('b'), '?'], make: () => ({ r: 'starts', a: 'apple', b: 'a' }) },
  mod: { category: 'operators', parts: [T('a'), 'mod', T('b')], make: () => ({ r: 'mod', a: '', b: '' }) },
  round: { category: 'operators', parts: ['round', T('a')], make: () => ({ r: 'round', a: '' }) },
  math: { category: 'operators', parts: [{ key: 'fn', kind: 'select', options: [['abs', 'abs'], ['floor', 'floor'], ['ceiling', 'ceiling'], ['sqrt', 'sqrt'], ['sin', 'sin'], ['cos', 'cos'], ['tan', 'tan'], ['asin', 'asin'], ['acos', 'acos'], ['atan', 'atan'], ['ln', 'ln'], ['log', 'log'], ['e^', 'e ^'], ['10^', '10 ^']] }, 'of', T('a')], make: () => ({ r: 'math', fn: 'abs', a: '' }) },
  case: { category: 'operators', parts: [{ key: 'fn', kind: 'select', options: [['upper', 'UPPERCASE'], ['lower', 'lowercase'], ['title', 'Title Case']] }, 'of', T('a')], make: () => ({ r: 'case', fn: 'upper', a: 'hello' }) },
  min: { category: 'operators', parts: ['smaller of', T('a'), 'and', T('b')], make: () => ({ r: 'min', a: '3', b: '7' }) },
  max: { category: 'operators', parts: ['bigger of', T('a'), 'and', T('b')], make: () => ({ r: 'max', a: '3', b: '7' }) },
  power: { category: 'operators', parts: [T('a', 'Number'), 'to the power of', T('b', 'Power')], make: () => ({ r: 'power', a: '2', b: '8' }) },
  clamp: { category: 'operators', parts: ['keep', T('a', 'Number'), 'between', T('b', 'Min'), 'and', T('c', 'Max')], make: () => ({ r: 'clamp', a: '15', b: '1', c: '10' }) },
  percent: { category: 'operators', parts: [T('a', 'Percent'), '% of', T('b', 'Number')], make: () => ({ r: 'percent', a: '25', b: '200' }) },
  ne: { category: 'operators', shape: BOOL, parts: [T('a'), '≠', T('b')], make: () => ({ r: 'ne', a: '', b: '50' }) },
  gte: { category: 'operators', shape: BOOL, parts: [T('a'), '≥', T('b')], make: () => ({ r: 'gte', a: '', b: '50' }) },
  lte: { category: 'operators', shape: BOOL, parts: [T('a'), '≤', T('b')], make: () => ({ r: 'lte', a: '', b: '50' }) },
  between: { category: 'operators', shape: BOOL, parts: [T('a', 'Value'), 'is between', T('b', 'From'), 'and', T('c', 'To'), '?'], make: () => ({ r: 'between', a: '5', b: '1', c: '10' }) },
  is_number: { category: 'operators', shape: BOOL, parts: [T('a'), 'is a number?'], make: () => ({ r: 'is_number', a: '42' }) },
  is_empty: { category: 'operators', shape: BOOL, parts: [T('a'), 'is empty?'], make: () => ({ r: 'is_empty', a: '' }) },
  random_pick: { category: 'operators', parts: ['random one of', T('a', 'Options (comma or line separated)')], make: () => ({ r: 'random_pick', a: 'rock, paper, scissors' }) },
  coin: { category: 'operators', parts: ['flip a coin'], make: () => ({ r: 'coin' }) },
  pick_if: { category: 'operators', parts: ['if', B('a', 'Condition'), 'then', T('b', 'Then'), 'else', T('c', 'Else')], make: () => ({ r: 'pick_if', b: 'yes', c: 'no' }) },

  // text
  slice: { category: 'operators', parts: ['letters', T('a', 'From'), 'to', T('b', 'To'), 'of', T('c', 'Text')], make: () => ({ r: 'slice', a: '1', b: '5', c: 'hello world' }) },
  replace: { category: 'operators', parts: ['replace', T('a', 'Find'), 'with', T('b', 'Replace with'), 'in', T('c', 'Text')], make: () => ({ r: 'replace', a: 'world', b: 'there', c: 'hello world' }) },
  split_item: { category: 'operators', parts: ['part', T('a', 'Position'), 'of', T('c', 'Text'), 'split by', T('b', 'Separator')], make: () => ({ r: 'split_item', a: '2', b: ',', c: 'red,green,blue' }) },
  index_of: { category: 'operators', parts: ['position of', T('a', 'Find'), 'in', T('b', 'Text')], make: () => ({ r: 'index_of', a: 'world', b: 'hello world' }) },
  ends: { category: 'operators', shape: BOOL, parts: [T('a'), 'ends with', T('b'), '?'], make: () => ({ r: 'ends', a: 'apple', b: 'e' }) },
  trim: { category: 'operators', parts: ['trim spaces from', T('a')], make: () => ({ r: 'trim', a: '  hello  ' }) },
  repeat_text: { category: 'operators', parts: ['repeat', T('a', 'Text'), T('b', 'Times'), 'times'], make: () => ({ r: 'repeat_text', a: 'ha', b: '3' }) },
  reverse: { category: 'operators', parts: ['reverse', T('a')], make: () => ({ r: 'reverse', a: 'hello' }) },
  count_of: { category: 'operators', parts: ['how many', T('a', 'Find'), 'in', T('b', 'Text')], make: () => ({ r: 'count_of', a: 'l', b: 'hello' }) },
  word_count: { category: 'operators', parts: ['number of words in', T('a')], make: () => ({ r: 'word_count', a: 'hello there world' }) },
  word_of: { category: 'operators', parts: ['word', T('a', 'Position'), 'of', T('b', 'Text')], make: () => ({ r: 'word_of', a: '1', b: 'hello there' }) },
  line_of: { category: 'operators', parts: ['line', T('a', 'Position'), 'of', T('b', 'Text')], make: () => ({ r: 'line_of', a: '1', b: '' }) },
  json_get: { category: 'operators', parts: ['get', T('b', 'Path'), 'from JSON', T('a', 'JSON')], make: () => ({ r: 'json_get', a: '{"name": "Opencord"}', b: 'name' }) },
  encode: { category: 'operators', parts: [{ key: 'fn', kind: 'select', options: [['url', 'URL encode'], ['unurl', 'URL decode'], ['base64', 'Base64 encode'], ['unbase64', 'Base64 decode']] }, T('a')], make: () => ({ r: 'encode', fn: 'url', a: 'hello world' }) },

  // variables and lists (one of each per name in the palette)
  var: { category: 'variables', parts: [V], make: (name) => ({ r: 'var', name }) },
  list: { category: 'lists', parts: [L], make: (name) => ({ r: 'list', name }) },
  item: { category: 'lists', parts: ['item', T('a'), 'of', L], make: (name) => ({ r: 'item', a: '1', name }) },
  list_random: { category: 'lists', parts: ['random item of', L], make: (name) => ({ r: 'list_random', name }) },
  list_length: { category: 'lists', parts: ['length of', L], make: (name) => ({ r: 'list_length', name }) },
  list_contains: { category: 'lists', shape: BOOL, parts: [L, 'contains', T('a'), '?'], make: (name) => ({ r: 'list_contains', name, a: 'thing' }) },
  list_join: { category: 'lists', parts: [L, 'joined with', T('a', 'Between items')], make: (name) => ({ r: 'list_join', name, a: ', ' }) },
  list_index: { category: 'lists', parts: ['position of', T('a'), 'in', L], make: (name) => ({ r: 'list_index', name, a: 'thing' }) },

  // info: who, what and where
  user_name: { category: 'info', parts: ['their name'], make: () => ({ r: 'user_name' }) },
  user_mention: { category: 'info', parts: ['@them'], make: () => ({ r: 'user_mention' }) },
  user_id: { category: 'info', parts: ['their username'], make: () => ({ r: 'user_id' }) },
  message: { category: 'info', parts: ['the message'], make: () => ({ r: 'message' }) },
  said: { category: 'info', parts: ['what they said to me'], make: () => ({ r: 'said' }) },
  words: { category: 'info', parts: ['words after the command'], make: () => ({ r: 'words' }) },
  word: { category: 'info', parts: ['word', T('a'), 'after the command'], make: () => ({ r: 'word', a: '1' }) },
  mentioned_name: { category: 'info', parts: ['mentioned person’s name'], make: () => ({ r: 'mentioned_name' }) },
  mentioned_mention: { category: 'info', parts: ['@mentioned person'], make: () => ({ r: 'mentioned_mention' }) },
  has_role: { category: 'info', shape: BOOL, parts: ['they have the role', T('a'), '?'], make: () => ({ r: 'has_role', a: 'Members' }) },
  channel_name: { category: 'info', parts: ['channel name'], make: () => ({ r: 'channel_name' }) },
  server_name: { category: 'info', parts: ['server name'], make: () => ({ r: 'server_name' }) },
  member_count: { category: 'info', parts: ['member count'], make: () => ({ r: 'member_count' }) },
  button: { category: 'info', parts: ['button clicked'], make: () => ({ r: 'button' }) },
  choice: { category: 'info', parts: ['menu choice'], make: () => ({ r: 'choice' }) },
  emoji: { category: 'info', parts: ['reaction emoji'], make: () => ({ r: 'emoji' }) },
  now: { category: 'info', parts: ['current', { key: 'fn', kind: 'select', options: [['hour', 'hour'], ['minute', 'minute'], ['second', 'second'], ['weekday', 'day of week'], ['date', 'date'], ['month', 'month'], ['year', 'year'], ['time', 'time'], ['day', 'day']] }], make: () => ({ r: 'now', fn: 'hour' }) },
  unix: { category: 'info', parts: ['seconds since 1970'], make: () => ({ r: 'unix' }) },
  bot_name: { category: 'info', parts: ['my name'], make: () => ({ r: 'bot_name' }) },
  channel_mention: { category: 'info', parts: ['#this channel'], make: () => ({ r: 'channel_mention' }) },
  web: { category: 'info', parts: ['data from', T('a'), 'at', T('b')], make: () => ({ r: 'web', a: 'https://api.adviceslip.com/advice', b: 'slip.advice' }) },

  // AI
  ai_answer: { category: 'ai', parts: ['AI answer to', T('a')], make: () => ({ r: 'ai_answer', a: 'Tell me a joke' }) },
  tool_input: { category: 'ai', parts: ['tool input', { key: 'name', kind: 'name' }], make: () => ({ r: 'tool_input', name: 'sides' }) },
  ai_error: { category: 'ai', parts: ['AI error'], make: () => ({ r: 'ai_error' }) },
};

// Which reporters go in each palette group, after the stack blocks (variables and lists add one per name).
export const REPORTER_ORDER = {
  operators: ['add', 'sub', 'mul', 'div', 'random', 'gt', 'lt', 'eq', 'ne', 'gte', 'lte', 'between', 'and', 'or', 'not', 'is_number', 'is_empty', 'pick_if',
    'join', 'letter', 'length', 'contains', 'starts', 'ends', 'slice', 'replace', 'split_item', 'index_of', 'count_of', 'trim', 'repeat_text', 'reverse',
    'word_count', 'word_of', 'line_of', 'case', 'mod', 'round', 'math', 'min', 'max', 'power', 'clamp', 'percent', 'random_pick', 'coin', 'json_get', 'encode'],
  info: ['user_name', 'user_mention', 'user_id', 'message', 'said', 'words', 'word', 'mentioned_name', 'mentioned_mention', 'has_role', 'channel_name', 'channel_mention', 'server_name', 'member_count', 'bot_name', 'button', 'choice', 'emoji', 'now', 'unix', 'web'],
  ai: ['ai_answer', 'tool_input', 'ai_error'],
};
export const LIST_REPORTERS = ['item', 'list_random', 'list_length', 'list_contains', 'list_join', 'list_index'];

const isReporter = (x) => Boolean(x) && typeof x === 'object' && !Array.isArray(x) && typeof x.r === 'string';
const shapeOf = (node) => REPORTERS[node.r]?.shape || ROUND;
const SLOT_KINDS = ['text', 'number', 'bool', 'role', 'secret'];

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

// Bots made before reporters had "if [a] [op] [b]": turn those into a pointed block.
const OLD_OPS = { equals: 'eq', greater: 'gt', less: 'lt', contains: 'contains', starts: 'starts' };
export function upgrade(blocks) {
  for (const b of blocks || []) {
    if ((b.type === 'if' || b.type === 'until') && b.cond === undefined && b.op) {
      const pair = { a: b.left ?? '', b: b.right ?? '' };
      if (OLD_OPS[b.op]) b.cond = { r: OLD_OPS[b.op], ...pair };
      else if (b.op === 'not') b.cond = { r: 'not', a: { r: 'eq', ...pair } };
      else if (b.op === 'has_role') b.cond = { r: 'has_role', a: b.right ?? '' };
      else if (b.op === 'not_role') b.cond = { r: 'not', a: { r: 'has_role', a: b.right ?? '' } };
      if (b.type === 'if' && b.else?.length) b.type = 'if_else';
      for (const key of ['left', 'right', 'op']) delete b[key];
    }
    upgrade(b.do);
    upgrade(b.else);
  }
}

// Every variable or list name used anywhere in the program.
function namesIn(program, kind) {
  const out = new Set();
  const listTypes = ['list_add', 'list_delete', 'list_clear', 'list_insert', 'list_replace', 'list_remove', 'list_pick'];
  const listReporters = ['list', ...LIST_REPORTERS];
  const visit = (x) => {
    if (Array.isArray(x)) return x.forEach(visit);
    if (!x || typeof x !== 'object') return;
    const isList = listTypes.includes(x.type) || listReporters.includes(x.r);
    const isVar = ['set', 'change', 'invite', 'http', 'math', 'random_number', 'text_case', 'ai_ask'].includes(x.type) || x.r === 'var';
    if (x.name && (kind === 'list' ? isList : isVar)) out.add(x.name);
    for (const value of Object.values(x)) if (value && typeof value === 'object') visit(value);
  };
  visit(program.map((s) => [s.trigger, s.blocks]));
  return out;
}

// --- the editor ---

// The builder lives in the bot workspace (views/botWorkspace.js): this opens it there.
export function openBotBuilder(server, bot) {
  navigate(paths.bots(server.id, bot.id));
}

// Builds the editor for one bot. Returns its parts for the workspace to place: `side` (category dots and the
// block palette, for the left column), `stage` (the canvas), `status` and `adminToggle` (for the header),
// `mounted()` to call once they're on screen, and `flush()` to save before leaving.
export function createBotBuilder(server, bot) {
  let program = clone(bot.program || []);
  for (const script of program) upgrade(script.blocks);
  let dirty = false;
  let drag = null; // { kind: 'new' | 'move' | 'move-script', type, payload, ghost }
  let carry = null; // a reporter being dragged: { node, ghost }
  const madeVars = new Set(['my variable']);
  const madeLists = new Set(['my list']);
  const variables = () => [...new Set([...madeVars, ...namesIn(program, 'var')])].sort();
  const lists = () => [...new Set([...madeLists, ...namesIn(program, 'list')])].sort();

  const textChannels = server.channels.filter((c) => c.kind === 'text').sort((a, b) => a.position - b.position);
  const voiceChannels = server.channels.filter((c) => c.kind === 'voice').sort((a, b) => a.position - b.position);
  let admin = Boolean(bot.admin);
  const roleList = h('datalist', { id: `bb-roles-${bot.id}` }, (server.roles || []).filter((r) => !r.admin).map((r) => h('option', { value: r.name })));
  const canvas = h('div', { class: 'bb-canvas' }, roleList);
  const status = h('span', { class: 'bb-status' }, 'Saved');

  // --- undo, redo and saving on its own ---
  const history = [JSON.stringify(program)];
  let future = [];
  let snapTimer = null;
  let saveTimer = null;
  let saving = null;

  function snapshot() {
    clearTimeout(snapTimer);
    if (drag || carry) { snapTimer = setTimeout(snapshot, 400); return; }
    const now = JSON.stringify(program);
    if (history.at(-1) === now) return;
    history.push(now);
    if (history.length > 200) history.shift();
    future = [];
  }

  function markDirty() {
    dirty = true;
    status.textContent = 'Saving soon…';
    status.classList.add('dirty');
    clearTimeout(snapTimer);
    snapTimer = setTimeout(snapshot, 400);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(autosave, 1200);
  }

  function restore(json) {
    program = JSON.parse(json);
    dirty = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(autosave, 1200);
    status.textContent = 'Saving soon…';
    draw();
  }
  function undo() {
    snapshot();
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
    if (drag || carry) { saveTimer = setTimeout(autosave, 800); return; }
    if (!dirty) return;
    try {
      await save();
    } catch (err) {
      status.textContent = 'Not saved';
      toast(`Couldn't save: ${err.message}`);
    }
  }

  // --- paths: [scriptIndex, key, idx, key, idx, …, key] → the list of blocks at the end ---
  function listAt(path) {
    let node = program[path[0]];
    for (let i = 1; i < path.length - 1; i += 2) node = node[path[i]][path[i + 1]];
    return node[path.at(-1)];
  }

  // --- inputs ---
  const drops = new WeakMap(); // input element → { holder, key, kind }: where a dropped reporter goes
  const blockEls = new WeakMap(); // block row → its path
  const hatEls = new WeakMap(); // hat row → script index
  const repEls = new WeakMap(); // reporter → { node, from }
  const fit = (el, text, min = 2) => { el.style.width = `${Math.max(min, [...String(text)].length) + 1}ch`; };

  // A name picker for variables and lists, with the current name kept even if nothing else uses it.
  function namePicker(holder, part, names, live) {
    if (!holder[part.key]) holder[part.key] = names[0] || '';
    if (!live) return h('span', { class: 'bb-field fake select' }, holder[part.key]);
    const all = [...new Set([...names, holder[part.key]])];
    const el = h('select', { class: 'bb-field', onchange: () => { holder[part.key] = el.value; markDirty(); } },
      all.map((n) => h('option', { value: n, selected: n === holder[part.key] }, n)));
    return el;
  }

  // One input of a block or reporter. `live` is false in the palette and in drag ghosts.
  function inputView(holder, part, live) {
    const value = holder[part.key];
    if (SLOT_KINDS.includes(part.kind) && isReporter(value)) return reporterView(value, live, { holder, key: part.key, kind: part.kind });
    if (part.kind === 'bool') {
      const el = h('span', { class: 'bb-bool-slot' });
      if (live) drops.set(el, { holder, key: part.key, kind: 'bool' });
      return el;
    }
    // A variable or list block just shows its name, like Scratch.
    if ((part.kind === 'var' || part.kind === 'list') && (holder.r === 'var' || holder.r === 'list')) return h('span', { class: 'bb-word' }, holder.name);
    if (part.kind === 'var') return namePicker(holder, part, variables(), live);
    if (part.kind === 'list') return namePicker(holder, part, lists(), live);
    if (part.kind === 'select') {
      const current = part.options.find(([v]) => v === value) || part.options[0];
      if (!live) return h('span', { class: 'bb-field fake select' }, current[1]);
      const el = h('select', { class: 'bb-field', onchange: () => { holder[part.key] = el.value; markDirty(); draw(); } },
        part.options.map(([v, label]) => h('option', { value: v, selected: current[0] === v }, label)));
      return el;
    }
    if (part.kind === 'channel' || part.kind === 'voice') {
      const list = part.kind === 'voice' ? voiceChannels : textChannels;
      const name = list.find((c) => c.id === value)?.name;
      if (!live) return h('span', { class: 'bb-field fake select' }, name ? `#${name}` : part.here ? 'this channel' : 'channel');
      const el = h('select', { class: 'bb-field', onchange: () => { holder[part.key] = el.value; markDirty(); } },
        h('option', { value: '' }, part.here ? 'this channel' : 'pick a channel'),
        list.map((c) => h('option', { value: c.id, selected: value === c.id }, `${part.kind === 'voice' ? '🔊 ' : '#'}${c.name}`)));
      return el;
    }
    if (part.kind === 'color') {
      if (!live) return h('span', { class: 'bb-field fake', style: { background: value || '#fff', width: '22px', padding: 0 } });
      return colorField({ value, label: 'Colour', onChange: (c) => { holder[part.key] = c; markDirty(); } });
    }
    if (part.kind === 'lines') {
      const lines = Array.isArray(value) ? value : [];
      if (!live) return h('span', { class: 'bb-field fake' }, lines.join(', ') || '…');
      const el = h('textarea', {
        class: 'bb-field bb-lines', rows: Math.max(2, lines.length), placeholder: part.placeholder || 'one per line', value: lines.join('\n'),
        style: { width: `${Math.min(44, Math.max(14, ...lines.map((l) => l.length + 2)))}ch` },
        oninput: () => { holder[part.key] = el.value.split('\n'); el.rows = Math.max(2, holder[part.key].length); markDirty(); },
      });
      return el;
    }
    // text, number, secret, role, name: something typed (the first four also take reporters).
    const shown = value ?? '';
    if (!live) return h('span', { class: `bb-field fake${part.kind === 'number' ? ' number' : ''}` }, part.kind === 'secret' && shown ? '••••' : String(shown || part.placeholder || ' '));
    const el = h('input', {
      class: `bb-field${part.kind === 'number' ? ' number' : ''}`, value: shown, placeholder: part.placeholder || '',
      type: part.kind === 'secret' ? 'password' : 'text', inputMode: part.kind === 'number' ? 'decimal' : null,
      autocomplete: part.kind === 'secret' ? 'off' : null, spellcheck: false,
      list: part.kind === 'role' ? roleList.id : null,
      oninput: () => { holder[part.key] = el.value; fit(el, el.value || part.placeholder || '', part.kind === 'secret' ? 8 : 2); markDirty(); },
    });
    fit(el, shown || part.placeholder || '', part.kind === 'secret' ? 8 : 2);
    if (part.kind !== 'name') drops.set(el, { holder, key: part.key, kind: part.kind });
    return el;
  }

  function parts(holder, def, live) {
    return def.parts.map((part) => (typeof part === 'string'
      ? h('span', { class: 'bb-word' }, part)
      : part.hideWhen?.(holder) ? null : inputView(holder, part, live)));
  }

  // Takes a reporter out of its input, leaving the input empty.
  function pull(from) {
    delete from.holder[from.key];
    if (from.kind !== 'bool') from.holder[from.key] = '';
  }

  // A reporter, in a block's input (`from` says which) or in the palette.
  function reporterView(node, live, from = null) {
    const def = REPORTERS[node.r];
    if (!def) return h('span', { class: 'bb-field fake' }, '?');
    const el = h('div', { class: `bb-rep ${shapeOf(node)}`, style: tones(def.category) }, parts(node, def, live));
    if (live && from) {
      repEls.set(el, { node, from });
      el.addEventListener('contextmenu', (event) => {
        if (event.target.closest('.bb-rep') !== el) return;
        event.preventDefault();
        event.stopPropagation();
        showMenu(event, [
          { label: 'Duplicate', icon: 'copy', onClick: () => carryReporter(event, clone(node), { clickToDrop: true }) },
          { label: 'Copy', onClick: () => copy({ reporter: node }) },
          '-',
          { label: 'Delete', icon: 'trash', danger: true, onClick: () => { pull(from); markDirty(); draw(); } },
        ]);
      });
      // Dragging it pulls it out of the input, like Scratch.
      el.addEventListener('pointerdown', (event) => {
        if (event.target.closest('.bb-rep') !== el) return;
        afterNudge(event, (e) => {
          pull(from);
          markDirty();
          draw();
          carryReporter(e, node);
        });
      });
    }
    return el;
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
      if (!BLOCKS[block.type]?.cap) el.append(slot([...path, i + 1]));
    });
    return el;
  }

  function blockShell(def, type, row, extraClass = '') {
    const el = h('div', { class: `bb-block${def.hat ? ' hat' : ''}${def.mouths ? ' c' : ''}${def.cap ? ' cap' : ''}${extraClass}`, style: tones(def.category) }, row);
    for (const [i, mouth] of (def.mouths || []).entries()) {
      if (i > 0) el.append(h('div', { class: 'bb-row bb-else' }, h('span', { class: 'bb-word' }, 'else')));
      el.append(h('div', { class: 'bb-mouth', dataset: { mouth } }));
    }
    if (def.mouths) el.append(h('div', { class: 'bb-foot' }));
    return el;
  }

  function blockView(block, path) {
    const def = BLOCKS[block.type];
    if (!def) return h('div', { class: 'bb-block' }, h('div', { class: 'bb-row' }, h('span', { class: 'bb-word' }, `unknown block ${block.type}`)));
    const locked = catById[def.category].admin && !admin;
    const row = h('div', {
      class: 'bb-row', onpointerdown: (event) => grab(event, (e) => startMove(e, path)),
      oncontextmenu: (event) => blockMenu(event, path),
    }, parts(block, def, true));
    blockEls.set(row, path);
    const el = blockShell(def, block.type, row, locked ? ' locked' : '');
    if (locked) el.title = 'Turn on Admin for this block to run';
    for (const mouth of el.querySelectorAll(':scope > .bb-mouth')) mouth.append(stackView([...path, mouth.dataset.mouth]));
    return el;
  }

  // A script without a trigger is a loose stack: it sits on the canvas and doesn't run until a "when…" goes on top.
  function scriptView(script, index) {
    const el = h('div', { class: `bb-script${script.trigger ? '' : ' loose'}`, style: { left: `${script.x}px`, top: `${script.y}px` } });
    if (script.trigger) {
      const def = BLOCKS[script.trigger.type];
      const row = h('div', {
        class: 'bb-row', onpointerdown: (event) => grab(event, (e) => startMoveScript(e, index)),
        oncontextmenu: (event) => scriptMenu(event, index),
      }, parts(script.trigger, def, true));
      hatEls.set(row, index);
      el.append(blockShell(def, script.trigger.type, row));
    }
    el.append(stackView([index, 'blocks']));
    return el;
  }

  // --- right-click menus, copy and paste ---
  const inField = (event) => event.target.closest('input, select, textarea, .color-field');

  function copy(value) {
    writeClip(clone(value));
    toast('Copied. Press Ctrl+V on the canvas to paste.', 'ok');
  }

  // Delete one block; the blocks under it move up (a C block goes with what's inside it, like Scratch).
  function deleteBlock(path) {
    listAt(path.slice(0, -1)).splice(path.at(-1), 1);
    tidy();
    markDirty();
    draw();
  }

  function blockMenu(event, path) {
    if (inField(event) || event.target.closest('.bb-rep')) return;
    event.preventDefault();
    event.stopPropagation();
    const list = listAt(path.slice(0, -1));
    const stack = list.slice(path.at(-1));
    showMenu(event, [
      { label: 'Duplicate', icon: 'copy', onClick: () => pickUp(event, { kind: 'move', type: stack[0].type, payload: clone(stack) }) },
      { label: stack.length > 1 ? `Copy (${stack.length} blocks)` : 'Copy', onClick: () => copy({ blocks: stack }) },
      '-',
      { label: 'Delete block', icon: 'trash', danger: true, onClick: () => deleteBlock(path) },
      stack.length > 1 && { label: `Delete this and the ${stack.length - 1} below`, danger: true, onClick: () => { list.splice(path.at(-1)); tidy(); markDirty(); draw(); } },
    ]);
  }

  function scriptMenu(event, index) {
    if (inField(event)) return;
    event.preventDefault();
    event.stopPropagation();
    const script = program[index];
    showMenu(event, [
      { label: 'Duplicate', icon: 'copy', onClick: () => pickUp(event, { kind: 'script', type: script.trigger.type, payload: clone(script) }) },
      { label: 'Copy script', onClick: () => copy({ script }) },
      '-',
      { label: 'Delete script', icon: 'trash', danger: true, onClick: () => { program.splice(index, 1); markDirty(); draw(); } },
    ]);
  }

  function canvasMenu(event) {
    if (event.target !== canvas && event.target !== wrap) return;
    event.preventDefault();
    lastPointer = { x: event.clientX, y: event.clientY };
    const clip = readClip() || memoryClip;
    const count = JSON.stringify(program).split('"type":').length - 1;
    showMenu(event, [
      { label: 'Undo', icon: 'undo', onClick: undo },
      { label: 'Redo', onClick: redo },
      clip && !clip.reporter && { label: 'Paste', onClick: () => paste() },
      '-',
      { label: 'Clean up blocks', icon: 'scroll', onClick: cleanUp },
      count > 0 && { label: `Delete all ${count} blocks`, icon: 'trash', danger: true, confirm: true, onClick: () => { program = []; markDirty(); draw(); } },
    ]);
  }

  // Ctrl+V: a script or stack lands where the mouse is; a value block goes into the input under the mouse.
  let lastPointer = { x: 0, y: 0 };
  function paste() {
    const clip = readClip() || memoryClip;
    if (!clip) return;
    if (clip.reporter) {
      const el = targetAt(lastPointer.x, lastPointer.y, clip.reporter);
      if (!el) return toast('Point at an input, then paste the value block.');
      const spot = drops.get(el);
      spot.holder[spot.key] = clone(clip.reporter);
    } else {
      const box = canvas.getBoundingClientRect();
      const inside = document.elementFromPoint(lastPointer.x, lastPointer.y);
      const at = inside && wrap.contains(inside)
        ? { x: Math.max(0, Math.round((lastPointer.x - box.left) / zoom)), y: Math.max(0, Math.round((lastPointer.y - box.top) / zoom)) }
        : { x: 32, y: Math.max(0, ...[...canvas.querySelectorAll(':scope > .bb-script')].map((el) => el.offsetTop + el.offsetHeight)) + 40 };
      if (clip.script) program.push({ ...clone(clip.script), x: at.x, y: at.y });
      else if (clip.blocks?.length) program.push({ trigger: null, blocks: clone(clip.blocks), x: at.x, y: at.y });
    }
    markDirty();
    draw();
  }

  // What's under the mouse, for Ctrl+C and Delete.
  function hovered_() {
    const el = document.elementFromPoint(lastPointer.x, lastPointer.y);
    if (!el || !canvas.contains(el)) return null;
    const rep = el.closest('.bb-rep');
    if (rep && repEls.has(rep)) return { reporter: repEls.get(rep) };
    const row = el.closest('.bb-row');
    if (row && blockEls.has(row)) return { path: blockEls.get(row) };
    if (row && hatEls.has(row)) return { script: hatEls.get(row) };
    return null;
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

  // --- dragging blocks ---
  function ghostFor(type, payload) {
    const def = BLOCKS[type];
    const el = blockShell(def, type, h('div', { class: 'bb-row' }, parts(clone(payload), def, false)), ' bb-ghost');
    document.body.append(el);
    shapeBlock(el);
    return el;
  }

  // A duplicate follows the mouse until the next click, like Scratch.
  function pickUp(event, info) {
    begin({ clientX: event.clientX, clientY: event.clientY, preventDefault: () => {} }, { ...info, clickToDrop: true });
  }

  function begin(event, info) {
    event.preventDefault();
    const shown = info.kind === 'script' ? info.payload.trigger : info.payload[0] || info.payload;
    drag = { ...info, ghost: ghostFor(info.type, shown), offX: 12, offY: 12 };
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
    if (info.clickToDrop) setTimeout(() => window.addEventListener('pointerdown', end, { once: true, capture: true }), 0);
    else window.addEventListener('pointerup', end, { once: true });
  }

  // Nothing is picked up until the pointer has moved a few pixels, so clicking into a block is safe.
  function afterNudge(event, start) {
    if (event.button !== 0 || event.target.closest('input, select, textarea, .color-field')) return;
    event.stopPropagation();
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

  // Grabbing a block's row, unless the press was on a reporter inside it (that drags the reporter instead).
  function grab(event, start) {
    if (event.target.closest('.bb-rep')) return;
    afterNudge(event, start);
  }

  function startNew(event, type) {
    begin(event, { kind: 'new', type, payload: BLOCKS[type].make() });
  }

  function startMove(event, path) {
    // Takes the block and everything under it, like Scratch.
    const list = listAt(path.slice(0, -1));
    const taken = list.splice(path.at(-1));
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
      canvas.children[drag.index + 1].style.left = `${script.x}px`;
      canvas.children[drag.index + 1].style.top = `${script.y}px`;
      markDirty();
      return;
    }
    drag.ghost.style.left = `${event.clientX - drag.offX}px`;
    drag.ghost.style.top = `${event.clientY - drag.offY}px`;
    trash(event.clientX < wrap.getBoundingClientRect().left);
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
    if (drag.clickToDrop) { event.preventDefault(); event.stopPropagation(); }
    window.removeEventListener('pointermove', move);
    document.body.classList.remove('bb-dragging');
    trash(false);
    drag.ghost?.remove();
    const overPalette = event.clientX < wrap.getBoundingClientRect().left;
    if (drag.kind === 'script') {
      const at = !overPalette && dropPoint(event);
      if (at) { program.push({ ...drag.payload, x: at.x, y: at.y }); markDirty(); }
    } else if (drag.kind === 'move-script') {
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
      listAt(path.slice(0, -1)).splice(path.at(-1), 0, ...(drag.kind === 'new' ? [drag.payload] : drag.payload));
      markDirty();
    } else if (!overPalette && dropPoint(event)) {
      // Dropped on empty canvas: it stays there as a loose stack.
      const at = dropPoint(event);
      program.push({ trigger: null, blocks: drag.kind === 'new' ? [drag.payload] : drag.payload, x: at.x, y: at.y });
      markDirty();
    } else if (drag.kind === 'move') {
      markDirty(); // dropped on the palette: deleted
    }
    tidy();
    hovered?.classList.remove('active');
    hovered = null;
    drag = null;
    draw();
    snapshot();
  }

  // --- dragging reporters into inputs ---
  // A round block fits any input; a pointed (true/false) block fits pointed slots and inputs too.
  function targetAt(x, y, node) {
    let el = document.elementFromPoint(x, y);
    while (el && el !== canvas) {
      const spot = drops.get(el);
      if (spot && (spot.kind !== 'bool' || shapeOf(node) === BOOL)) return el;
      el = el.parentElement;
    }
    return null;
  }

  function carryReporter(event, node, { clickToDrop = false } = {}) {
    const ghost = reporterView(clone(node), false);
    ghost.classList.add('bb-ghost');
    document.body.append(ghost);
    carry = { node, ghost, target: null };
    document.body.classList.add('bb-dragging');
    const follow = (e) => {
      ghost.style.left = `${e.clientX - 10}px`;
      ghost.style.top = `${e.clientY - 14}px`;
      carry.target?.classList.remove('bb-drop-on');
      trash(e.clientX < wrap.getBoundingClientRect().left);
      carry.target = canvas.contains(document.elementFromPoint(e.clientX, e.clientY)) ? targetAt(e.clientX, e.clientY, node) : null;
      carry.target?.classList.add('bb-drop-on');
    };
    const drop = (e) => {
      if (clickToDrop) { e.preventDefault(); e.stopPropagation(); }
      window.removeEventListener('pointermove', follow);
      document.body.classList.remove('bb-dragging');
      trash(false);
      ghost.remove();
      const spot = carry.target && drops.get(carry.target);
      if (spot) {
        spot.holder[spot.key] = node;
        markDirty();
      }
      carry = null;
      draw();
      snapshot();
    };
    follow(event);
    window.addEventListener('pointermove', follow);
    if (clickToDrop) setTimeout(() => window.addEventListener('pointerdown', drop, { once: true, capture: true }), 0);
    else window.addEventListener('pointerup', drop, { once: true });
  }

  // --- canvas position, zoom and tidy-up ---
  let zoom = 1;
  function toCanvas(event) {
    const box = canvas.getBoundingClientRect();
    return { x: (event.clientX - box.left) / zoom, y: (event.clientY - box.top) / zoom };
  }
  function setZoom(value) {
    zoom = Math.min(Math.max(Math.round(value * 100) / 100, 0.4), 2);
    canvas.style.zoom = zoom;
  }
  function cleanUp() {
    let y = 32;
    [...canvas.querySelectorAll(':scope > .bb-script')].forEach((el, i) => {
      program[i].x = 32;
      program[i].y = y;
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
  const wrap = h('div', { class: 'bb-canvas-wrap', oncontextmenu: (e) => canvasMenu(e) }, canvas);
  // Drag empty space to move around; Ctrl+scroll (or pinch) zooms.
  wrap.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || (event.target !== canvas && event.target !== wrap)) return;
    const start = { x: event.clientX, y: event.clientY, left: wrap.scrollLeft, top: wrap.scrollTop };
    wrap.classList.add('panning');
    const pan = (e) => {
      wrap.scrollLeft = start.left - (e.clientX - start.x);
      wrap.scrollTop = start.top - (e.clientY - start.y);
    };
    window.addEventListener('pointermove', pan);
    window.addEventListener('pointerup', () => { window.removeEventListener('pointermove', pan); wrap.classList.remove('panning'); }, { once: true });
  });
  wrap.addEventListener('wheel', (event) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    setZoom(zoom * (event.deltaY < 0 ? 1.1 : 1 / 1.1));
  }, { passive: false });
  const track = (event) => {
    if (!canvas.isConnected) return window.removeEventListener('pointermove', track);
    lastPointer = { x: event.clientX, y: event.clientY };
  };
  window.addEventListener('pointermove', track, { passive: true });

  // Dropping onto the palette deletes: it shows a bin while something is held over it.
  const trashZone = h('div', { class: 'bb-trash', hidden: true }, icon('trash', 40));
  function trash(on) {
    trashZone.hidden = !on;
  }

  // --- palette ---
  const rail = h('nav', { class: 'bb-rail', 'aria-label': 'Block categories' });
  const palette = h('div', { class: 'bb-palette', onscroll: () => markRail() });
  const shown = () => CATEGORIES.filter((cat) => !cat.admin || admin);

  const drawRail = () => rail.replaceChildren(...shown().map((cat) => h('button', {
    type: 'button', class: 'bb-rail-item', dataset: { cat: cat.id },
    onclick: () => {
      if (search.value) { search.value = ''; filterPalette(); }
      palette.querySelector(`[data-cat="${cat.id}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    },
  }, h('span', { class: 'bb-rail-dot', style: { background: cat.colors[0], borderColor: cat.colors[2] } }), cat.label)));
  const markRail = () => {
    const top = palette.getBoundingClientRect().top;
    let current = null;
    for (const group of palette.querySelectorAll('.bb-group')) if (group.getBoundingClientRect().top - top < 60) current = group.dataset.cat;
    for (const item of rail.children) item.classList.toggle('active', item.dataset.cat === (current || rail.firstChild?.dataset.cat));
  };

  const paletteBlock = (type) => {
    const def = BLOCKS[type];
    return blockShell(def, type, h('div', { class: 'bb-row' }, parts(def.make(), def, false)), ' palette');
  };
  const paletteReporter = (node) => {
    const el = reporterView(node, false);
    el.classList.add('palette');
    el.addEventListener('pointerdown', (event) => afterNudge(event, (e) => carryReporter(e, clone(node))));
    return el;
  };

  // "Make a variable" / "Make a list": a box for the name; Enter adds it to the palette.
  function maker(label, set) {
    const input = h('input', { class: 'input bb-make-input', placeholder: 'name', maxLength: 40 });
    const holder = h('div', { class: 'bb-make' }, h('button', {
      type: 'button', class: 'button ghost small',
      onclick: () => { holder.replaceChildren(input); input.focus(); },
    }, label));
    const done = () => {
      const name = input.value.trim();
      if (name) { set.add(name); drawPalette(); } else holder.replaceChildren(holder.firstChild);
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(); if (e.key === 'Escape') { input.value = ''; done(); } });
    input.addEventListener('blur', done);
    return holder;
  }

  function groupItems(cat) {
    const blocks = Object.entries(BLOCKS).filter(([, def]) => def.category === cat.id && !def.legacy).map(([type]) => {
      const el = paletteBlock(type);
      el.addEventListener('pointerdown', (event) => afterNudge(event, (e) => startNew(e, type)));
      return el;
    });
    if (cat.id === 'variables') return [maker('Make a variable', madeVars), ...variables().map((n) => paletteReporter(REPORTERS.var.make(n))), ...blocks];
    if (cat.id === 'lists') {
      const first = lists()[0];
      return [maker('Make a list', madeLists), ...lists().map((n) => paletteReporter(REPORTERS.list.make(n))), ...blocks,
        ...LIST_REPORTERS.map((r) => paletteReporter(REPORTERS[r].make(first)))];
    }
    return [...blocks, ...(REPORTER_ORDER[cat.id] || []).map((r) => paletteReporter(REPORTERS[r].make()))];
  }

  // Search: shows only the blocks whose words match.
  const search = h('input', {
    class: 'input bb-search', type: 'search', placeholder: 'Search blocks', spellcheck: false,
    oninput: () => filterPalette(),
  });
  function filterPalette() {
    const words = search.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    for (const group of palette.querySelectorAll('.bb-group')) {
      let any = false;
      for (const item of group.children) {
        if (item.classList.contains('bb-group-title')) continue;
        const text = item.textContent.toLowerCase();
        const show = !words.length || words.every((w) => text.includes(w));
        item.hidden = !show;
        any ||= show;
      }
      group.hidden = !any;
    }
    shapeAll(palette);
  }

  function drawPalette() {
    const scroll = palette.scrollTop;
    palette.replaceChildren(h('div', { class: 'bb-search-wrap' }, search), ...shown().map((cat) => h('div', { class: 'bb-group', dataset: { cat: cat.id } },
      h('div', { class: 'bb-group-title' }, cat.label), groupItems(cat))));
    shapeAll(palette);
    if (search.value) filterPalette();
    palette.scrollTop = scroll;
  }
  drawPalette();
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
    if (saving) return saving.then(() => (dirty ? save() : null));
    clearTimeout(saveTimer);
    const sent = JSON.stringify(program);
    status.textContent = 'Saving…';
    saving = api.patch(`/api/servers/${server.id}/bots/${bot.id}`, { program: JSON.parse(sent) })
      .finally(() => { saving = null; });
    const updated = await saving;
    bot.program = updated.program;
    if (JSON.stringify(program) === sent) {
      dirty = false;
      status.textContent = 'Saved';
      status.classList.remove('dirty');
    }
  }

  // Ctrl+S save, Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y undo and redo, Ctrl+C / Ctrl+V / Ctrl+D copy, paste and
  // duplicate what's under the mouse, Delete removes it. Typing in a box keeps its own keys.
  const keys = (event) => {
    if (!canvas.isConnected) return window.removeEventListener('keydown', keys);
    const mod = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    if (mod && key === 's') { event.preventDefault(); attempt(save); return; }
    if (event.target.closest?.('input, textarea, select, [contenteditable]')) return;
    if (mod && key === 'z') { event.preventDefault(); if (event.shiftKey) redo(); else undo(); return; }
    if (mod && key === 'y') { event.preventDefault(); redo(); return; }
    if (mod && key === 'v') { event.preventDefault(); paste(); return; }
    const under = hovered_();
    if (!under) return;
    const stackAt = (path) => listAt(path.slice(0, -1)).slice(path.at(-1));
    if (mod && key === 'c') {
      event.preventDefault();
      if (under.reporter) copy({ reporter: under.reporter.node });
      else if (under.path) copy({ blocks: stackAt(under.path) });
      else copy({ script: program[under.script] });
    } else if (mod && key === 'd') {
      event.preventDefault();
      const at = { clientX: lastPointer.x, clientY: lastPointer.y };
      if (under.reporter) carryReporter(at, clone(under.reporter.node), { clickToDrop: true });
      else if (under.path) { const stack = stackAt(under.path); pickUp(at, { kind: 'move', type: stack[0].type, payload: clone(stack) }); }
      else pickUp(at, { kind: 'script', type: program[under.script].trigger.type, payload: clone(program[under.script]) });
    } else if (key === 'delete' || key === 'backspace') {
      event.preventDefault();
      if (under.reporter) { pull(under.reporter.from); markDirty(); draw(); }
      else if (under.path) deleteBlock(under.path);
      else { program.splice(under.script, 1); markDirty(); draw(); }
    }
  };
  window.addEventListener('keydown', keys);

  return {
    side: h('div', { class: 'bb-side' }, rail, palette, trashZone),
    stage: h('div', { class: 'bb-stage' }, wrap, controls),
    status,
    adminToggle,
    mounted() {
      draw();
      shapeAll(palette);
      markRail();
    },
    flush: () => (dirty ? save() : Promise.resolve()),
  };
}
