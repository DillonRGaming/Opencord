// The Hub: one Durable Object that is Opencord's server on Cloudflare. It holds the database (its own SQLite),
// runs the same server code as a computer does (server/), and keeps everyone's live connection. Connections
// sleep with it when nothing is happening, so idle time costs nothing; on waking it rebuilds who's online and
// who's in which call from what each connection kept.
import { DurableObject } from 'cloudflare:workers';
import platform from '../server/platform.js';
import { migrate } from '../server/db/migrate.js';
import { sqliteDb } from './db.js';
import { cloudFiles, shardStub } from './storage.js';
import { fetchUrl } from './fetch.js';
import { Scheduler } from './scheduler.js';
import { SHARDS } from './files.js';
import { migrations } from './migrations.generated.js';
import kitchen from '../server/assets/kitchen.json.gz';

// Module state outlives a Hub object (Cloudflare can rebuild the object in the same process), so the server
// code is loaded once and always reaches the current object through `runtime`.
const runtime = { ctx: null, env: null };
const scheduler = new Scheduler(() => runtime.ctx);
let server = null; // { app, realtime, live }
const sockets = new WeakMap(); // WebSocket → LiveSocket
let storedBytes = { value: 0, at: 0, refreshing: false };

const ASSETS = { 'kitchen.json.gz': kitchen };

// Bytes used: this database plus every file shard. Shards are asked at most every 10 minutes, in the background.
function dataBytes() {
  const hub = runtime.ctx.storage.sql.databaseSize;
  if (Date.now() - storedBytes.at > 10 * 60 * 1000 && !storedBytes.refreshing) {
    storedBytes.refreshing = true;
    const ids = Array.from({ length: SHARDS }, (_, n) => runtime.env.FILES.idFromName(`shard-${n}`));
    Promise.all(ids.map((id) => runtime.env.FILES.get(id).usage()))
      .then((sizes) => { storedBytes = { value: sizes.reduce((a, b) => a + b, 0), at: Date.now(), refreshing: false }; })
      .catch(() => { storedBytes.refreshing = false; });
  }
  return hub + storedBytes.value;
}

async function load() {
  const db = sqliteDb(() => runtime.ctx);
  migrate(db, migrations);
  platform.setup({
    db,
    files: cloudFiles(() => runtime.env),
    fetchUrl,
    asset: (name) => {
      if (!ASSETS[name]) throw new Error(`No bundled asset called ${name}`);
      return Buffer.from(ASSETS[name]);
    },
    every: (ms, fn, options) => scheduler.add(ms, fn, options),
    dataBytes,
    freeBytes: async () => Number.MAX_SAFE_INTEGER, // the upload limits in lib/limits.js keep storage in bounds
  });
  // Loaded only now, after the platform is set: these modules use the database as soon as they load.
  const { createApp } = await import('../server/app.js');
  const realtime = await import('../server/realtime.js');
  const { startJobs } = await import('../server/jobs.js');
  const auth = await import('../server/lib/auth.js');
  startJobs();
  return { app: createApp(), realtime, auth };
}

function transport(ws) {
  return {
    send: (text) => ws.send(text),
    close: (code, reason) => ws.close(code, reason),
    save: (json) => ws.serializeAttachment(json),
  };
}

export class Hub extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    runtime.ctx = ctx;
    runtime.env = env;
    scheduler.reset();
    ctx.blockConcurrencyWhile(async () => {
      if (!server) server = await load();
      else migrate(platform.get('db'), migrations); // same process, new object: storage is the same, but be sure
      // Start live connections afresh, then take back the ones still open from before the object slept.
      server.realtime.init();
      const live = server.realtime.live();
      for (const ws of ctx.getWebSockets()) {
        const socket = live.restore(transport(ws), { headers: {} }, ws.deserializeAttachment());
        if (socket) sockets.set(ws, socket);
      }
    });
  }

  async fetch(request) {
    const url = new URL(request.url);
    let response;
    if (url.pathname === '/live') response = this.openLive(request, url);
    else response = await server.app.handle(request, { ip: request.headers.get('CF-Connecting-IP') || '0.0.0.0' });
    await scheduler.arm();
    return response;
  }

  // A new live connection: only from our own pages, and only with a working login (checked by realtime.js).
  openLive(request, url) {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('Expected a WebSocket.', { status: 426 });
    let origin = null;
    try { origin = new URL(request.headers.get('Origin')).host; } catch { /* missing or junk */ }
    if (origin !== url.host) return new Response('Forbidden', { status: 403 });
    if (!server.auth.authenticate(request.headers.get('Cookie'))) return new Response('You are not logged in.', { status: 401 });
    const [client, ws] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(ws);
    const headers = Object.fromEntries([...request.headers].map(([k, v]) => [k.toLowerCase(), v]));
    const socket = server.realtime.live().accept(transport(ws), { headers });
    if (socket) sockets.set(ws, socket);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, message) {
    if (typeof message === 'string') sockets.get(ws)?.receive(message);
    await scheduler.arm();
  }

  webSocketClose(ws, code) {
    sockets.get(ws)?.closed();
    sockets.delete(ws);
    // Codes like 1005/1006 only describe what happened and can't be sent back.
    try { ws.close(code >= 1000 && code < 5000 && ![1004, 1005, 1006, 1015].includes(code) ? code : 1000); } catch { /* already closed */ }
  }

  webSocketError(ws) {
    sockets.get(ws)?.closed();
    sockets.delete(ws);
  }

  async alarm() {
    await scheduler.run();
  }
}

export { shardStub };
