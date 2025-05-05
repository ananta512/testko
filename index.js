// index.js
require('dotenv').config();
const WebSocket = require('ws');

// The target mining WebSocket URL
const TARGET = process.env.TARGET_URL; 
// The port your proxy will listen on
const PORT   = process.env.PORT || 8080;

const server = new WebSocket.Server({ port: PORT }, () => {
  console.log(`Proxy listening on ws://0.0.0.0:${PORT}`);
});

server.on('connection', (clientSocket) => {
  // For each incoming client, open a connection to the real pool
  const upstream = new WebSocket(TARGET);

  // Pipe messages client → upstream
  clientSocket.on('message', msg => {
    if (upstream.readyState === WebSocket.OPEN) {
      upstream.send(msg);
    }
  });

  // Pipe messages upstream → client
  upstream.on('message', msg => {
    if (clientSocket.readyState === WebSocket.OPEN) {
      clientSocket.send(msg);
    }
  });

  // Clean up on close
  const cleanup = () => {
    if (clientSocket.readyState !== WebSocket.CLOSED) clientSocket.close();
    if (upstream.readyState !== WebSocket.CLOSED) upstream.close();
  };
  clientSocket.on('close', cleanup);
  upstream.on('close',   cleanup);
  upstream.on('error',   cleanup);
});
