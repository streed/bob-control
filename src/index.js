#!/usr/bin/env node

import { program } from 'commander';
import { UIController } from './ui/index.js';
import { BobServer } from './server/index.js';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

// Load configuration from config.json
let config = {};
const configPath = join(process.cwd(), 'config.json');
if (existsSync(configPath)) {
  try {
    const configFileContent = readFileSync(configPath, 'utf8');
    config = JSON.parse(configFileContent);
    console.log('Loaded config.json');
  } catch (error) {
    console.error(`Error loading config.json: ${error.message}`);
  }
}

program
  .name('bob')
  .description('Multi-agent control system with irssi-style terminal UI')
  .version('1.0.0');

program
  .option('-p, --port <port>', 'WebSocket server port')
  .option('-H, --host <host>', 'WebSocket server host')
  .option('-c, --connect <address>', 'Connect to remote server (host:port)')
  .option('-n, --name <name>', 'Set your display name')
  .option('-s, --server-only', 'Run server only (no UI)')
  .option('--no-worktree', 'Disable git worktree isolation (work directly in repo)')
  .action(async (options) => {
    if (options.serverOnly) {
      // Server-only mode
      const server = new BobServer({
        port: options.port ? parseInt(options.port, 10) : (config.server?.port || 8420),
        host: options.host || config.server?.host || '127.0.0.1',
        useWorktrees: options.worktree !== false,
        authToken: config.server?.authToken || null,
        requireAuth: config.server?.requireAuth || false
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
        port: options.port ? parseInt(options.port, 10) : (config.server?.port || 8420),
        host: options.host || config.server?.host || '127.0.0.1',
        connect: options.connect,
        name: options.name || config.ui?.name,
        serverMode: !options.connect,
        useWorktrees: options.noWorktree === undefined,
        authToken: config.server?.authToken || null,
        requireAuth: config.server?.requireAuth || false
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
  .option('-p, --port <port>', 'WebSocket server port')
  .action(async (agent, options) => {
    const ui = new UIController({
      port: options.port ? parseInt(options.port, 10) : (config.server?.port || 8420),
      host: config.server?.host || '127.0.0.1',
      serverMode: true,
      authToken: config.server?.authToken || null,
      requireAuth: config.server?.requireAuth || false
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
  .option('-p, --port <port>', 'WebSocket server port')
  .option('-H, --host <host>', 'WebSocket server host')
  .action(async (options) => {
    const server = new BobServer({
      port: options.port ? parseInt(options.port, 10) : (config.server?.port || 8420),
      host: options.host || config.server?.host || '127.0.0.1',
      authToken: config.server?.authToken || null,
      requireAuth: config.server?.requireAuth || false
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
