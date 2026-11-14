// Calendar, music and wiki channels. Each is a server channel of that kind; anyone who can see it can use it,
// except that a channel set to "admins only" (read_only) lets only admins and the owner add things.
const express = require('express');
const db = require('../db');
const { newId } = require('../lib/ids');
const access = require('../lib/access');
const { fail, text } = require('../lib/http');
const servers = require('../models/servers');
const realtime = require('../realtime');
const audit = require('../models/audit');
const previews = require('../lib/previews');

const router = express.Router();

const channels = require('../models/channels');
// Changing or removing other people's events, songs and pages.
const isMod = (channel, userId) => servers.can(channel.server_id, userId, 'manageMessages');

function appChannel(id, userId, kind) {
  const channel = access.visibleChannel(id, userId);
  if (channel.kind !== kind) fail(400, `That is not a ${kind} channel.`);
  return channel;
}

// Adding things: not while timed out, and only admins in an admins-only channel.
function canAdd(channel, userId) {
  if (servers.roleOf(channel.server_id, userId) !== 'member') return;
  if (servers.timeoutUntil(channel.server_id, userId)) fail(403, 'You are timed out.');
  if (!channels.canPost(userId, channel)) fail(403, 'You can’t add things here.');
}

const time = (value, label) => {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0) fail(400, `${label} must be a time.`);
  return n;
};

// --- calendar ---

function toEvent(row) {
  const rsvps = { going: [], maybe: [], no: [] };
  for (const r of db.prepare('SELECT user_id, status FROM event_rsvps WHERE event_id = ?').all(row.id)) rsvps[r.status].push(r.user_id);
  return {
    id: row.id, channelId: row.channel_id, creatorId: row.creator_id, title: row.title, description: row.description,
    location: row.location, startsAt: row.starts_at, endsAt: row.ends_at, allDay: Boolean(row.all_day), createdAt: row.created_at, rsvps,
  };
}

function eventFields(body, partial = false) {
  const out = {};
  if (!partial || body.title !== undefined) out.title = text(body.title, 'Title', { min: 1, max: 100 });
  if (body.description !== undefined) out.description = text(body.description, 'Description', { max: 1000 });
  if (body.location !== undefined) out.location = text(body.location, 'Location', { max: 200 });
  if (!partial || body.startsAt !== undefined) out.starts_at = time(body.startsAt, 'Start');
  if (body.endsAt !== undefined) out.ends_at = body.endsAt == null ? null : time(body.endsAt, 'End');
  if (body.allDay !== undefined) out.all_day = body.allDay ? 1 : 0;
  if (out.ends_at != null && out.starts_at != null && out.ends_at < out.starts_at) fail(400, 'An event has to end after it starts.');
  return out;
}

const eventChanged = (channel, id) => realtime.toServer(channel.server_id, 'event:update', toEvent(db.prepare('SELECT * FROM events WHERE id = ?').get(id)));

function ownEvent(channel, eventId, userId) {
  const row = db.prepare('SELECT * FROM events WHERE id = ? AND channel_id = ?').get(eventId, channel.id);
  if (!row) fail(404, 'Event not found.');
  if (row.creator_id !== userId && !isMod(channel, userId)) fail(403, 'Only whoever made the event (or an admin) can change it.');
  return row;
}

router.get('/:id/events', (req, res) => {
  const channel = appChannel(req.params.id, req.user.id, 'calendar');
  const rows = db.prepare('SELECT * FROM events WHERE channel_id = ? ORDER BY starts_at LIMIT 1000').all(channel.id);
  res.json(rows.map(toEvent));
});

router.post('/:id/events', (req, res) => {
  const channel = appChannel(req.params.id, req.user.id, 'calendar');
  canAdd(channel, req.user.id);
  const f = eventFields(req.body);
  if (db.prepare('SELECT COUNT(*) AS n FROM events WHERE channel_id = ?').get(channel.id).n >= 1000) fail(400, 'This calendar is full.');
  const id = newId();
  db.prepare(`INSERT INTO events (id, channel_id, creator_id, title, description, location, starts_at, ends_at, all_day, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, channel.id, req.user.id, f.title, f.description || '', f.location || '', f.starts_at, f.ends_at ?? null, f.all_day || 0, Date.now());
  // Whoever makes an event is going to it.
  db.prepare("INSERT INTO event_rsvps (event_id, user_id, status) VALUES (?, ?, 'going')").run(id, req.user.id);
  eventChanged(channel, id);
  res.status(201).json(toEvent(db.prepare('SELECT * FROM events WHERE id = ?').get(id)));
});

router.patch('/:id/events/:eventId', (req, res) => {
  const channel = appChannel(req.params.id, req.user.id, 'calendar');
  const row = ownEvent(channel, req.params.eventId, req.user.id);
  const f = eventFields({ startsAt: row.starts_at, ...req.body }, true);
  for (const [column, value] of Object.entries(f)) db.prepare(`UPDATE events SET ${column} = ? WHERE id = ?`).run(value, row.id);
  eventChanged(channel, row.id);
  res.json(toEvent(db.prepare('SELECT * FROM events WHERE id = ?').get(row.id)));
});

router.delete('/:id/events/:eventId', (req, res) => {
  const channel = appChannel(req.params.id, req.user.id, 'calendar');
  const row = ownEvent(channel, req.params.eventId, req.user.id);
  db.prepare('DELETE FROM events WHERE id = ?').run(row.id);
  if (row.creator_id !== req.user.id) audit.log(channel.server_id, req.user.id, 'event.delete', row.title);
  realtime.toServer(channel.server_id, 'event:delete', { channelId: channel.id, id: row.id });
  res.sendStatus(204);
});

// Going / maybe / no, or null to clear it.
router.put('/:id/events/:eventId/rsvp', (req, res) => {
  const channel = appChannel(req.params.id, req.user.id, 'calendar');
  const row = db.prepare('SELECT * FROM events WHERE id = ? AND channel_id = ?').get(req.params.eventId, channel.id);
  if (!row) fail(404, 'Event not found.');
  const { status } = req.body;
  if (status == null) db.prepare('DELETE FROM event_rsvps WHERE event_id = ? AND user_id = ?').run(row.id, req.user.id);
  else if (['going', 'maybe', 'no'].includes(status)) {
    db.prepare('INSERT OR REPLACE INTO event_rsvps (event_id, user_id, status) VALUES (?, ?, ?)').run(row.id, req.user.id, status);
  } else fail(400, 'Answer going, maybe or no.');
  eventChanged(channel, row.id);
  res.json(toEvent(db.prepare('SELECT * FROM events WHERE id = ?').get(row.id)));
});

// --- music ---

function musicState(channelId) {
  const queue = db.prepare('SELECT * FROM music_queue WHERE channel_id = ? ORDER BY id').all(channelId).map((row) => ({
    id: row.id, kind: row.kind, source: row.source, title: row.title, addedBy: row.added_by,
  }));
  const s = db.prepare('SELECT * FROM music_state WHERE channel_id = ?').get(channelId);
  const current = s?.item_id && queue.some((q) => q.id === s.item_id) ? s : null;
  return {
    channelId, queue, now: Date.now(),
    playing: current ? { itemId: current.item_id, startedAt: current.started_at, pausedAt: current.paused_at } : null,
  };
}

function setPlaying(channelId, itemId, startedAt = Date.now(), pausedAt = null) {
  db.prepare('INSERT OR REPLACE INTO music_state (channel_id, item_id, started_at, paused_at) VALUES (?, ?, ?, ?)')
    .run(channelId, itemId, startedAt, pausedAt);
}

// The current track is done: drop it and start the next one (if any).
function advance(channelId) {
  const s = db.prepare('SELECT item_id FROM music_state WHERE channel_id = ?').get(channelId);
  if (s?.item_id) db.prepare('DELETE FROM music_queue WHERE id = ?').run(s.item_id);
  const next = db.prepare('SELECT id FROM music_queue WHERE channel_id = ? ORDER BY id LIMIT 1').get(channelId);
  setPlaying(channelId, next?.id || null, next ? Date.now() : null);
}

const musicChanged = (channel) => realtime.toServer(channel.server_id, 'music:update', musicState(channel.id));

router.get('/:id/music', (req, res) => {
  res.json(musicState(appChannel(req.params.id, req.user.id, 'music').id));
});

// Add a YouTube link, or a link to an audio file someone uploaded here.
router.post('/:id/music', async (req, res, next) => {
  try {
    const channel = appChannel(req.params.id, req.user.id, 'music');
    canAdd(channel, req.user.id);
    const url = text(req.body.url, 'Link', { min: 1, max: 500 });
    if (db.prepare('SELECT COUNT(*) AS n FROM music_queue WHERE channel_id = ?').get(channel.id).n >= 200) fail(400, 'The queue is full.');
    let item = null;
    const video = (() => { try { return previews.youtubeId(url); } catch { return null; } })();
    if (video && /^[\w-]{6,20}$/.test(video)) {
      const info = await previews.preview(`https://www.youtube.com/watch?v=${video}`).catch(() => null);
      item = { kind: 'youtube', source: video, title: info?.title || 'YouTube video' };
    } else {
      const m = /^(?:https?:\/\/[^/]+)?(\/media\/attachments\/([\w-]+)\/[^?#]*)$/.exec(url);
      const file = m && db.prepare(`SELECT attachments.*, messages.channel_id FROM attachments JOIN messages ON messages.id = attachments.message_id
        WHERE attachments.id = ?`).get(m[2]);
      if (!file || file.kind !== 'audio') fail(400, 'Paste a YouTube link, or the link of an audio file sent in this server.');
      access.visibleChannel(file.channel_id, req.user.id);
      item = { kind: 'audio', source: m[1], title: file.name.replace(/\.[a-z0-9]+$/i, '') };
    }
    const id = newId();
    db.prepare('INSERT INTO music_queue (id, channel_id, added_by, kind, source, title, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, channel.id, req.user.id, item.kind, item.source, item.title.slice(0, 200), Date.now());
    if (!musicState(channel.id).playing) setPlaying(channel.id, id);
    musicChanged(channel);
    res.status(201).json(musicState(channel.id));
  } catch (err) {
    next(err);
  }
});

// play, pause, skip, seek (position in seconds), or ended (sent by players when a track finishes).
router.post('/:id/music/control', (req, res) => {
  const channel = appChannel(req.params.id, req.user.id, 'music');
  const { action, itemId } = req.body;
  const state = musicState(channel.id);
  const p = state.playing;
  if (!p) fail(400, 'Nothing is playing.');
  // "ended" and "skip" name the track they mean, so two people pressing at once don't skip twice.
  if (['ended', 'skip'].includes(action)) {
    if (itemId === p.itemId) advance(channel.id);
  } else if (action === 'pause') {
    if (!p.pausedAt) setPlaying(channel.id, p.itemId, p.startedAt, Date.now());
  } else if (action === 'play') {
    if (p.pausedAt) setPlaying(channel.id, p.itemId, p.startedAt + (Date.now() - p.pausedAt));
  } else if (action === 'seek') {
    const position = Math.max(0, Number(req.body.position) || 0);
    const now = Date.now();
    setPlaying(channel.id, p.itemId, now - position * 1000, p.pausedAt ? now : null);
  } else {
    fail(400, 'Unknown action.');
  }
  musicChanged(channel);
  res.json(musicState(channel.id));
});

router.delete('/:id/music/:itemId', (req, res) => {
  const channel = appChannel(req.params.id, req.user.id, 'music');
  const row = db.prepare('SELECT * FROM music_queue WHERE id = ? AND channel_id = ?').get(req.params.itemId, channel.id);
  if (!row) fail(404, 'Not in the queue.');
  if (row.added_by !== req.user.id && !isMod(channel, req.user.id)) fail(403, 'Only whoever added it (or an admin) can take it out.');
  if (musicState(channel.id).playing?.itemId === row.id) advance(channel.id);
  else db.prepare('DELETE FROM music_queue WHERE id = ?').run(row.id);
  musicChanged(channel);
  res.sendStatus(204);
});

// --- wiki ---

const WIKI_MAX = 50_000;
const pageSummary = (row) => ({ id: row.id, channelId: row.channel_id, title: row.title, updatedBy: row.updated_by, updatedAt: row.updated_at, createdAt: row.created_at });
const toPage = (row) => ({ ...pageSummary(row), content: row.content });

function page(channel, pageId) {
  const row = db.prepare('SELECT * FROM wiki_pages WHERE id = ? AND channel_id = ?').get(pageId, channel.id);
  if (!row) fail(404, 'Page not found.');
  return row;
}

function pageFields(body) {
  const title = text(body.title, 'Title', { min: 1, max: 100 });
  const content = text(body.content ?? '', 'Page', { max: WIKI_MAX, trim: false });
  return { title, content };
}

const titleTaken = (channel, title, exceptId = '') => db.prepare('SELECT 1 FROM wiki_pages WHERE channel_id = ? AND title = ? COLLATE NOCASE AND id != ?')
  .get(channel.id, title, exceptId);

router.get('/:id/pages', (req, res) => {
  const channel = appChannel(req.params.id, req.user.id, 'wiki');
  res.json(db.prepare('SELECT * FROM wiki_pages WHERE channel_id = ? ORDER BY title COLLATE NOCASE').all(channel.id).map(pageSummary));
});

router.get('/:id/pages/:pageId', (req, res) => {
  res.json(toPage(page(appChannel(req.params.id, req.user.id, 'wiki'), req.params.pageId)));
});

router.post('/:id/pages', (req, res) => {
  const channel = appChannel(req.params.id, req.user.id, 'wiki');
  canAdd(channel, req.user.id);
  const f = pageFields(req.body);
  if (titleTaken(channel, f.title)) fail(400, 'There is already a page with that title.');
  if (db.prepare('SELECT COUNT(*) AS n FROM wiki_pages WHERE channel_id = ?').get(channel.id).n >= 500) fail(400, 'This wiki is full.');
  const id = newId();
  const now = Date.now();
  db.prepare('INSERT INTO wiki_pages (id, channel_id, title, content, updated_by, updated_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, channel.id, f.title, f.content, req.user.id, now, now);
  const row = page(channel, id);
  realtime.toServer(channel.server_id, 'wiki:update', pageSummary(row));
  res.status(201).json(toPage(row));
});

// Saving keeps the old version in the page's history.
router.put('/:id/pages/:pageId', (req, res) => {
  const channel = appChannel(req.params.id, req.user.id, 'wiki');
  canAdd(channel, req.user.id);
  const old = page(channel, req.params.pageId);
  const f = pageFields(req.body);
  if (titleTaken(channel, f.title, old.id)) fail(400, 'There is already a page with that title.');
  if (f.title === old.title && f.content === old.content) return res.json(toPage(old));
  db.prepare('INSERT INTO wiki_revisions (id, page_id, user_id, title, content, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(newId(), old.id, old.updated_by, old.title, old.content, old.updated_at);
  db.prepare(`DELETE FROM wiki_revisions WHERE page_id = ? AND id NOT IN (SELECT id FROM wiki_revisions WHERE page_id = ? ORDER BY id DESC LIMIT 50)`)
    .run(old.id, old.id);
  db.prepare('UPDATE wiki_pages SET title = ?, content = ?, updated_by = ?, updated_at = ? WHERE id = ?').run(f.title, f.content, req.user.id, Date.now(), old.id);
  const row = page(channel, old.id);
  realtime.toServer(channel.server_id, 'wiki:update', pageSummary(row));
  res.json(toPage(row));
});

router.get('/:id/pages/:pageId/history', (req, res) => {
  const row = page(appChannel(req.params.id, req.user.id, 'wiki'), req.params.pageId);
  res.json(db.prepare('SELECT * FROM wiki_revisions WHERE page_id = ? ORDER BY id DESC').all(row.id).map((r) => ({
    id: r.id, userId: r.user_id, title: r.title, content: r.content, createdAt: r.created_at,
  })));
});

router.delete('/:id/pages/:pageId', (req, res) => {
  const channel = appChannel(req.params.id, req.user.id, 'wiki');
  const row = page(channel, req.params.pageId);
  if (!isMod(channel, req.user.id)) fail(403, 'Only admins and the owner can delete pages.');
  db.prepare('DELETE FROM wiki_pages WHERE id = ?').run(row.id);
  audit.log(channel.server_id, req.user.id, 'wiki.delete', row.title);
  realtime.toServer(channel.server_id, 'wiki:delete', { channelId: channel.id, id: row.id });
  res.sendStatus(204);
});

module.exports = router;
