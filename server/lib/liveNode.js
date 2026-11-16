// Live connections on a computer: WebSockets at /live through the `ws` package, handed to the LiveServer.
const { WebSocketServer } = require('ws');
const { MAX_FRAME } = require('../live');

const PING_MS = 30 * 1000;

function attach(httpServer, live) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME });

  httpServer.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://x');
    // Only our own pages may open a live connection (stops other sites riding on the login cookie).
    const origin = req.headers.origin;
    let sameSite = false;
    try { sameSite = Boolean(origin) && new URL(origin).host === req.headers.host; } catch { /* bad origin */ }
    if (url.pathname !== '/live' || !sameSite) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const transport = { send: (text) => ws.send(text), close: (code, reason) => ws.close(code, reason) };
      const conn = live.accept(transport, { headers: req.headers });
      if (!conn) return;
      ws.isAlive = true;
      ws.on('pong', () => { ws.isAlive = true; });
      ws.on('message', (data, isBinary) => { if (!isBinary) conn.receive(data.toString('utf8')); });
      ws.on('close', () => conn.closed());
      ws.on('error', () => conn.closed());
    });
  });

  // Connections that stopped answering (a laptop lid closed, a phone in a tunnel) are dropped.
  const timer = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) { ws.terminate(); continue; }
      ws.isAlive = false;
      ws.ping();
    }
  }, PING_MS);
  timer.unref();
  return wss;
}

module.exports = { attach };
