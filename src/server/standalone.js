#!/usr/bin/env node

import { BobServer } from './index.js';

const server = new BobServer({
  port: process.env.BOB_PORT || 8420,
  host: process.env.BOB_HOST || '127.0.0.1'
});

server.on('log', (msg) => console.log(`[BOB] ${msg}`));
server.on('error', (err) => console.error(`[BOB ERROR] ${err.message}`));
server.on('roomCreated', (room) => console.log(`[ROOM+] ${room.name} (${room.agentType})`));
server.on('roomDestroyed', (roomId) => console.log(`[ROOM-] ${roomId}`));

async function main() {
  try {
    await server.start();
    console.log(`Bob Control Server v1.0.0`);
    console.log(`Listening on ws://${server.host}:${server.port}`);
    console.log(`Press Ctrl+C to stop`);
  } catch (error) {
    console.error('Failed to start server:', error.message);
    process.exit(1);
  }
}

process.on('SIGINT', async () => {
  console.log('\nShutting down...');
  await server.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await server.stop();
  process.exit(0);
});

main();
