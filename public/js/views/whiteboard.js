// A whiteboard channel: an endless white canvas anyone in the server can draw on at the same time.
// Strokes are lines of points in "board" units. Pen and eraser draw; drag with the hand tool, the middle
// mouse button, two fingers or the scroll wheel to move around; pinch or Ctrl+scroll to zoom.
// Others' strokes show up live while they're being drawn and stay once they're finished.
import * as api from '../api.js';
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { state, on, canModerate } from '../store.js';
import { showNav } from '../router.js';
import { confirmButton, iconButton, toast } from '../ui.js';
import { boardSend } from '../realtime.js';
import { colorField } from '../colorPicker.js';

const BACKGROUND = '#ffffff';
const COLORS = ['#1d1d1b', '#e5484d', '#f2a33a', '#3fb56b', '#3b82f6', '#8b5cf6'];
const SIZES = [2, 5, 10, 22];
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 8;

let board = null;

export function closeWhiteboard() {
  if (!board) return;
  board.stop();
  board = null;
}

function strokePath(stroke) {
  const path = new Path2D();
  const pts = stroke.points;
  if (pts.length === 1) {
    path.arc(pts[0][0], pts[0][1], 0.01, 0, Math.PI * 2);
    return path;
  }
  path.moveTo(pts[0][0], pts[0][1]);
  // Smooth the line through the midpoints between points.
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2;
    const my = (pts[i][1] + pts[i + 1][1]) / 2;
    path.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
  }
  const last = pts.at(-1);
  path.lineTo(last[0], last[1]);
  return path;
}

export function showWhiteboard(container, channel, serverId) {
  if (board?.channel.id === channel.id && board.root.isConnected) {
    board.channel = channel;
    return;
  }
  closeWhiteboard();

  const canvas = h('canvas', { class: 'wb-canvas', 'aria-label': `Whiteboard ${channel.name}` });
  const ctx = canvas.getContext('2d');
  const stage = h('div', { class: 'wb-stage' }, canvas);
  const root = h('section', { class: 'chat whiteboard-view', 'aria-label': channel.name });

  const strokes = new Map(); // id → stroke (saved)
  const live = new Map(); // key → stroke being drawn by someone (or me)
  const mine = []; // ids of my saved strokes, for undo
  const cam = { x: 0, y: 0, zoom: 1 }; // board point at the screen's top-left, and the scale
  let tool = 'pen';
  let color = COLORS[0];
  let size = SIZES[1];
  let dirty = true;
  let frame = 0;
  let loaded = false;

  const b = { channel, root, stop: () => {} };
  board = b;

  // --- drawing ---
  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const { width, height } = stage.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    dirty = true;
  }

  function drawStroke(stroke) {
    if (!stroke.path || stroke.pathPoints !== stroke.points.length) {
      stroke.path = strokePath(stroke);
      stroke.pathPoints = stroke.points.length;
    }
    ctx.strokeStyle = stroke.erase ? BACKGROUND : stroke.color;
    ctx.lineWidth = stroke.size;
    ctx.stroke(stroke.path);
  }

  function paint() {
    frame = 0;
    if (!dirty) return;
    dirty = false;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = BACKGROUND;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // A faint dot grid, so you can tell the board is moving.
    const step = 32 * cam.zoom * dpr;
    if (step > 9) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.13)';
      const ox = (-cam.x * cam.zoom * dpr) % step;
      const oy = (-cam.y * cam.zoom * dpr) % step;
      for (let x = ox; x < canvas.width; x += step) for (let y = oy; y < canvas.height; y += step) ctx.fillRect(x - 1, y - 1, 2, 2);
    }
    ctx.setTransform(cam.zoom * dpr, 0, 0, cam.zoom * dpr, -cam.x * cam.zoom * dpr, -cam.y * cam.zoom * dpr);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const stroke of strokes.values()) drawStroke(stroke);
    for (const stroke of live.values()) drawStroke(stroke);
  }

  function redraw() {
    dirty = true;
    if (!frame) frame = requestAnimationFrame(paint);
  }

  const toBoard = (clientX, clientY) => {
    const box = canvas.getBoundingClientRect();
    return [cam.x + (clientX - box.left) / cam.zoom, cam.y + (clientY - box.top) / cam.zoom];
  };

  function zoomAt(clientX, clientY, factor) {
    const before = toBoard(clientX, clientY);
    cam.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, cam.zoom * factor));
    const after = toBoard(clientX, clientY);
    cam.x += before[0] - after[0];
    cam.y += before[1] - after[1];
    zoomLabel.textContent = `${Math.round(cam.zoom * 100)}%`;
    redraw();
  }

  // --- input ---
  const pointers = new Map(); // pointerId → { x, y }
  let drawing = null; // { key, stroke, sentUpTo, timer }
  let panning = null; // { x, y }
  let pinch = null; // { dist, mid }

  function startStroke(event) {
    const key = `${state.me.id}:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const stroke = { points: [toBoard(event.clientX, event.clientY)], color, size: tool === 'eraser' ? size * 3 : size, erase: tool === 'eraser' };
    live.set(key, stroke);
    drawing = { key, stroke, sentUpTo: 0, timer: setInterval(sendLive, 60) };
    redraw();
  }

  function sendLive() {
    if (!drawing || drawing.sentUpTo >= drawing.stroke.points.length) return;
    const { stroke } = drawing;
    // Send the new points, plus the last one already sent so the pieces join up.
    const from = Math.max(0, drawing.sentUpTo - 1);
    boardSend('wb:live', { channelId: channel.id, key: drawing.key, points: stroke.points.slice(from), color: stroke.color, size: stroke.size, erase: stroke.erase });
    drawing.sentUpTo = stroke.points.length;
  }

  function endStroke(cancel = false) {
    if (!drawing) return;
    clearInterval(drawing.timer);
    const { key, stroke } = drawing;
    drawing = null;
    if (cancel) {
      live.delete(key);
      redraw();
      return;
    }
    boardSend('wb:stroke', { channelId: channel.id, key, ...stroke, points: stroke.points.slice(0, 4000) }, (result) => {
      if (result?.error) {
        live.delete(key);
        toast(result.error);
        redraw();
      } else if (result?.id) {
        mine.push(result.id);
      }
    });
  }

  canvas.addEventListener('pointerdown', (event) => {
    canvas.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 2) {
      // Second finger: stop drawing, pinch and pan instead.
      endStroke(true);
      panning = null;
      const [a, b2] = [...pointers.values()];
      pinch = { dist: Math.hypot(a.x - b2.x, a.y - b2.y), mid: [(a.x + b2.x) / 2, (a.y + b2.y) / 2] };
      return;
    }
    if (pointers.size > 2) return;
    if (event.button === 1 || tool === 'hand' || event.button === 2) {
      event.preventDefault();
      panning = { x: event.clientX, y: event.clientY };
      canvas.classList.add('panning');
      return;
    }
    if (event.button === 0) startStroke(event);
  });

  canvas.addEventListener('pointermove', (event) => {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pinch && pointers.size >= 2) {
      const [a, b2] = [...pointers.values()];
      const dist = Math.hypot(a.x - b2.x, a.y - b2.y);
      const mid = [(a.x + b2.x) / 2, (a.y + b2.y) / 2];
      cam.x -= (mid[0] - pinch.mid[0]) / cam.zoom;
      cam.y -= (mid[1] - pinch.mid[1]) / cam.zoom;
      if (pinch.dist > 0) zoomAt(mid[0], mid[1], dist / pinch.dist);
      pinch = { dist, mid };
      redraw();
      return;
    }
    if (panning) {
      cam.x -= (event.clientX - panning.x) / cam.zoom;
      cam.y -= (event.clientY - panning.y) / cam.zoom;
      panning = { x: event.clientX, y: event.clientY };
      redraw();
      return;
    }
    if (!drawing) return;
    const events = event.getCoalescedEvents?.() || [event];
    for (const e of events) {
      const p = toBoard(e.clientX, e.clientY);
      const last = drawing.stroke.points.at(-1);
      if (Math.hypot(p[0] - last[0], p[1] - last[1]) * cam.zoom < 1.5) continue;
      if (drawing.stroke.points.length >= 4000) { endStroke(); return; }
      drawing.stroke.points.push(p);
    }
    redraw();
  });

  const release = (event) => {
    pointers.delete(event.pointerId);
    if (pinch && pointers.size < 2) pinch = null;
    if (panning && !pointers.size) { panning = null; canvas.classList.remove('panning'); }
    if (drawing && !pointers.size) endStroke(event.type === 'pointercancel');
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) {
      zoomAt(event.clientX, event.clientY, Math.exp(-event.deltaY * 0.01));
    } else {
      cam.x += event.deltaX / cam.zoom;
      cam.y += event.deltaY / cam.zoom;
      redraw();
    }
  }, { passive: false });

  // --- toolbar ---
  const toolButton = (id, name, label) => iconButton(name, label, () => { tool = id; drawTools(); }, `wb-tool${tool === id ? ' on' : ''}`);
  const zoomLabel = h('button', {
    type: 'button', class: 'wb-zoom', title: 'Back to 100%',
    onclick: () => { const box = canvas.getBoundingClientRect(); zoomAt(box.left + box.width / 2, box.top + box.height / 2, 1 / cam.zoom); },
  }, '100%');
  const custom = colorField({ value: color, label: 'Any colour', onChange: (c) => { if (c) { color = c; tool = 'pen'; drawTools(); } } });
  const toolbar = h('div', { class: 'wb-toolbar', 'data-no-swipe': '' });
  function drawTools() {
    // The rainbow swatch shows the picked colour only when it isn't one of the presets.
    custom.value = color;
    custom.style.background = COLORS.includes(color) ? '' : color;
    custom.classList.toggle('on', !COLORS.includes(color) && tool === 'pen');
    custom.style.setProperty('--current', color); // phones show only this swatch, in the current colour
    toolbar.replaceChildren(
      h('div', { class: 'wb-group' }, toolButton('pen', 'pen', 'Pen'), toolButton('eraser', 'eraser', 'Eraser'), toolButton('hand', 'hand', 'Move around')),
      h('div', { class: 'wb-group' }, COLORS.map((c) => h('button', {
        type: 'button', class: `wb-color${color === c && tool === 'pen' ? ' on' : ''}`, style: { background: c }, 'aria-label': `Colour ${c}`,
        onclick: () => { color = c; tool = 'pen'; drawTools(); },
      })), custom),
      h('div', { class: 'wb-group' }, SIZES.map((s) => h('button', {
        type: 'button', class: `wb-size${size === s ? ' on' : ''}`, 'aria-label': `Size ${s}`,
        onclick: () => { size = s; drawTools(); },
      }, h('span', { style: { width: `${Math.min(18, s + 2)}px`, height: `${Math.min(18, s + 2)}px` } })))),
      h('div', { class: 'wb-group' },
        iconButton('undo', 'Undo my last stroke', () => {
          const id = mine.pop();
          if (id) boardSend('wb:erase', { channelId: channel.id, id });
        }),
        zoomLabel));
    canvas.dataset.tool = tool;
  }
  drawTools();

  root.append(
    h('header', { class: 'main-header' },
      iconButton('back', 'Back', () => showNav(), 'back-button'),
      h('div', { class: 'main-title' }, icon('whiteboard', 18), h('span', {}, channel.name)),
      h('div', { class: 'main-spacer' }),
      canModerate(serverId) && confirmButton({
        label: 'Clear the board', confirmLabel: 'Clear for everyone?', face: icon('trash'), className: 'icon-button',
        onConfirm: () => api.del(`/api/channels/${channel.id}/strokes`),
      })),
    h('div', { class: 'wb-wrap' }, stage, toolbar));
  container.replaceChildren(root);

  const observer = new ResizeObserver(() => { resize(); paint(); });
  observer.observe(stage);

  // --- other people ---
  const offs = [
    on('wb:live', ({ channelId, key, points, color: c, size: s, erase }) => {
      if (channelId !== channel.id) return;
      const stroke = live.get(key);
      if (stroke) stroke.points.push(...points.slice(1));
      else live.set(key, { points, color: c, size: s, erase });
      redraw();
    }),
    on('wb:stroke', ({ channelId, key, stroke }) => {
      if (channelId !== channel.id) return;
      live.delete(key);
      strokes.set(stroke.id, stroke);
      redraw();
    }),
    on('wb:erase', ({ channelId, id }) => {
      if (channelId !== channel.id) return;
      strokes.delete(id);
      redraw();
    }),
    on('wb:clear', ({ channelId }) => {
      if (channelId !== channel.id) return;
      strokes.clear();
      live.clear();
      mine.length = 0;
      redraw();
    }),
    // After a reconnect, anything drawn meanwhile is fetched again.
    on('reload', () => load()),
  ];

  async function load() {
    const list = await api.get(`/api/channels/${channel.id}/strokes`).catch(() => null);
    if (!list || board !== b) return;
    strokes.clear();
    for (const stroke of list) strokes.set(stroke.id, stroke);
    if (!loaded) {
      loaded = true;
      // Start centred on the drawing, or on the middle of the board.
      const box = stage.getBoundingClientRect();
      let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
      for (const s of list) {
        for (const [x, y] of s.points) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
      if (list.length) {
        cam.x = (minX + maxX) / 2 - box.width / 2;
        cam.y = (minY + maxY) / 2 - box.height / 2;
      } else {
        cam.x = -box.width / 2;
        cam.y = -box.height / 2;
      }
    }
    redraw();
  }
  resize();
  load();

  b.stop = () => {
    endStroke(true);
    observer.disconnect();
    if (frame) cancelAnimationFrame(frame);
    for (const off of offs) off();
  };
}
