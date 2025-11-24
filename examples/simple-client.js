#!/usr/bin/env node

/**
 * Simple WebSocket client example for bob-control
 * This demonstrates how to build custom UIs that connect to the bob-control server
 */

import WebSocket from 'ws';
import readline from 'readline';

const SERVER_URL = process.argv[2] || 'ws://127.0.0.1:8420';

const ws = new WebSocket(SERVER_URL);
let currentRoomId = null;

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

ws.on('open', () => {
  console.log(`Connected to ${SERVER_URL}`);
  console.log('Commands:');
  console.log('  /create <agent> [dir] - Create a room');
  console.log('  /list                 - List rooms');
  console.log('  /join <room-id>       - Join a room');
  console.log('  /quit                 - Exit');
  console.log('  (any other text)      - Send message to agent');
  console.log('');
  prompt();
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());

  switch (msg.type) {
    case 'welcome':
      console.log(`\nWelcome! Client ID: ${msg.clientId.slice(0, 8)}`);
      if (msg.rooms.length > 0) {
        console.log('Active rooms:');
        msg.rooms.forEach(r => console.log(`  - ${r.name} (${r.agentType})`));
      }
      break;

    case 'room_joined':
      currentRoomId = msg.roomId;
      console.log(`\nJoined room: ${msg.roomName} [${msg.agentType}]`);
      console.log(`Directory: ${msg.directory}`);
      console.log(`Status: ${msg.status}`);
      break;

    case 'message':
      const role = msg.message.role;
      const content = msg.message.content;
      const prefix = role === 'agent' ? '[Agent]' : role === 'user' ? '[You]' : '[System]';
      console.log(`\n${prefix} ${content}`);
      break;

    case 'stream':
      process.stdout.write(msg.chunk);
      break;

    case 'status':
      console.log(`\n[Status] ${msg.status}`);
      break;

    case 'room_list':
      console.log('\nRooms:');
      msg.rooms.forEach((r, i) => {
        console.log(`  ${i + 1}. ${r.name} [${r.agentType}] - ${r.status}`);
      });
      break;

    case 'error':
      console.error(`\n[Error] ${msg.error}`);
      break;
  }

  prompt();
});

ws.on('close', () => {
  console.log('Disconnected');
  process.exit(0);
});

ws.on('error', (err) => {
  console.error('Connection error:', err.message);
  process.exit(1);
});

function prompt() {
  rl.question('> ', (input) => {
    handleInput(input.trim());
  });
}

function handleInput(input) {
  if (!input) {
    prompt();
    return;
  }

  if (input.startsWith('/')) {
    const parts = input.slice(1).split(/\s+/);
    const cmd = parts[0];
    const args = parts.slice(1);

    switch (cmd) {
      case 'create':
        ws.send(JSON.stringify({
          type: 'create_room',
          agentType: args[0] || 'claude',
          directory: args[1] || process.cwd(),
          branch: args[2]
        }));
        break;

      case 'list':
        ws.send(JSON.stringify({ type: 'list_rooms' }));
        break;

      case 'join':
        ws.send(JSON.stringify({
          type: 'join_room',
          roomId: args[0]
        }));
        break;

      case 'leave':
        if (currentRoomId) {
          ws.send(JSON.stringify({
            type: 'leave_room',
            roomId: currentRoomId
          }));
          currentRoomId = null;
        }
        break;

      case 'quit':
        ws.close();
        rl.close();
        return;

      default:
        console.log('Unknown command');
    }
  } else {
    // Send as message to current room
    if (!currentRoomId) {
      console.log('Not in a room. Use /create or /join first.');
    } else {
      ws.send(JSON.stringify({
        type: 'send_message',
        roomId: currentRoomId,
        content: input
      }));
    }
  }

  prompt();
}
