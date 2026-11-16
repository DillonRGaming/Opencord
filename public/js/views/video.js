// The browsing half of a video channel: a search bar, topic chips and a grid of videos. Home fills itself with
// videos found on YouTube; the Library tab holds what people in the channel saved or uploaded. Watching happens
// in the channel's shared player (views/music.js), so everyone sees the same thing at the same moment: a card
// plays straight away, its + button adds it to the queue.
import * as api from '../api.js';
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { state, on, can } from '../store.js';
import { attempt, emptyList, iconButton, pickFiles, toast } from '../ui.js';
import { startUpload } from '../upload.js';
import { remote } from '../fun.js';
import { formatSize } from '../format.js';

const TOPICS = ['Music', 'Gaming', 'Comedy', 'Science', 'Animals', 'Cooking', 'Tech', 'Sports', 'Movies', 'Minecraft', 'Lofi', 'Space', 'Art', 'Travel'];
// Searches that make a nice random home page.
const SEEDS = ['funny videos', 'music video', 'minecraft', 'science explained', 'cute animals', 'cooking recipe', 'tech review', 'space documentary',
  'lofi hip hop', 'speedrun', 'satisfying video', 'travel vlog', 'animation short film', 'street food', 'retro games', 'nature 4k', 'stand up comedy', 'how it\'s made'];

// { root, channel, serverId, canAdd, play, queue, tab, query, results, library, uploading, slots }
let view = null;

const thumb = (id) => remote(`https://i.ytimg.com/vi/${id}/mqdefault.jpg`);
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const shuffle = (list) => list.map((v) => [Math.random(), v]).sort((a, b) => a[0] - b[0]).map(([, v]) => v);
const fromResult = (r) => ({ kind: 'youtube', source: r.id, title: r.title, author: r.author, views: r.views, published: r.published, length: r.length });

export function closeVideoBrowser() {
  view = null;
}

const search = (query) => api.get(`/api/fun/youtube?q=${encodeURIComponent(query)}`);

// Home: two random searches mixed together (or the channel topic, if it has one), so each visit is different.
async function loadHome() {
  const v = view;
  v.tab = 'home';
  v.results = null;
  render();
  const seeds = v.channel.topic ? [v.channel.topic, pick(SEEDS)] : shuffle(SEEDS).slice(0, 2);
  const lists = await Promise.all(seeds.map((q) => search(q).catch(() => [])));
  if (view !== v) return;
  const seen = new Set();
  v.results = shuffle(lists.flat()).filter((x) => !seen.has(x.id) && seen.add(x.id)).map(fromResult);
  render();
}

async function runSearch(query) {
  const v = view;
  v.tab = 'search';
  v.query = query;
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

// Uploading saves the file to the channel's library, then plays it for everyone.
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
    if (view === v) { v.uploading = null; render(); v.play(saved); }
  } catch (err) {
    toast(err.message);
    if (view === v) { v.uploading = null; render(); }
  }
}

// --- drawing ---

function card(item) {
  const isYoutube = item.kind === 'youtube';
  const adder = item.addedBy && state.users.get(item.addedBy);
  const mayRemove = item.id && (item.addedBy === state.me.id || can(view.serverId, 'manageMessages'));
  const art = isYoutube ? h('img', { src: thumb(item.source), alt: '', loading: 'lazy' }) : h('span', { class: 'video-file-art' }, icon('video', 34));
  const queue = view.canAdd() && h('button', {
    type: 'button', class: 'video-card-queue', 'aria-label': `Add ${item.title} to the queue`, title: 'Add to queue',
    onclick: async (event) => {
      event.stopPropagation();
      const button = event.currentTarget;
      if (await view.queue(item)) {
        button.replaceChildren(icon('check', 16));
        button.classList.add('done');
      }
    },
  }, icon('plus', 16));
  return h('div', { class: 'video-card' },
    h('button', {
      type: 'button', class: 'video-card-play', 'aria-label': `Play ${item.title}`,
      onclick: () => view.canAdd() ? view.play(item) : toast('Only some roles can play videos here.'),
    },
    h('span', { class: 'video-thumb' }, art, item.length && h('span', { class: 'video-length' }, item.length)),
    h('span', { class: 'video-meta' },
      h('span', { class: 'video-text' },
        h('strong', { class: 'video-title', title: item.title }, item.title),
        h('span', { class: 'video-sub' }, item.author || adder?.displayName || ''),
        (item.views || item.published) && h('span', { class: 'video-sub' }, [item.views && `${item.views.replace(/ views?$/i, '')} views`, item.published].filter(Boolean).join(' · '))))),
    h('span', { class: 'video-card-tools' },
      queue,
      mayRemove && iconButton('x', `Remove ${item.title} from the library`, () => attempt(() => api.del(`/api/channels/${view.channel.id}/videos/${item.id}`)), 'video-card-remove')));
}

function grid(items, emptyTitle) {
  if (items === null) return h('div', { class: 'video-grid' }, Array.from({ length: 12 }, () => h('div', { class: 'video-card skeleton' }, h('span', { class: 'video-thumb' }), h('span', { class: 'video-line' }), h('span', { class: 'video-line short' }))));
  if (!items.length) return emptyList('video', emptyTitle);
  return h('div', { class: 'video-grid' }, items.map(card));
}

function chips() {
  const chip = (label, active, onclick) => h('button', { type: 'button', class: `chip${active ? ' on' : ''}`, onclick }, label);
  return h('div', { class: 'video-chips' },
    chip('Home', view.tab === 'home', loadHome),
    chip(`Library${view.library.length ? ` · ${view.library.length}` : ''}`, view.tab === 'library', () => { view.tab = 'library'; render(); }),
    h('span', { class: 'chip-divider' }),
    TOPICS.map((t) => chip(t, view.tab === 'search' && view.query === t, () => runSearch(t))));
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
        if (view.canAdd()) view.queue({ kind: 'link', source: q });
        else toast('Only some roles can add videos here.');
      } else {
        runSearch(q);
      }
    },
  }, input, h('button', { type: 'submit', class: 'button primary small', 'aria-label': 'Search' }, icon('search', 16)));
  return h('div', { class: 'video-top' }, form,
    h('div', { class: 'video-top-tools' },
      iconButton('refresh', 'New random videos', loadHome),
      view.canAdd() && iconButton('upload', 'Upload a video', uploadVideo)));
}

function render() {
  if (!view?.root.isConnected) return;
  // Don't redraw the search box while someone is typing in it.
  if (!view.slots.top.contains(document.activeElement)) view.slots.top.replaceChildren(topBar());
  view.slots.chips.replaceChildren(chips());
  view.slots.upload.replaceChildren(view.uploading ? h('div', { class: 'video-uploading' }, icon('upload', 16),
    h('span', {}, `${view.uploading.name} (${formatSize(view.uploading.size)})`),
    h('div', { class: 'upload-bar' }, h('span', { class: 'video-upload-fill', style: { width: `${view.uploading.fraction * 100}%` } }))) : '');
  view.slots.content.replaceChildren(view.tab === 'library' ? grid(view.library, 'Nothing saved yet') : grid(view.results, 'No videos found'));
}

on('videos:update', ({ channelId, videos }) => {
  if (view?.channel.id !== channelId) return;
  view.library = videos;
  render();
});

// Fills `root` (a box the player page keeps) with the browser. `play(item)` and `queue(item)` hand a video to the
// shared player; queue resolves truthy once it's in.
export function mountVideoBrowser(root, { channel, serverId, canAdd, play, queue }) {
  if (view?.root === root && view.channel.id === channel.id) {
    view.channel = channel;
    return render();
  }
  const slots = { top: h('div'), chips: h('div'), upload: h('div'), content: h('div') };
  root.replaceChildren(h('section', { class: 'video-browse' }, ...Object.values(slots)));
  view = { root, channel, serverId, canAdd, play, queue, tab: 'home', query: '', results: null, library: [], uploading: null, slots };
  api.get(`/api/channels/${channel.id}/videos`).then((videos) => {
    if (view?.channel.id !== channel.id) return;
    view.library = videos;
    render();
  }).catch(() => {});
  return loadHome();
}
