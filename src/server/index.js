import { WebSocketServer } from 'ws';
import { EventEmitter } from 'events';
import { RoomManager } from './roomManager.js';
import { v4 as uuidv4 } from 'uuid';

export class BobServer extends EventEmitter {
  constructor(options = {}) {
    super();
    this.port = options.port || 8420;
    this.host = options.host || '127.0.0.1';
    this.wss = null;
    this.roomManager = new RoomManager({
      useWorktrees: options.useWorktrees !== false  // Default to true
    });
    this.clients = new Map(); // All connected clients

    // Authentication configuration
    this.authToken = options.authToken || null; // Optional token-based auth
    this.requireAuth = options.requireAuth || false;

    // Forward room manager events
    this.roomManager.on('roomCreated', (room) => this.emit('roomCreated', room));
    this.roomManager.on('roomDestroyed', (roomId) => this.emit('roomDestroyed', roomId));
    this.roomManager.on('log', (msg) => this.emit('log', msg));
  }

  /**
   * Sanitize error message for client consumption
   * Removes sensitive information like file paths, stack traces, etc.
   */
  sanitizeError(error) {
    const message = error?.message || String(error);

    // List of patterns to sanitize
    const sensitivePatterns = [
      // File paths
      /\/home\/[^\s]+/g,
      /\/Users\/[^\s]+/g,
      /C:\\Users\\[^\s]+/gi,
      // Stack traces
      /\s+at\s+.+\(.+:\d+:\d+\)/g,
      // Internal module paths
      /node_modules\/[^\s]+/g,
      // Environment variable hints
      /\$[A-Z_]+/g,
    ];

    let sanitized = message;
    for (const pattern of sensitivePatterns) {
      sanitized = sanitized.replace(pattern, '[redacted]');
    }

    // Truncate very long messages
    if (sanitized.length > 500) {
      sanitized = sanitized.slice(0, 500) + '...';
    }

    return sanitized;
  }

  start() {
    return new Promise((resolve, reject) => {
      try {
        this.wss = new WebSocketServer({
          port: this.port,
          host: this.host
        });

        this.wss.on('listening', () => {
          this.emit('log', `WebSocket server listening on ws://${this.host}:${this.port}`);
          resolve();
        });

        this.wss.on('connection', (ws, req) => {
          this.handleConnection(ws, req);
        });

        this.wss.on('error', (error) => {
          this.emit('error', error);
          reject(error);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  handleConnection(ws, req) {
    const clientId = uuidv4();
    const clientInfo = {
      id: clientId,
      name: null,
      rooms: new Set(),
      connectedAt: new Date(),
      ip: req.socket.remoteAddress
    };

    this.clients.set(clientId, { ws, info: clientInfo });
    this.emit('clientConnected', clientId);

    // Send welcome message
    ws.send(JSON.stringify({
      type: 'welcome',
      clientId,
      serverVersion: '1.0.0',
      rooms: this.roomManager.listRooms(),
      timestamp: Date.now()
    }));

    ws.on('message', async (data) => {
      try {
        const message = JSON.parse(data.toString());
        await this.handleMessage(clientId, message);
      } catch (error) {
        ws.send(JSON.stringify({
          type: 'error',
          error: error.message,
          timestamp: Date.now()
        }));
      }
    });

    ws.on('close', () => {
      this.handleDisconnect(clientId);
    });

    ws.on('error', (error) => {
      this.emit('log', `Client ${clientId} error: ${error.message}`);
    });
  }

  async handleMessage(clientId, message) {
    const client = this.clients.get(clientId);
    if (!client) return;

    const { ws, info } = client;

    switch (message.type) {
      case 'set_name':
        info.name = message.name;
        ws.send(JSON.stringify({
          type: 'name_set',
          name: message.name,
          timestamp: Date.now()
        }));
        break;

      case 'create_room':
        const room = await this.roomManager.createRoom({
          name: message.name,
          agentType: message.agentType || 'claude',
          directory: message.directory || process.cwd(),
          branch: message.branch,
          agentOptions: message.agentOptions || {}
        });
        const roomClientId = room.addClient(ws, info);
        info.rooms.add(room.id);
        this.emit('log', `Room ${room.name} created by ${info.name || clientId.slice(0, 8)}`);
        break;

      case 'join_room':
        const targetRoom = message.roomId
          ? this.roomManager.getRoom(message.roomId)
          : this.roomManager.getRoomByName(message.roomName);

        if (targetRoom) {
          targetRoom.addClient(ws, info);
          info.rooms.add(targetRoom.id);
        } else {
          ws.send(JSON.stringify({
            type: 'error',
            error: 'Room not found',
            timestamp: Date.now()
          }));
        }
        break;

      case 'leave_room':
        const leaveRoom = this.roomManager.getRoom(message.roomId);
        if (leaveRoom) {
          leaveRoom.removeClient(clientId);
          info.rooms.delete(message.roomId);
          ws.send(JSON.stringify({
            type: 'room_left',
            roomId: message.roomId,
            timestamp: Date.now()
          }));
        }
        break;

      case 'send_message':
        const msgRoom = this.roomManager.getRoom(message.roomId);
        if (msgRoom) {
          await msgRoom.sendToAgent(message.content, clientId);
        } else {
          ws.send(JSON.stringify({
            type: 'error',
            error: 'Room not found',
            timestamp: Date.now()
          }));
        }
        break;

      case 'list_rooms':
        ws.send(JSON.stringify({
          type: 'room_list',
          rooms: this.roomManager.listRooms(),
          timestamp: Date.now()
        }));
        break;

      case 'room_info':
        const infoRoom = this.roomManager.getRoom(message.roomId);
        if (infoRoom) {
          ws.send(JSON.stringify({
            type: 'room_info',
            room: infoRoom.toJSON(),
            timestamp: Date.now()
          }));
        }
        break;

      case 'close_room':
        const closeRoom = this.roomManager.getRoom(message.roomId);
        if (closeRoom) {
          await this.roomManager.destroyRoom(message.roomId);
          this.emit('log', `Room ${closeRoom.name} closed`);
        }
        break;

      case 'cancel':
        const cancelRoom = this.roomManager.getRoom(message.roomId);
        if (cancelRoom) {
          const cancelled = cancelRoom.cancel();
          ws.send(JSON.stringify({
            type: 'cancel_result',
            roomId: message.roomId,
            cancelled,
            timestamp: Date.now()
          }));
        }
        break;

      case 'reset':
        const resetRoom = this.roomManager.getRoom(message.roomId);
        if (resetRoom) {
          resetRoom.resetStatus();
          ws.send(JSON.stringify({
            type: 'reset_result',
            roomId: message.roomId,
            status: 'ready',
            timestamp: Date.now()
          }));
        }
        break;

      case 'ping':
        ws.send(JSON.stringify({
          type: 'pong',
          timestamp: Date.now()
        }));
        break;

      default:
        ws.send(JSON.stringify({
          type: 'error',
          error: `Unknown message type: ${message.type}`,
          timestamp: Date.now()
        }));
    }
  }

  handleDisconnect(clientId) {
    const client = this.clients.get(clientId);
    if (!client) return;

    const { info } = client;

    // Remove from all rooms
    for (const roomId of info.rooms) {
      const room = this.roomManager.getRoom(roomId);
      if (room) {
        room.removeClient(clientId);
      }
    }

    this.clients.delete(clientId);
    this.emit('clientDisconnected', clientId);
    this.emit('log', `Client ${info.name || clientId.slice(0, 8)} disconnected`);
  }

  broadcast(data) {
    const payload = typeof data === 'string' ? data : JSON.stringify(data);
    for (const [, client] of this.clients) {
      if (client.ws.readyState === 1) {
        client.ws.send(payload);
      }
    }
  }

  getStats() {
    return {
      clientCount: this.clients.size,
      ...this.roomManager.getStats()
    };
  }

  async stop() {
    await this.roomManager.destroyAll();

    if (this.wss) {
      return new Promise((resolve) => {
        this.wss.close(() => {
          this.emit('log', 'WebSocket server stopped');
          resolve();
        });
      });
    }
  }
}
