#!/usr/bin/env node

import { program } from 'commander';
import { UIController } from './ui/index.js';
import { BobServer } from './server/index.js';

program
  .name('bob')
  .description('Multi-agent control system with irssi-style terminal UI')
  .version('1.0.0');

program
  .option('-p, --port <port>', 'WebSocket server port', '8420')
  .option('-H, --host <host>', 'WebSocket server host', '127.0.0.1')
  .option('-c, --connect <address>', 'Connect to remote server (host:port)')
  .option('-n, --name <name>', 'Set your display name')
  .option('-s, --server-only', 'Run server only (no UI)')
  .option('--no-worktree', 'Disable git worktree isolation (work directly in repo)')
  .action(async (options) => {
    if (options.serverOnly) {
      // Server-only mode
      const server = new BobServer({
        port: parseInt(options.port, 10),
        host: options.host,
        useWorktrees: options.worktree !== false
      });

      server.on('log', (msg) => console.log(`[BOB] ${msg}`));
      server.on('error', (err) => console.error(`[ERROR] ${err.message}`));
      server.on('roomCreated', (room) => {
        console.log(`[ROOM+] ${room.name} (${room.agentType})`);
      });
      server.on('roomDestroyed', (roomId) => {
        console.log(`[ROOM-] ${roomId}`);
      });

      await server.start();
      console.log(`Bob Control Server v1.0.0`);
      console.log(`WebSocket: ws://${server.host}:${server.port}`);
      console.log(`Press Ctrl+C to stop`);

      process.on('SIGINT', async () => {
        console.log('\nShutting down...');
        await server.stop();
        process.exit(0);
      });
    } else {
      // UI mode
      const ui = new UIController({
        port: parseInt(options.port, 10),
        host: options.host,
        connect: options.connect,
        name: options.name,
        serverMode: !options.connect,
        useWorktrees: options.worktree !== false
      });

      try {
        await ui.start();
      } catch (error) {
        console.error('Failed to start:', error.message);
        process.exit(1);
      }
    }
  });

// Quick create command - start UI and immediately create a room
program
  .command('create <agent>')
  .description('Start and create a room with the specified agent')
  .option('-d, --directory <path>', 'Working directory', process.cwd())
  .option('-b, --branch <name>', 'Create/checkout git branch')
  .option('-p, --port <port>', 'WebSocket server port', '8420')
  .action(async (agent, options) => {
    const ui = new UIController({
      port: parseInt(options.port, 10),
      serverMode: true
    });

    await ui.start();

    // Create room after UI starts
    setTimeout(async () => {
      const ctx = ui.createCommandContext();
      await ctx.createRoom([agent, options.directory, options.branch]);
    }, 500);
  });

// Server command
program
  .command('server')
  .description('Run server only (no UI)')
  .option('-p, --port <port>', 'WebSocket server port', '8420')
  .option('-H, --host <host>', 'WebSocket server host', '127.0.0.1')
  .action(async (options) => {
    const server = new BobServer({
      port: parseInt(options.port, 10),
      host: options.host
    });

    server.on('log', (msg) => console.log(`[BOB] ${msg}`));
    server.on('error', (err) => console.error(`[ERROR] ${err.message}`));

    await server.start();
    console.log(`Bob Control Server v1.0.0`);
    console.log(`WebSocket: ws://${server.host}:${server.port}`);

    process.on('SIGINT', async () => {
      await server.stop();
      process.exit(0);
    });
  });

// Connect command
program
  .command('connect <address>')
  .description('Connect to a remote bob-control server')
  .option('-n, --name <name>', 'Set your display name')
  .action(async (address, options) => {
    const ui = new UIController({
      connect: address,
      name: options.name,
      serverMode: false
    });

    await ui.start();
  });

program.parse();
