// Live connections: a small socket.io-like layer over plain WebSockets. The same code runs on a computer
// (the `ws` package) and on Cloudflare (Durable Object WebSockets); only the transport differs.
//
// Wire format, JSON text frames:
//   client → server  [event, args, ackId?]
//   server → client  [event, args]   or   ['ack', ackId, args]
//   on open          ['hello', [socketId]]
//   before a kick    ['bye', [code]]   (the client closes too: some runtimes don't deliver a server's close)
// A connection that fails the login check is closed with code 4401 before 'hello'.
//
// A transport is { send(text), close(code, reason), save(json) }. `save` keeps a socket's id and data with
// the connection, so a Durable Object that slept can wake up and carry on (see `restore`).
const crypto = require('node:crypto');

const MAX_FRAME = 256 * 1024;
const CLOSE_UNAUTHORIZED = 4401;
const CLOSE_KICKED = 4000;

class LiveSocket {
  constructor(server, transport, request, { id, data } = {}) {
    this.server = server;
    this.transport = transport;
    this.request = request; // { headers }
    this.id = id || crypto.randomBytes(12).toString('base64url');
    this.data = data || {};
    this.rooms = new Set();
    this.handlers = new Map();
    this.middlewares = [];
    this.open = true;
    this.join(this.id);
  }

  on(event, fn) {
    if (!this.handlers.has(event)) this.handlers.set(event, []);
    this.handlers.get(event).push(fn);
  }

  // Packet middleware: fn([event, ...args], next). Not calling next() drops the packet.
  use(fn) {
    this.middlewares.push(fn);
  }

  emit(event, ...args) {
    if (!this.open) return;
    try {
      this.transport.send(JSON.stringify([event, args]));
    } catch {
      // The connection is going away; its close event cleans up.
    }
  }

  join(room) {
    for (const r of [].concat(room)) {
      this.rooms.add(r);
      this.server.roomOf(r).add(this);
    }
  }

  leave(room) {
    this.rooms.delete(room);
    const set = this.server.rooms.get(room);
    if (!set) return;
    set.delete(this);
    if (!set.size) this.server.rooms.delete(room);
  }

  // Everyone in `room` except this socket.
  to(room) {
    return this.server.to(room, this);
  }

  // Keeps this socket's id and data with the connection (no-op on a computer).
  save() {
    this.transport.save?.(JSON.stringify({ id: this.id, data: this.data }));
  }

  disconnect(kick = false) {
    if (!this.open) return;
    this.emit('bye', kick ? CLOSE_KICKED : 1000);
    try {
      this.transport.close(kick ? CLOSE_KICKED : 1000, kick ? 'Disconnected by the server' : 'Bye');
    } catch {
      // already closed
    }
    this.closed();
  }

  // The connection is gone: leave every room and tell the 'disconnect' handlers (once).
  closed() {
    if (!this.open) return;
    this.open = false;
    for (const room of [...this.rooms]) this.leave(room);
    this.server.sockets.delete(this.id);
    for (const fn of this.handlers.get('disconnect') || []) {
      try { fn(); } catch (err) { console.error('disconnect handler failed:', err); }
    }
  }

  // A text frame from the client.
  receive(text) {
    if (typeof text !== 'string' || text.length > MAX_FRAME) return;
    let packet;
    try {
      packet = JSON.parse(text);
    } catch {
      return;
    }
    if (!Array.isArray(packet) || typeof packet[0] !== 'string' || !Array.isArray(packet[1] ?? [])) return;
    const [event, args = [], ackId] = packet;
    if (event === 'disconnect' || event === 'connection') return; // reserved names
    const run = (i) => {
      if (i < this.middlewares.length) return this.middlewares[i]([event, ...args], () => run(i + 1));
      const fns = this.handlers.get(event);
      if (!fns) return undefined;
      const callArgs = [...args];
      if (Number.isSafeInteger(ackId)) {
        let answered = false;
        callArgs.push((...reply) => {
          if (answered || !this.open) return;
          answered = true;
          try { this.transport.send(JSON.stringify(['ack', ackId, reply])); } catch { /* gone */ }
        });
      }
      for (const fn of fns) {
        try {
          fn(...callArgs);
        } catch (err) {
          console.error(`live event "${event}" failed:`, err);
        }
      }
      return undefined;
    };
    run(0);
  }
}

// A set of sockets to send to: everyone in some rooms, maybe minus one.
class Broadcast {
  constructor(server, rooms, except) {
    this.server = server;
    this.rooms = rooms;
    this.except = except;
  }

  to(room) {
    return new Broadcast(this.server, [...this.rooms, ...[].concat(room)], this.except);
  }

  get volatile() {
    return this;
  }

  targets() {
    const out = new Set();
    for (const room of this.rooms) for (const s of this.server.rooms.get(room) || []) if (s !== this.except) out.add(s);
    return out;
  }

  emit(event, ...args) {
    const targets = this.targets();
    if (!targets.size) return;
    const text = JSON.stringify([event, args]);
    for (const s of targets) {
      if (!s.open) continue;
      try { s.transport.send(text); } catch { /* closing */ }
    }
  }

  socketsJoin(room) {
    for (const s of this.targets()) s.join(room);
  }

  socketsLeave(room) {
    for (const s of this.targets()) s.leave(room);
  }

  disconnectSockets(kick = true) {
    for (const s of this.targets()) s.disconnect(kick);
  }
}

class LiveServer {
  constructor() {
    this.sockets = new Map(); // id → LiveSocket
    this.rooms = new Map(); // room → Set<LiveSocket>
    this.middlewares = [];
    this.connectionHandlers = [];
  }

  roomOf(room) {
    if (!this.rooms.has(room)) this.rooms.set(room, new Set());
    return this.rooms.get(room);
  }

  // Connection middleware: fn(socket, next). next(err) refuses the connection.
  use(fn) {
    this.middlewares.push(fn);
  }

  // fn(socket, { restored }): restored is true when a sleeping Durable Object woke up with this connection.
  on(event, fn) {
    if (event !== 'connection') throw new Error(`LiveServer only has a 'connection' event, not "${event}".`);
    this.connectionHandlers.push(fn);
  }

  to(room, except = null) {
    return new Broadcast(this, [].concat(room), except);
  }

  in(room) {
    return this.to(room);
  }

  // A new connection. Returns the socket, or null if a middleware refused it (the transport is closed).
  accept(transport, request) {
    const socket = new LiveSocket(this, transport, request);
    let refused = null;
    for (const fn of this.middlewares) {
      let passed = false;
      fn(socket, (err) => {
        if (err) refused = err;
        else passed = true;
      });
      if (refused || !passed) break;
    }
    if (refused || socket.data.userId == null) {
      for (const room of [...socket.rooms]) socket.leave(room);
      try { transport.close(CLOSE_UNAUTHORIZED, (refused?.message || 'Refused').slice(0, 120)); } catch { /* gone */ }
      return null;
    }
    this.sockets.set(socket.id, socket);
    socket.save();
    socket.emit('hello', socket.id);
    for (const fn of this.connectionHandlers) fn(socket, { restored: false });
    return socket;
  }

  // A connection that was already open before a Durable Object slept. `saved` is what socket.save() stored.
  restore(transport, request, saved) {
    let state;
    try {
      state = JSON.parse(saved);
    } catch {
      state = null;
    }
    if (!state?.id || state.data?.userId == null) {
      try { transport.close(CLOSE_UNAUTHORIZED, 'Please reconnect'); } catch { /* gone */ }
      return null;
    }
    const socket = new LiveSocket(this, transport, request, state);
    this.sockets.set(socket.id, socket);
    for (const fn of this.connectionHandlers) fn(socket, { restored: true });
    return socket;
  }

  close() {
    for (const s of [...this.sockets.values()]) s.disconnect(true);
  }
}

module.exports = { LiveServer, MAX_FRAME, CLOSE_UNAUTHORIZED };
