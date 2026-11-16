// A test client for /live (the protocol in server/live.js), with the socket.io-style calls the tests use.
const WebSocket = require('ws');

function liveClient(base, { cookie = '', origin = base } = {}) {
  const handlers = new Map();
  const acks = new Map();
  let nextAck = 1;
  const ws = new WebSocket(`${base.replace(/^http/, 'ws')}/live`, { headers: { cookie, origin } });
  const fire = (event, ...args) => { for (const fn of [...(handlers.get(event) || [])]) fn(...args); };
  const client = {
    id: null,
    on(event, fn) { if (!handlers.has(event)) handlers.set(event, []); handlers.get(event).push(fn); return client; },
    off(event, fn) { handlers.set(event, (handlers.get(event) || []).filter((f) => f !== fn)); return client; },
    emit(event, ...args) {
      let ackId;
      if (typeof args[args.length - 1] === 'function') { ackId = nextAck++; acks.set(ackId, args.pop()); }
      const send = () => ws.send(JSON.stringify(ackId ? [event, args, ackId] : [event, args]));
      if (ws.readyState === WebSocket.OPEN) send(); else ws.once('open', send);
      return client;
    },
    close() { ws.close(); },
    raw: ws,
  };
  ws.on('message', (data) => {
    const packet = JSON.parse(data.toString());
    if (packet[0] === 'hello') { client.id = packet[1][0]; fire('connect'); return; }
    if (packet[0] === 'ack') { const fn = acks.get(packet[1]); acks.delete(packet[1]); fn?.(...packet[2]); return; }
    fire(packet[0], ...packet[1]);
  });
  ws.on('close', (code, reason) => { fire('close', code, reason.toString()); fire('disconnect', code); });
  ws.on('unexpected-response', (req, res) => fire('refused', res.statusCode));
  ws.on('error', () => {});
  return client;
}

module.exports = { liveClient };
