// A posts channel: a list of posts (a title, who started it, the start of the first message, how many
// replies), newest activity first, and a box to start a new one. Opening a post shows it as its own chat.
import * as api from '../api.js';
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { state, on, can, canPostIn } from '../store.js';
import { navigate, paths, showNav } from '../router.js';
import { formatStamp } from '../format.js';
import { attempt, avatar, button, iconButton, pickFiles, toast } from '../ui.js';
import { startUpload } from '../upload.js';
import { MESSAGE_MAX } from './composer.js';

let view = null; // { root, channel, serverId, loaded, query, drafting }

export function closePosts() {
  view = null;
}

function postCard(post) {
  const author = state.users.get(post.authorId) || { id: post.authorId, displayName: 'Someone' };
  return h('button', {
    type: 'button', class: 'post-card',
    onclick: () => navigate(paths.post(view.serverId, view.channel.id, post.id)),
  },
  h('div', { class: 'post-card-main' },
    h('h3', { class: 'post-title' }, post.title),
    post.preview && h('p', { class: 'post-preview' }, post.preview),
    h('div', { class: 'post-meta' }, avatar(author, { size: 18 }), h('span', { class: 'post-author' }, author.displayName),
      h('span', {}, '·'), h('span', {}, formatStamp(post.createdAt)),
      h('span', { class: 'post-replies' }, icon('message', 14), String(post.replies || 0)))),
  post.image && h('img', { class: 'post-thumb', src: post.image, alt: '', loading: 'lazy' }));
}

// The "new post" box: a title, the first message and optional files.
function draftBox() {
  const files = []; // { name, upload: { promise, cancel }, attachment }
  const title = h('input', { class: 'input post-draft-title', maxLength: 100, placeholder: 'Title', 'aria-label': 'Post title' });
  const body = h('textarea', { class: 'textarea', maxLength: MESSAGE_MAX, rows: 4, placeholder: 'Say something about it…', 'aria-label': 'Post text' });
  const fileList = h('div', { class: 'post-draft-files' });
  const submit = h('button', { type: 'submit', class: 'button accent small' }, 'Post');

  const drawFiles = () => fileList.replaceChildren(...files.map((f) => h('span', { class: 'role-chip' }, icon('paperclip', 13),
    h('span', {}, f.attachment ? f.name : `${f.name}…`),
    h('button', { type: 'button', class: 'role-chip-x', 'aria-label': `Remove ${f.name}`, onclick: () => { f.upload.cancel(); files.splice(files.indexOf(f), 1); drawFiles(); } }, icon('x', 12)))));
  const addFiles = async () => {
    for (const file of await pickFiles({ multiple: true })) {
      const entry = { name: file.name, upload: startUpload(file, () => {}), attachment: null };
      files.push(entry);
      entry.upload.promise.then((a) => { entry.attachment = a; drawFiles(); }).catch((err) => { toast(err.message); files.splice(files.indexOf(entry), 1); drawFiles(); });
    }
    drawFiles();
  };

  const el = h('form', {
    class: 'post-draft',
    onsubmit: (event) => {
      event.preventDefault();
      if (!title.value.trim()) return title.focus();
      submit.disabled = true;
      attempt(async () => {
        const attachments = await Promise.all(files.map((f) => f.upload.promise));
        const post = await api.post(`/api/channels/${view.channel.id}/posts`, {
          title: title.value, content: body.value, attachmentIds: attachments.map((a) => a.id),
        });
        state.posts.set(post.id, post);
        view.drafting = false;
        navigate(paths.post(view.serverId, view.channel.id, post.id));
      }).finally(() => { submit.disabled = false; });
    },
  }, title, body, fileList,
  h('div', { class: 'post-draft-actions' },
    iconButton('paperclip', 'Attach files', addFiles),
    h('span', { class: 'main-spacer' }),
    h('button', { type: 'button', class: 'button ghost small', onclick: () => { view.drafting = false; render(); } }, 'Cancel'),
    submit));
  setTimeout(() => title.focus());
  return el;
}

function render() {
  if (!view?.root.isConnected) return;
  const { channel } = view;
  const all = [...state.posts.values()].filter((p) => p.parentId === channel.id)
    .sort((a, b) => ((b.lastMessageId || b.id) > (a.lastMessageId || a.id) ? 1 : -1));
  const canPost = canPostIn(view.serverId, channel);

  const search = h('input', {
    type: 'search', placeholder: 'Search posts', value: view.query, 'aria-label': 'Search posts',
    oninput: () => { view.query = search.value; drawList(); },
  });
  const list = h('div', { class: 'post-list' });
  const drawList = () => {
    const query = view.query.trim().toLowerCase();
    const items = query ? all.filter((p) => `${p.title} ${p.preview}`.toLowerCase().includes(query)) : all;
    list.replaceChildren(...(items.length ? items.map(postCard) : [h('div', { class: 'empty-state small' },
      h('span', { class: 'empty-icon' }, icon('posts', 24)),
      h('strong', {}, !view.loaded ? 'Loading…' : query ? 'No posts match' : 'No posts yet'),
      view.loaded && !query && canPost && h('span', {}, 'Start the first one.'))]));
  };
  drawList();

  view.root.replaceChildren(
    h('header', { class: 'main-header' },
      iconButton('back', 'Back', () => showNav(), 'back-button'),
      h('div', { class: 'main-title' }, icon('posts', 18), h('span', {}, channel.name)),
      channel.topic ? h('div', { class: 'main-topic', title: channel.topic }, channel.topic) : h('div', { class: 'main-spacer' }),
      canPost && !view.drafting && button('New post', () => { view.drafting = true; render(); }, 'accent small')),
    h('div', { class: 'page-scroll' }, h('div', { class: 'posts-page' },
      h('div', { class: 'posts-top' }, h('label', { class: 'search-field' }, icon('search', 16), search)),
      view.drafting && draftBox(),
      list)));
}

on('posts users members', () => {
  if (view && !view.root.querySelector('.post-draft')) render();
});

export async function showPosts(container, channel, serverId) {
  const same = view?.channel.id === channel.id && view.root === container && container.isConnected;
  if (!same) view = { root: container, channel, serverId, loaded: false, query: '', drafting: false };
  else view.channel = channel;
  if (!same || !view.root.querySelector('.post-draft')) render();
  if (same && view.loaded) return;
  const posts = await api.get(`/api/channels/${channel.id}/posts`).catch(() => []);
  if (view?.channel.id !== channel.id) return;
  for (const post of posts) state.posts.set(post.id, post);
  const missing = posts.map((p) => p.authorId).filter((id) => !state.users.has(id));
  if (missing.length && serverId) (await import('./members.js')).ensureMembers(serverId);
  view.loaded = true;
  if (!view.root.querySelector('.post-draft')) render();
}

// A single post, opened from the list: fetched if it isn't known yet.
export async function loadPost(postId) {
  if (state.posts.has(postId)) return state.posts.get(postId);
  const post = await api.get(`/api/channels/${postId}`).catch(() => null);
  if (post?.kind !== 'post') return null;
  state.posts.set(post.id, post);
  return post;
}
