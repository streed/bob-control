import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'events';

export class Room extends EventEmitter {
  constructor(options = {}) {
    super();
    this.id = options.id || uuidv4();
    this.name = options.name || `room-${this.id.slice(0, 8)}`;
    this.agentType = options.agentType || 'claude';
    this.directory = options.directory || process.cwd();
    this.branch = options.branch || null;
    this.agent = null;
    this.clients = new Map(); // WebSocket clients
    this.messages = []; // Message history
    this.status = 'initializing';
    this.createdAt = new Date();
    this.metadata = options.metadata || {};

    // Request tracking for cancellation
    this.currentRequest = null;
    this.requestTimeout = options.timeout || 600000; // 10 min default
    this.maxMessages = options.maxMessages || 1000; // Limit message history to prevent unbounded growth
  }

  setAgent(agent) {
    this.agent = agent;
    this.status = 'ready';

    // Forward agent events
    agent.on('message', (msg) => {
      this.addMessage('agent', msg);
    });

    agent.on('stream', (chunk) => {
      this.broadcast({
        type: 'stream',
        roomId: this.id,
        chunk,
        timestamp: Date.now()
      });
    });

    agent.on('error', (error) => {
      this.addMessage('system', `Agent error: ${error.message}`);
    });

    agent.on('status', (status) => {
      this.status = status;
      this.broadcast({
        type: 'status',
        roomId: this.id,
        status,
        timestamp: Date.now()
      });
    });

    agent.on('activity', (activity) => {
      this.broadcast({
        type: 'activity',
        roomId: this.id,
        activity,
        timestamp: Date.now()
      });
    });
  }

  addClient(ws, clientInfo = {}) {
    const clientId = clientInfo.id || uuidv4();
    this.clients.set(clientId, { ws, info: clientInfo, joinedAt: new Date() });

    // Send room history to new client
    ws.send(JSON.stringify({
      type: 'room_joined',
      roomId: this.id,
      roomName: this.name,
      agentType: this.agentType,
      directory: this.directory,
      branch: this.branch,
      status: this.status,
      history: this.messages.slice(-100), // Last 100 messages
      timestamp: Date.now()
    }));

    this.addMessage('system', `Client ${clientInfo.name || clientId.slice(0, 8)} joined`);

    return clientId;
  }

  removeClient(clientId) {
    const client = this.clients.get(clientId);
    if (client) {
      this.clients.delete(clientId);
      this.addMessage('system', `Client ${client.info.name || clientId.slice(0, 8)} left`);
    }
    return this.clients.size;
  }

  addMessage(role, content, metadata = {}) {
    const message = {
      id: uuidv4(),
      role, // 'user', 'agent', 'system'
      content,
      timestamp: Date.now(),
      ...metadata
    };
    this.messages.push(message);

    // Trim message history if it exceeds the limit
    while (this.messages.length > this.maxMessages) {
      this.messages.shift();
    }

    this.broadcast({
      type: 'message',
      roomId: this.id,
      message
    });

    this.emit('message', message);
    return message;
  }

  async sendToAgent(content, clientId) {
    if (!this.agent) {
      throw new Error('No agent attached to room');
    }

    if (this.status === 'busy') {
      throw new Error('Agent is busy processing. Use /cancel to abort.');
    }

    this.status = 'busy';
    this.broadcast({
      type: 'status',
      roomId: this.id,
      status: 'busy',
      timestamp: Date.now()
    });

    this.addMessage('user', content, { clientId });

    // Create cancellable request
    const requestId = uuidv4();
    let timeoutId = null;
    let cancelled = false;

    this.currentRequest = {
      id: requestId,
      startedAt: Date.now(),
      cancel: () => {
        cancelled = true;
        if (timeoutId) clearTimeout(timeoutId);
        if (this.agent && this.agent.process) {
          this.agent.process.kill('SIGTERM');
        }
      }
    };

    try {
      // Race between agent response and timeout
      const response = await Promise.race([
        this.agent.send(content),
        new Promise((_, reject) => {
          timeoutId = setTimeout(() => {
            reject(new Error(`Request timed out after ${this.requestTimeout / 1000}s`));
          }, this.requestTimeout);
        }),
        new Promise((_, reject) => {
          // Check for cancellation
          const checkCancelled = setInterval(() => {
            if (cancelled) {
              clearInterval(checkCancelled);
              reject(new Error('Request cancelled'));
            }
          }, 100);

          // Clean up interval when done
          setTimeout(() => clearInterval(checkCancelled), this.requestTimeout + 1000);
        })
      ]);

      if (timeoutId) clearTimeout(timeoutId);
      this.status = 'ready';
      return response;
    } catch (error) {
      if (timeoutId) clearTimeout(timeoutId);

      // Kill the agent process if it's still running
      if (this.agent && this.agent.process) {
        try {
          this.agent.process.kill('SIGTERM');
        } catch (e) {
          // Process may already be dead
        }
      }

      this.status = cancelled ? 'ready' : 'error';
      this.addMessage('system', `Error: ${error.message}`);
      throw error;
    } finally {
      this.currentRequest = null;
      this.broadcast({
        type: 'status',
        roomId: this.id,
        status: this.status,
        timestamp: Date.now()
      });
    }
  }

  /**
   * Cancel the current running request
   */
  cancel() {
    if (this.currentRequest) {
      this.currentRequest.cancel();
      this.addMessage('system', 'Request cancelled');
      return true;
    }
    return false;
  }

  /**
   * Force reset the room status (emergency recovery)
   */
  resetStatus() {
    if (this.agent && this.agent.process) {
      try {
        this.agent.process.kill('SIGTERM');
      } catch (e) {
        // Ignore
      }
    }

    this.currentRequest = null;
    this.status = 'ready';

    this.broadcast({
      type: 'status',
      roomId: this.id,
      status: 'ready',
      timestamp: Date.now()
    });

    this.addMessage('system', 'Room status reset to ready');
    return true;
  }

  broadcast(data) {
    const payload = typeof data === 'string' ? data : JSON.stringify(data);
    for (const [, client] of this.clients) {
      if (client.ws.readyState === 1) { // WebSocket.OPEN
        client.ws.send(payload);
      }
    }
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      agentType: this.agentType,
      directory: this.directory,
      branch: this.branch,
      status: this.status,
      clientCount: this.clients.size,
      messageCount: this.messages.length,
      createdAt: this.createdAt,
      metadata: this.metadata,
      isWorktree: !!this.metadata.worktree,
      originalDirectory: this.metadata.originalDirectory || null
    };
  }

  async destroy() {
    if (this.agent) {
      await this.agent.stop();
    }

    // Notify all clients
    this.broadcast({
      type: 'room_closed',
      roomId: this.id,
      timestamp: Date.now()
    });

    // Close all client connections
    for (const [, client] of this.clients) {
      client.ws.close(1000, 'Room closed');
    }

    this.clients.clear();
    this.emit('destroyed');
  }
}
