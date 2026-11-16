// The browser side of live connections: a WebSocket to /live speaking the small protocol in server/live.js,
// with the parts of socket.io's client the app uses (on, emit with an answer callback, reconnecting).
//   events: 'connect', 'disconnect', 'connect_error' (Error), plus anything the server sends.
const BACKOFF_MS = [500, 1000, 2000, 4000, 8000, 15000];
const UNAUTHORIZED = 4401;

export function connectLive(path = '/live') {
  const handlers = new Map();
  const pendingAcks = new Map();
  let ws = null;
  let attempt = 0;
  let nextAck = 1;
  let timer = null;
  let stopped = false;

  const fire = (event, ...args) => {
    for (const fn of handlers.get(event) || []) {
      try { fn(...args); } catch (err) { console.error(`live handler for "${event}" failed:`, err); }
    }
  };

  const client = {
    id: null,
    connected: false,
    on(event, fn) {
      if (!handlers.has(event)) handlers.set(event, []);
      handlers.get(event).push(fn);
      return client;
    },
    // emit(event, ...args, callback?): a trailing function gets the server's answer.
    emit(event, ...args) {
      if (!client.connected) return client; // like socket.io's default: nothing is queued while offline
      let ackId;
      if (typeof args[args.length - 1] === 'function') {
        ackId = nextAck++;
        pendingAcks.set(ackId, args.pop());
      }
      ws.send(JSON.stringify(ackId ? [event, args, ackId] : [event, args]));
      return client;
    },
    disconnect() {
      stopped = true;
      clearTimeout(timer);
      ws?.close(1000);
    },
  };

  function open() {
    clearTimeout(timer);
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${path}`;
    ws = new WebSocket(url);
    ws.onmessage = (event) => {
      let packet;
      try { packet = JSON.parse(event.data); } catch { return; }
      if (!Array.isArray(packet)) return;
      if (packet[0] === 'hello') {
        client.id = packet[1][0];
        client.connected = true;
        attempt = 0;
        fire('connect');
        return;
      }
      // The server is ending this connection: count it as gone now, not when the close handshake finishes.
      if (packet[0] === 'bye') {
        client.connected = false;
        fire('disconnect');
        ws.close(1000);
        return;
      }
      if (packet[0] === 'ack') {
        const fn = pendingAcks.get(packet[1]);
        pendingAcks.delete(packet[1]);
        fn?.(...(packet[2] || []));
        return;
      }
      fire(packet[0], ...(packet[1] || []));
    };
    ws.onclose = (event) => {
      const was = client.connected;
      client.connected = false;
      pendingAcks.clear();
      if (event.code === UNAUTHORIZED) fire('connect_error', new Error(event.reason || 'You are not logged in.'));
      // Refused before it even opened: maybe the login ended (the server answers 401 then). Ask, to be sure.
      if (!was && event.code !== UNAUTHORIZED) {
        fetch('/api/users/@me', { credentials: 'same-origin' })
          .then((res) => { if (res.status === 401) fire('connect_error', new Error('You are not logged in.')); })
          .catch(() => {});
      }
      if (was) fire('disconnect');
      if (stopped) return;
      // Back off between tries, a little random so many tabs don't all retry at the same moment.
      const wait = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)] * (0.75 + Math.random() / 2);
      attempt += 1;
      timer = setTimeout(open, wait);
    };
  }

  // Coming back online (or to a hidden tab) retries straight away instead of waiting out the backoff.
  window.addEventListener('online', () => { if (!client.connected && !stopped) open(); });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !client.connected && !stopped && ws?.readyState === WebSocket.CLOSED) open();
  });

  open();
  return client;
}
