// The app's language (Settings → Appearance → Language). The interface is written in English; any other language
// is translated on the fly through the same translation service messages use, and remembered in this browser so
// it's instant next time. What people wrote (messages, names, song titles…) is never touched, only the app's own
// words: text, placeholders, tooltips and labels. Mark anything else to skip with data-no-translate.

import { translate } from './translate.js';
import { state, on } from './store.js';

const SKIP = [
  'script', 'style', 'code', 'pre', 'textarea', 'input', '[contenteditable]', '[data-no-translate]', '.dd-native',
  '.message-content', '.message-author', '.message-text', '.typing', '.member', '.friend', '.profile-names', '.username',
  '.auth-art', '.music-page .queue-title', '.music-title', '.main-header .main-title:has(svg)', '.nav-item', '.avatar', '.emoji',
  '.author-name', '.user-panel-names', '.sidebar-title', '.rail', '.member-name', '.music-page', '.server-name',
].join(',');
const ATTRS = ['placeholder', 'title', 'aria-label'];

let lang = 'en';
let observer = null;
const originals = new WeakMap(); // text node → its English text
const attrOriginals = new WeakMap(); // element → { attr: English }
const cacheKey = (l) => `opencord:ui-lang:${l}`;
let memory = {}; // English → translated, for the current language

function load(l) {
  try { memory = JSON.parse(localStorage.getItem(cacheKey(l))) || {}; } catch { memory = {}; }
}
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { try { localStorage.setItem(cacheKey(lang), JSON.stringify(memory)); } catch { /* full or blocked */ } }, 1000);
}

const worth = (text) => /\p{L}{2,}/u.test(text) && text.length < 400;
const skipped = (el) => !el || el.closest?.(SKIP);

// English → translated, keeping the spaces around it (they matter between inline pieces).
async function translated(english) {
  const core = english.trim();
  if (!worth(core)) return null;
  if (!(core in memory)) {
    const result = await translate(core, lang, 'en').catch(() => null);
    if (!result?.text) return null;
    memory[core] = result.text;
    save();
  }
  return english.replace(core, memory[core]);
}

async function doText(node) {
  if (skipped(node.parentElement)) return;
  let english = originals.get(node);
  // A node the app changed since (or never seen): its current text is the new English.
  if (english === undefined || (node.data !== english && node.data !== node.ocTranslated)) {
    english = node.data;
    originals.set(node, english);
  }
  const want = lang;
  const out = await translated(english);
  if (out && want === lang && originals.get(node) === english && node.data !== out) {
    node.ocTranslated = out;
    node.data = out;
  }
}

async function doAttrs(el) {
  const field = el.matches?.('input, textarea');
  if (field ? skipped(el.parentElement) : skipped(el)) return;
  if (el.closest?.('[data-no-translate]')) return;
  const saved = attrOriginals.get(el) || {};
  for (const attr of ATTRS) {
    const value = el.getAttribute(attr);
    if (!value) continue;
    if (saved[attr] === undefined || (value !== saved[attr] && value !== saved[`${attr}:t`])) saved[attr] = value;
    attrOriginals.set(el, saved);
    const english = saved[attr];
    const out = await translated(english);
    if (out && lang !== 'en' && saved[attr] === english && el.getAttribute(attr) !== out) {
      saved[`${attr}:t`] = out;
      el.setAttribute(attr, out);
    }
  }
}

function walk(root) {
  if (root.nodeType === 3) return doText(root);
  if (root.nodeType !== 1) return undefined;
  if (root.matches('input, textarea')) return doAttrs(root);
  if (skipped(root)) return undefined;
  doAttrs(root);
  const tree = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    // Text boxes are skipped for their contents, but their placeholder and label still get translated.
    acceptNode: (n) => (n.nodeType === 1 && skipped(n) && !n.matches('input, textarea') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let n = tree.nextNode(); n; n = tree.nextNode()) {
    if (n.nodeType === 3) doText(n);
    else doAttrs(n);
  }
  return undefined;
}

// Puts every translated piece back to English.
function restore(root = document.body) {
  const tree = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let n = tree.currentNode; n; n = tree.nextNode()) {
    if (n.nodeType === 3) {
      const english = originals.get(n);
      if (english !== undefined && n.data === n.ocTranslated) n.data = english;
    } else {
      const saved = attrOriginals.get(n);
      if (saved) for (const attr of ATTRS) if (saved[attr] !== undefined && n.getAttribute(attr) === saved[`${attr}:t`]) n.setAttribute(attr, saved[attr]);
    }
  }
}

let pending = new Set();
let flushTimer = null;
function queue(node) {
  pending.add(node);
  if (!flushTimer) flushTimer = setTimeout(() => {
    flushTimer = null;
    const nodes = pending;
    pending = new Set();
    for (const n of nodes) if (n.isConnected) walk(n);
  }, 50);
}

export function setUiLanguage(next = 'en') {
  next = next || 'en';
  if (next === lang) return;
  if (lang !== 'en') restore();
  lang = next;
  document.documentElement.lang = lang;
  observer?.disconnect();
  observer = null;
  if (lang === 'en') return;
  load(lang);
  walk(document.body);
  observer = new MutationObserver((changes) => {
    for (const c of changes) {
      if (c.type === 'characterData') { if (c.target.data !== c.target.ocTranslated) queue(c.target); }
      else if (c.type === 'attributes') queue(c.target);
      else c.addedNodes.forEach(queue);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
}

on('me', () => setUiLanguage(state.me?.settings?.uiLanguage));
