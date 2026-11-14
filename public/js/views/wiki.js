// A wiki channel: pages written in the same Markdown as messages, that anyone can edit. [[Page title]]
// links to another page (or offers to make it). Every save keeps the old version in the page's history.
// The open page is part of the address (/channels/<server>/<channel>/<pageId>), so links and Back work.
import * as api from '../api.js';
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { state, on, canModerate } from '../store.js';
import { navigate, paths, showNav } from '../router.js';
import { formatStamp, renderMarkdown } from '../format.js';
import { attempt, button, confirmButton, iconButton, toast } from '../ui.js';
import { openPage } from './page.js';
import { ensureMembers } from './members.js';

let view = null; // { root, channel, serverId, pages: Map(id → summary), full: Map(id → page), query, editing, loaded }

export function closeWiki() {
  view = null;
}

const canWrite = () => !view.channel.readOnly || canModerate(view.serverId);
const byTitle = (title) => [...view.pages.values()].find((p) => p.title.toLowerCase() === title.trim().toLowerCase());
const openPageId = () => state.route.postId;
const go = (pageId) => navigate(pageId ? paths.post(view.serverId, view.channel.id, pageId) : paths.channel(view.serverId, view.channel.id));

// Turns [[Title]] in the rendered page into links (text nodes only, so nothing typed becomes HTML).
function linkPages(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) if (walker.currentNode.nodeValue.includes('[[')) nodes.push(walker.currentNode);
  for (const node of nodes) {
    const parts = node.nodeValue.split(/\[\[([^\]\n]{1,100})\]\]/);
    if (parts.length === 1) continue;
    node.replaceWith(...parts.map((part, i) => {
      if (i % 2 === 0) return part;
      const target = byTitle(part);
      return h('button', {
        type: 'button', class: `wiki-link${target ? '' : ' missing'}`, title: target ? part : `Make the page "${part}"`,
        onclick: () => (target ? go(target.id) : canWrite() && newPage(part)),
      }, part);
    }));
  }
  return root;
}

function newPage(title = '') {
  view.editing = { id: null, title, content: '' };
  if (openPageId()) go(null);
  else render();
}

// --- the list of pages ---

function pageList() {
  const search = h('input', {
    class: 'input', type: 'search', placeholder: 'Search pages', value: view.query, 'aria-label': 'Search pages',
    oninput: () => { view.query = search.value; drawItems(); },
  });
  const items = h('div', { class: 'wiki-items' });
  const drawItems = () => {
    const q = view.query.trim().toLowerCase();
    const pages = [...view.pages.values()].filter((p) => !q || p.title.toLowerCase().includes(q))
      .sort((a, b) => a.title.localeCompare(b.title));
    items.replaceChildren(...(pages.length ? pages.map((p) => h('button', {
      type: 'button', class: `wiki-item${p.id === openPageId() ? ' active' : ''}`, onclick: () => go(p.id),
    }, icon('file', 15), h('span', {}, p.title))) : [h('p', { class: 'muted wiki-none' }, view.loaded ? (q ? 'No pages match.' : 'No pages yet.') : 'Loading…')]));
  };
  drawItems();
  return h('nav', { class: 'wiki-nav' }, h('div', { class: 'wiki-nav-top' }, search,
    canWrite() && iconButton('plus', 'New page', () => newPage())), items);
}

// --- one page ---

function pageView(pageId) {
  const summary = view.pages.get(pageId);
  const page = view.full.get(pageId);
  if (!summary) return h('div', { class: 'empty-state small' }, h('strong', {}, view.loaded ? 'That page is gone.' : 'Loading…'));
  if (!page) {
    api.get(`/api/channels/${view.channel.id}/pages/${pageId}`).then((p) => { view.full.set(p.id, p); render(); }).catch((err) => toast(err.message));
    return h('div', { class: 'empty-state small' }, h('strong', {}, 'Loading…'));
  }
  const editor = state.users.get(page.updatedBy);
  return h('article', { class: 'wiki-page' },
    h('div', { class: 'wiki-page-head' },
      h('div', {}, h('h1', {}, page.title),
        h('p', { class: 'wiki-meta' }, `Edited ${formatStamp(page.updatedAt)}${editor ? ` by ${editor.displayName}` : ''}`)),
      h('div', { class: 'wiki-actions' },
        iconButton('history', 'History', () => openHistory(page)),
        canWrite() && button('Edit', () => { view.editing = { ...page }; render(); }, 'ghost small'),
        canModerate(view.serverId) && confirmButton({
          label: 'Delete page', confirmLabel: 'Delete?', face: icon('trash'), className: 'icon-button danger',
          onConfirm: async () => { await api.del(`/api/channels/${view.channel.id}/pages/${page.id}`); go(null); },
        }))),
    page.content.trim()
      ? linkPages(h('div', { class: 'message-content wiki-body' }, renderMarkdown(page.content)))
      : h('p', { class: 'muted' }, 'This page is empty.'));
}

function editorView() {
  const draft = view.editing;
  const title = h('input', { class: 'input wiki-title-input', maxLength: 100, value: draft.title, placeholder: 'Page title', 'aria-label': 'Page title' });
  const body = h('textarea', {
    class: 'textarea wiki-textarea', maxLength: 50_000, value: draft.content, spellcheck: true,
    placeholder: '# A heading\n\nWrite with **Markdown**, the same as in chat. Link to another page with [[Its title]].',
    'aria-label': 'Page text',
  });
  const preview = h('div', { class: 'message-content wiki-body wiki-preview', hidden: true });
  const tabs = h('div', { class: 'segmented' }, [['write', 'Write'], ['preview', 'Preview']].map(([id, label]) => h('button', {
    type: 'button', 'aria-pressed': String(id === 'write'),
    onclick: (event) => {
      for (const b of tabs.children) b.setAttribute('aria-pressed', String(b === event.currentTarget));
      const showing = id === 'preview';
      body.hidden = showing;
      preview.hidden = !showing;
      if (showing) preview.replaceChildren(linkPages(h('div', {}, renderMarkdown(body.value || '*Nothing yet.*'))));
    },
  }, label)));
  const save = h('button', { type: 'button', class: 'button accent small' }, draft.id ? 'Save' : 'Create page');
  save.addEventListener('click', () => {
    if (!title.value.trim()) { title.focus(); return; }
    save.disabled = true;
    attempt(async () => {
      const payload = { title: title.value, content: body.value };
      const saved = draft.id
        ? await api.put(`/api/channels/${view.channel.id}/pages/${draft.id}`, payload)
        : await api.post(`/api/channels/${view.channel.id}/pages`, payload);
      view.full.set(saved.id, saved);
      view.pages.set(saved.id, saved);
      view.editing = null;
      if (openPageId() === saved.id) render();
      else go(saved.id);
    }).finally(() => { save.disabled = false; });
  });
  setTimeout(() => (draft.title ? body : title).focus());
  return h('div', { class: 'wiki-editor' },
    title,
    h('div', { class: 'wiki-editor-bar' }, tabs, h('span', { class: 'main-spacer' }),
      button('Cancel', () => { view.editing = null; render(); }, 'ghost small'), save),
    body, preview);
}

function openHistory(page) {
  const list = h('div', { class: 'card-list' }, h('p', { class: 'loading' }, 'Loading…'));
  const historyPage = openPage({ title: `History of ${page.title}`, content: h('div', { class: 'settings-content' }, list) });
  api.get(`/api/channels/${view.channel.id}/pages/${page.id}/history`).then((revisions) => {
    list.replaceChildren(...(revisions.length ? revisions.map((r) => {
      const who = state.users.get(r.userId);
      return h('article', { class: 'message-card' },
        h('div', { class: 'message-card-head' }, h('strong', {}, who?.displayName || 'Someone'),
          h('time', { class: 'message-stamp' }, formatStamp(r.createdAt)),
          canWrite() && h('button', {
            type: 'button', class: 'jump',
            onclick: () => attempt(async () => {
              const saved = await api.put(`/api/channels/${view.channel.id}/pages/${page.id}`, { title: r.title, content: r.content });
              view.full.set(saved.id, saved);
              historyPage.close();
              render();
              toast('Restored that version.', 'ok');
            }),
          }, 'Restore')),
        h('div', { class: 'message-card-text' }, r.content.slice(0, 600) || '(empty)'));
    }) : [h('p', { class: 'muted' }, 'No earlier versions yet.')]));
  }).catch((err) => toast(err.message));
}

function render() {
  if (!view?.root.isConnected) return;
  // Don't throw away what someone is typing.
  if (view.root.querySelector('.wiki-editor') && view.editing) return;
  const { channel } = view;
  const pageId = openPageId();
  const main = view.editing ? editorView()
    : pageId ? pageView(pageId)
      : h('div', { class: 'empty-state small wiki-welcome' }, h('span', { class: 'empty-icon' }, icon('book', 26)),
        h('strong', {}, channel.name), h('span', {}, view.pages.size ? 'Pick a page, or start a new one.' : 'No pages yet.'),
        canWrite() && button('New page', () => newPage(), 'accent small'));
  view.root.replaceChildren(
    h('header', { class: 'main-header' },
      pageId || view.editing
        ? iconButton('back', 'All pages', () => { view.editing = null; if (pageId) go(null); else render(); }, 'wiki-back')
        : iconButton('back', 'Back', () => showNav(), 'back-button'),
      h('div', { class: 'main-title' }, icon('book', 18), h('span', {}, channel.name)),
      channel.topic ? h('div', { class: 'main-topic', title: channel.topic }, channel.topic) : h('div', { class: 'main-spacer' })),
    h('div', { class: `wiki-layout${pageId || view.editing ? ' reading' : ''}` }, pageList(), h('div', { class: 'page-scroll wiki-main' }, main)));
}

on('wiki:update', (summary) => {
  if (summary.channelId !== view?.channel.id) return;
  view.pages.set(summary.id, summary);
  const full = view.full.get(summary.id);
  if (full && full.updatedAt !== summary.updatedAt) view.full.delete(summary.id); // fetched again when shown
  render();
});
on('wiki:delete', ({ channelId, id }) => {
  if (channelId !== view?.channel.id) return;
  view.pages.delete(id);
  view.full.delete(id);
  render();
});
on('users members', () => view && render());

export async function showWiki(container, channel, serverId) {
  if (view?.channel.id === channel.id && view.root === container && container.isConnected) {
    view.channel = channel;
    // Moving to another page (or the list) closes an editor that was for somewhere else.
    if (view.editing && (view.editing.id || null) !== (openPageId() || null)) view.editing = null;
    if (!view.editing) view.root.querySelector('.wiki-editor')?.remove();
    return render();
  }
  view = { root: container, channel, serverId, pages: new Map(), full: new Map(), query: '', editing: null, loaded: false };
  ensureMembers(serverId);
  render();
  const pages = await api.get(`/api/channels/${channel.id}/pages`).catch(() => []);
  if (view?.channel.id !== channel.id) return undefined;
  for (const p of pages) view.pages.set(p.id, p);
  view.loaded = true;
  return render();
}
