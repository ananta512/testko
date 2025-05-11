// server.js  –  WebSocket-to-TCP Stratum proxy
//
// 1. A miner connects:  ws://HOST/<base64(host:port)>
// 2. We decode <base64>, open a raw TCP socket, and pipe data.
// 3. TCP → WS:  buffer-by-line so each JSON object is sent
//               in *one* WebSocket *text* message.
// 4. WS → TCP:  ensure every message ends with '\n'.
//
// Author: 2025-05-12  Fixes: message framing, disable permessage-deflate
//
// --------------------------------------------------------------------

import http              from 'http';
import net               from 'net';
import { WebSocketServer } from 'ws';          //  ws >= 8.13
import { Buffer }        from 'buffer';
import { URL }           from 'url';

// -----------------------------
// 1) basic HTTP (optional)
// -----------------------------
const httpServer = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('OK\n');
});
httpServer.listen(process.env.PORT || 8080, () =>
  console.log('[proxy] listening on', httpServer.address())
);

// -----------------------------
// 2) WebSocket server
// -----------------------------
const wss = new WebSocketServer({
  server: httpServer,
  // disable compression – small JSON packets don’t need it and some miners dislike it
  perMessageDeflate: false,
});

wss.on('connection', (ws, req) => {
  // ---------------------------------------------
  // 2.1) decode target host:port from URL path
  // ---------------------------------------------
  const pathname = new URL(req.url, 'ws://dummy').pathname; // e.g. "/c29tZS5ob3N0OjEyMzQ="
  const b64      = pathname.replace(/^\//, '');
  let target;
  try {
    target = Buffer.from(b64, 'base64').toString('utf8');   // "host:port"
  } catch (e) {
    ws.close(1008, 'bad base64');
    return;
  }
  const [host, portStr] = target.split(':');
  const port = Number(portStr);
  if (!host || !port) {
    ws.close(1008, 'need host:port');
    return;
  }

  console.log(`[proxy] ${req.socket.remoteAddress} ⇒ ${host}:${port}`);

  // ---------------------------------------------
  // 2.2) open raw TCP to pool
  // ---------------------------------------------
  const tcp = net.connect({ host, port }, () => {
    ws.send(JSON.stringify({ type: 'status', msg: 'tcp_connected' }));
  });

  // -----------------------------
  // TCP  →  WS  (with framing)
  // -----------------------------
  let partial = '';
  tcp.on('data', buf => {
    let chunk = buf.toString('utf8');
    if (partial) {
      chunk = partial + chunk;
      partial = '';
    }
    const pieces = chunk.split('\n');
    pieces.forEach((msg, idx) => {
      if (idx === pieces.length - 1 && chunk[chunk.length - 1] !== '\n') {
        // last piece is incomplete → save for later
        partial = msg;
      } else if (msg !== '') {
        ws.send(msg);      // text frame
      }
    });
  });

  // -----------------------------
  // WS  →  TCP  (ensure newline)
  // -----------------------------
  ws.on('message', data => {
    // miner usually sends strings; but accept Buffers too
    const str = (typeof data === 'string') ? data : data.toString('utf8');
    tcp.write(str.endsWith('\n') ? str : str + '\n');
  });

  // -----------------------------
  // error / close handling
  // -----------------------------
  const shutdown = why => {
    if (ws.readyState === ws.OPEN) ws.close(1011, why);
    tcp.destroy();
  };

  tcp.on('error',   err =>  shutdown('tcp_error:' + err.code));
  ws .on('error',   ()  =>  shutdown('ws_error'));
  ws .on('close',   ()  =>  tcp.destroy());
  tcp.on('close',   ()  =>  shutdown('tcp_closed'));

  // optional keep-alive (helps some free hosts)
  const KA = setInterval(() => ws.ping(), 15000);
  ws.on('close', () => clearInterval(KA));
});
