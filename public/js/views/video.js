// A video channel, laid out like a video site: a search bar, topic chips, a grid of videos, and a watch page
// with the player and "Up next". Home fills itself with videos found on YouTube; the Library tab holds what
// people in the channel saved (YouTube links and uploaded files). You can also play a file from your device.
import * as api from '../api.js';
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { state, on, can, canPostIn } from '../store.js';
import { showNav } from '../router.js';
import { attempt, avatar, emptyList, iconButton, pickFiles, toast } from '../ui.js';
import { startUpload } from '../upload.js';
import { remote } from '../fun.js';
import { formatSize } from '../format.js';
import { ensureMembers } from './members.js';

const TOPICS = ['Music', 'Gaming', 'Comedy', 'Science', 'Animals', 'Cooking', 'Tech', 'Sports', 'Movies', 'Minecraft', 'Lofi', 'Space', 'Art', 'Travel'];
// Searches that make a nice random home page.
const SEEDS = ['funny videos', 'music video', 'minecraft', 'science explained', 'cute animals', 'cooking recipe', 'tech review', 'space documentary',
  'lofi hip hop', 'speedrun', 'satisfying video', 'travel vlog', 'animation short film', 'street food', 'retro games', 'nature 4k', 'stand up comedy', 'how it\'s made'];

let view = null; // { root, channel, serverId, tab, query, results, library, watching, local }

const thumb = (id) => remote(`https://i.ytimg.com/vi/${id}/mqdefault.jpg`);
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const shuffle = (list) => list.map((v) => [Math.random(), v]).sort((a, b) => a[0] - b[0]).map(([, v]) => v);

export function closeVideo() {
  if (view?.local) URL.revokeObjectURL(view.local.url);
  view = null;
}

async function search(query) {
  return api.get(`/api/fun/youtube?q=${encodeURIComponent(query)}`);
}

// Home: two random searches mixed together (or the channel topic, if it has one), so each visit is different.
async function loadHome() {
  const v = view;
  v.results = null;
  render();
  const seeds = v.channel.topic ? [v.channel.topic, pick(SEEDS)] : shuffle(SEEDS).slice(0, 2);
  try {
    const lists = await Promise.all(seeds.map((q) => search(q).catch(() => [])));
    if (view !== v) return;
    const seen = new Set();
    v.results = shuffle(lists.flat()).filter((x) => !seen.has(x.id) && seen.add(x.id)).map(fromResult);
  } catch (err) {
    v.results = [];
    toast(err.message);
  }
  render();
}

async function runSearch(query) {
  const v = view;
  v.tab = 'search';
  v.query = query;
  v.watching = null;
  v.results = null;
  render();
  try {
    const results = await search(query);
    if (view === v && v.query === query) v.results = results.map(fromResult);
  } catch (err) {
    if (view === v) { v.results = []; toast(err.message); }
  }
  render();
}

function watch(item) {
  view.watching = item;
  view.related = null;
  render();
  view.body.scrollTop = 0;
  // Up next: more from the same uploader, then things with a similar title.
  if (item.kind === 'youtube') {
    const v = view;
    const words = item.title.replace(/[^\p{L}\p{N} ]+/gu, ' ').split(/\s+/).filter((w) => w.length > 2).slice(0, 4).join(' ');
    Promise.all([item.author && search(item.author).catch(() => []), words && search(words).catch(() => [])].filter(Boolean)).then((lists) => {
      if (view !== v || v.watching !== item) return;
      const seen = new Set([item.source]);
      v.related = lists.flat().filter((x) => !seen.has(x.id) && seen.add(x.id)).slice(0, 20);
      render();
    });
  } else {
    view.related = [];
  }
}

const fromResult = (r) => ({ kind: 'youtube', source: r.id, title: r.title, author: r.author, views: r.views, published: r.published, length: r.length });

// --- adding things ---

function canAdd() {
  return canPostIn(view.serverId, view.channel);
}

function saveYoutube(item) {
  return attempt(async () => {
    await api.post(`/api/channels/${view.channel.id}/videos`, { url: `https://www.youtube.com/watch?v=${item.source}`, title: item.title, author: item.author || '' });
    toast('Saved to the channel library.', 'ok');
  });
}

function addLink(url) {
  return attempt(async () => {
    const saved = await api.post(`/api/channels/${view.channel.id}/videos`, { url });
    watch(saved);
  });
}

async function uploadVideo() {
  const [file] = await pickFiles({ accept: 'video/*' });
  if (!file) return;
  const v = view;
  v.uploading = { name: file.name, fraction: 0, size: file.size };
  render();
  const task = startUpload(file, (fraction) => {
    v.uploading.fraction = fraction;
    const bar = v.root.querySelector('.video-upload-fill');
    if (bar) bar.style.width = `${fraction * 100}%`;
  });
  try {
    const attachment = await task.promise;
    const saved = await api.post(`/api/channels/${v.channel.id}/videos`, { attachmentId: attachment.id, title: file.name.replace(/\.[a-z0-9]+$/i, '') });
    if (view === v) { v.uploading = null; v.tab = 'library'; watch(saved); }
  } catch (err) {
    toast(err.message);
    if (view === v) { v.uploading = null; render(); }
  }
}

async function playLocal() {
  const [file] = await pickFiles({ accept: 'video/*,audio/*' });
  if (!file) return;
  if (view.local) URL.revokeObjectURL(view.local.url);
  view.local = { url: URL.createObjectURL(file), name: file.name };
  watch({ kind: 'local', source: view.local.url, title: file.name.replace(/\.[a-z0-9]+$/i, ''), author: 'From this device' });
}

// --- drawing ---

function card(item, { compact = false } = {}) {
  const isYoutube = item.kind === 'youtube';
  const adder = item.addedBy && state.users.get(item.addedBy);
  const art = isYoutube
    ? h('img', { src: thumb(item.source), alt: '', loading: 'lazy' })
    : h('span', { class: 'video-file-art' }, icon('video', compact ? 22 : 34));
  return h('button', { type: 'button', class: `video-card${compact ? ' compact' : ''}`, onclick: () => watch(item) },
    h('span', { class: 'video-thumb' }, art, item.length && h('span', { class: 'video-length' }, item.length)),
    h('span', { class: 'video-meta' },
      !compact && adder && avatar(adder, { size: 32 }),
      h('span', { class: 'video-text' },
        h('strong', { class: 'video-title', title: item.title }, item.title),
        h('span', { class: 'video-sub' }, item.author || (adder ? `Added by ${adder.displayName}` : 'Uploaded video')),
        (item.views || item.published) && h('span', { class: 'video-sub' }, [item.views && `${item.views.replace(/ views?$/i, '')} views`, item.published].filter(Boolean).join(' · ')))));
}

function grid(items, emptyTitle, emptyText) {
  if (items === null) return h('div', { class: 'video-grid' }, Array.from({ length: 12 }, () => h('div', { class: 'video-card skeleton' }, h('span', { class: 'video-thumb' }), h('span', { class: 'video-line' }), h('span', { class: 'video-line short' }))));
  if (!items.length) return emptyList('video', emptyTitle, emptyText);
  return h('div', { class: 'video-grid' }, items.map(card));
}

function chips() {
  const chip = (label, active, onclick) => h('button', { type: 'button', class: `chip${active ? ' on' : ''}`, onclick }, label);
  return h('div', { class: 'video-chips' },
    chip('Home', view.tab === 'home' && !view.watching, () => { view.tab = 'home'; view.watching = null; loadHome(); }),
    chip(`Library${view.library.length ? ` · ${view.library.length}` : ''}`, view.tab === 'library' && !view.watching, () => { view.tab = 'library'; view.watching = null; render(); }),
    h('span', { class: 'chip-divider' }),
    TOPICS.map((t) => chip(t, view.tab === 'search' && view.query === t && !view.watching, () => runSearch(t))));
}

function player(item) {
  if (item.kind === 'youtube') {
    return h('iframe', {
      class: 'video-player', src: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(item.source)}?autoplay=1&rel=0&modestbranding=1&playsinline=1`,
      allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen', allowFullscreen: true, title: item.title,
      referrerPolicy: 'strict-origin-when-cross-origin',
    });
  }
  return h('video', { class: 'video-player', src: item.source, controls: true, autoplay: true, playsInline: true });
}

function watchPage(item) {
  const saved = view.library.find((x) => x.kind === item.kind && x.source === item.source);
  const adder = saved && state.users.get(saved.addedBy);
  const mayRemove = saved && (saved.addedBy === state.me.id || can(view.serverId, 'manageMessages'));
  const actions = h('div', { class: 'video-actions' },
    item.kind === 'youtube' && !saved && canAdd() && h('button', { type: 'button', class: 'button ghost small', onclick: () => saveYoutube(item) }, icon('plus', 15), 'Save to channel'),
    saved && h('span', { class: 'chip on static' }, icon('check', 14), 'In the library'),
    item.kind === 'youtube' && h('a', { class: 'button ghost small', href: `https://www.youtube.com/watch?v=${item.source}`, target: '_blank', rel: 'noopener noreferrer' }, icon('link', 15), 'YouTube'),
    item.kind === 'file' && h('a', { class: 'button ghost small', href: item.source, download: '' }, icon('download', 15), 'Download'),
    mayRemove && h('button', {
      type: 'button', class: 'button ghost small danger',
      onclick: () => attempt(async () => { await api.del(`/api/channels/${view.channel.id}/videos/${saved.id}`); view.watching = null; render(); }),
    }, icon('trash', 15), 'Remove'));
  const related = view.related;
  const side = h('aside', { class: 'video-next' }, h('h3', {}, 'Up next'),
    related === null ? h('p', { class: 'muted' }, 'Finding more…')
      : related.length ? related.map((r) => card(fromResult(r), { compact: true }))
        : view.library.filter((x) => x.id !== saved?.id).slice(0, 12).map((x) => card(x, { compact: true })));
  return h('div', { class: 'video-watch' },
    h('div', { class: 'video-main' },
      h('div', { class: 'video-frame' }, player(item)),
      h('h1', { class: 'video-watch-title' }, item.title),
      h('div', { class: 'video-watch-row' },
        h('div', { class: 'video-watch-by' }, h('strong', {}, item.author || 'Video'),
          h('span', { class: 'muted' }, [item.views && `${item.views.replace(/ views?$/i, '')} views`, item.published, adder && `saved by ${adder.displayName}`].filter(Boolean).join(' · '))),
        actions)),
    side);
}

function topBar() {
  const input = h('input', { type: 'search', class: 'input', placeholder: 'Search YouTube, or paste a link', 'aria-label': 'Search videos', value: view.tab === 'search' ? view.query : '' });
  const form = h('form', {
    class: 'video-search',
    onsubmit: (event) => {
      event.preventDefault();
      const q = input.value.trim();
      if (!q) return;
      if (/^https?:\/\//i.test(q)) {
        input.value = '';
        if (canAdd()) addLink(q);
        else toast('Only some roles can add videos here.');
      } else {
        runSearch(q);
      }
    },
  }, input, h('button', { type: 'submit', class: 'button primary small', 'aria-label': 'Search' }, icon('search', 16)));
  return h('div', { class: 'video-top' }, form,
    h('div', { class: 'video-top-tools' },
      iconButton('refresh', 'New random videos', () => { view.tab = 'home'; view.watching = null; loadHome(); }),
      iconButton('monitor', 'Play a video from this device', playLocal),
      canAdd() && iconButton('upload', 'Upload a video to the channel', uploadVideo)));
}

// The page is four slots; the content slot keeps the player in place while the rest redraws (moving an
// embedded player in the page reloads it, which would restart the video).
function render() {
  if (!view?.root.isConnected) return;
  const { channel } = view;
  if (!view.shell) {
    view.head = h('div');
    view.slots = { top: h('div'), chips: h('div'), upload: h('div'), content: h('div') };
    view.body = h('div', { class: 'page-scroll video-page' }, ...Object.values(view.slots));
    view.root.replaceChildren(view.head, view.body);
    view.shell = true;
  }
  view.head.replaceChildren(h('header', { class: 'main-header' },
    iconButton('back', 'Back', () => showNav(), 'back-button'),
    h('div', { class: 'main-title' }, icon('video', 18), h('span', {}, channel.name)),
    channel.topic ? h('div', { class: 'main-topic', title: channel.topic }, channel.topic) : h('div', { class: 'main-spacer' })));
  // Don't redraw the search box while someone is typing in it.
  if (!view.slots.top.contains(document.activeElement)) view.slots.top.replaceChildren(topBar());
  view.slots.chips.replaceChildren(chips());
  view.slots.upload.replaceChildren(view.uploading ? h('div', { class: 'video-uploading' }, icon('upload', 16),
    h('span', {}, `Uploading ${view.uploading.name} (${formatSize(view.uploading.size)})`),
    h('div', { class: 'upload-bar' }, h('span', { class: 'video-upload-fill', style: { width: `${view.uploading.fraction * 100}%` } }))) : '');

  if (view.watching) {
    const key = `${view.watching.kind}:${view.watching.source}`;
    const page = watchPage(view.watching);
    const current = view.slots.content.querySelector('.video-watch');
    if (current?.dataset.for === key) {
      current.querySelector('.video-watch-row').replaceWith(page.querySelector('.video-watch-row'));
      current.querySelector('.video-next').replaceWith(page.querySelector('.video-next'));
    } else {
      page.dataset.for = key;
      view.slots.content.replaceChildren(page);
    }
    return;
  }
  const scroll = view.body.scrollTop;
  view.slots.content.replaceChildren(view.tab === 'library'
    ? grid(view.library, 'Nothing saved yet', 'Save videos you like, paste a YouTube link, or upload your own.')
    : grid(view.results, 'No videos found', 'Try another search.'));
  view.body.scrollTop = scroll;
}

on('videos:update', ({ channelId, videos }) => {
  if (view?.channel.id !== channelId) return;
  view.library = videos;
  render();
});
on('users members', () => view && !view.watching && render());

export async function showVideo(container, channel, serverId) {
  if (view?.channel.id === channel.id && view.root === container && container.isConnected) {
    view.channel = channel;
    return render();
  }
  closeVideo();
  view = { root: container, shell: false, channel, serverId, tab: 'home', query: '', results: null, library: [], watching: null, related: null, local: null, uploading: null };
  ensureMembers(serverId);
  api.get(`/api/channels/${channel.id}/videos`).then((videos) => {
    if (view?.channel.id !== channel.id) return;
    view.library = videos;
    render();
  }).catch(() => {});
  return loadHome();
}
