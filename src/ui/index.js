import { createScreen } from './screen.js';
import { CommandParser } from './commands.js';
import { BobServer } from '../server/index.js';
import { listAgentTypes } from '../agents/index.js';
import { MarkdownRenderer } from './markdown.js';
import WebSocket from 'ws';

/**
 * Main UI Controller
 * Manages the terminal interface and coordinates between
 * the UI, server, and WebSocket connections
 */
export class UIController {
  constructor(options = {}) {
    this.options = options;
    this.ui = createScreen();
    this.commands = new CommandParser();
    this.server = null;
    this.ws = null;
    this.rooms = new Map();
    this.roomBuffers = new Map(); // Output buffer per room
    this.roomRenderers = new Map(); // Markdown renderer per room (for streaming state)
    this.currentRoom = null;
    this.userName = options.name || `user-${Math.random().toString(36).slice(2, 8)}`;
    this.inputHistory = [];
    this.historyIndex = -1;
    this.serverMode = options.serverMode || false;
    this.useWorktrees = options.useWorktrees !== false;
    this.maxBufferLines = 500; // Max lines to keep per room
    this.roomPartialLines = new Map(); // Track partial line content per room (for streaming)
  }

  /**
   * Check if a room has a partial line
   */
  hasPartialLine(roomId) {
    return this.roomPartialLines.has(roomId);
  }

  /**
   * Get the partial line content for a room
   */
  getPartialLine(roomId) {
    return this.roomPartialLines.get(roomId) || null;
  }

  /**
   * Set partial line content for a room
   */
  setPartialLine(roomId, content) {
    if (content === false || content === null) {
      this.roomPartialLines.delete(roomId);
    } else if (content === true) {
      // Legacy compatibility - shouldn't happen, but handle it
      if (!this.roomPartialLines.has(roomId)) {
        this.roomPartialLines.set(roomId, '');
      }
    } else {
      this.roomPartialLines.set(roomId, content);
    }
  }

  /**
   * Finalize any partial line in a room's buffer (flush it as a complete line)
   */
  finalizePartialLine(roomId) {
    const partial = this.getPartialLine(roomId);
    if (partial) {
      this.appendToBuffer(roomId, partial);
      this.roomPartialLines.delete(roomId);
    }
  }

  /**
   * Initialize and start the UI
   */
  async start() {
    this.setupInputHandlers();
    this.setupKeyBindings();

    this.log('{bold}{blue-fg}Bob Control{/blue-fg}{/bold} - Multi-Agent Terminal Interface');
    this.log('Type {green-fg}/help{/green-fg} for available commands');
    this.log('');

    if (this.serverMode) {
      await this.startServer();
    } else if (this.options.connect) {
      await this.connect(this.options.connect);
    } else {
      // Start embedded server by default
      await this.startServer();
    }

    this.ui.inputBox.focus();
    this.ui.screen.render();
  }

  /**
   * Start the embedded WebSocket server
   */
  async startServer() {
    this.server = new BobServer({
      port: this.options.port || 8420,
      host: this.options.host || '127.0.0.1',
      useWorktrees: this.useWorktrees
    });

    this.server.on('log', (msg) => this.log(`{gray-fg}[server]{/gray-fg} ${msg}`));
    this.server.on('roomCreated', (room) => this.onRoomCreated(room));
    this.server.on('roomDestroyed', (roomId) => this.onRoomDestroyed(roomId));

    await this.server.start();
    this.log(`{green-fg}Server started on ws://${this.server.host}:${this.server.port}{/green-fg}`);
  }

  /**
   * Connect to a remote server
   */
  async connect(address) {
    const url = address.startsWith('ws://') ? address : `ws://${address}`;

    return new Promise((resolve, reject) => {
      this.log(`Connecting to ${url}...`);

      this.ws = new WebSocket(url);

      this.ws.on('open', () => {
        this.log(`{green-fg}Connected to ${url}{/green-fg}`);
        this.ws.send(JSON.stringify({
          type: 'set_name',
          name: this.userName
        }));
        resolve();
      });

      this.ws.on('message', (data) => {
        this.handleServerMessage(JSON.parse(data.toString()));
      });

      this.ws.on('close', () => {
        this.log('{yellow-fg}Disconnected from server{/yellow-fg}');
        this.ws = null;
      });

      this.ws.on('error', (error) => {
        this.log(`{red-fg}Connection error: ${error.message}{/red-fg}`);
        reject(error);
      });
    });
  }

  /**
   * Disconnect from server
   */
  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
      this.log('Disconnected');
    }
  }

  /**
   * Handle messages from the server
   */
  handleServerMessage(message) {
    switch (message.type) {
      case 'welcome':
        this.log(`{cyan-fg}Connected as ${message.clientId.slice(0, 8)}{/cyan-fg}`);
        for (const room of message.rooms) {
          this.rooms.set(room.id, room);
        }
        this.updateRoomList();
        break;

      case 'room_joined':
        this.rooms.set(message.roomId, message);
        this.currentRoom = message.roomId;
        this.updateRoomList();
        this.updateStatus();
        this.log(`{green-fg}Joined room: ${message.roomName} (${message.agentType}){/green-fg}`);
        // Show history
        for (const msg of message.history.slice(-20)) {
          this.displayMessage(msg);
        }
        break;

      case 'room_left':
        if (this.currentRoom === message.roomId) {
          this.currentRoom = null;
          this.updateStatus();
        }
        this.log('{yellow-fg}Left room{/yellow-fg}');
        break;

      case 'message':
        // Skip user messages (shown in sendMessage) and agent messages (shown via streaming)
        // Only show system messages
        if (message.message.role === 'system') {
          const msg = message.message;
          const time = new Date(msg.timestamp).toLocaleTimeString('en-US', {
            hour12: false,
            hour: '2-digit',
            minute: '2-digit'
          });
          const formatted = `{gray-fg}${time}{/gray-fg} {yellow-fg}*{/yellow-fg} ${msg.content}`;

          // Always buffer for this room
          this.appendToBuffer(message.roomId, formatted);

          // Only display if current room
          if (message.roomId === this.currentRoom) {
            this.ui.chatBox.log(formatted);
            this.ui.screen.render();
          }
        }
        break;

      case 'stream':
        // Use processChunk for proper streaming with partial line support
        const renderer = this.getMarkdownRenderer(message.roomId);
        const results = renderer.processChunk(message.chunk);

        for (const { line, complete } of results) {
          const hadPartial = this.hasPartialLine(message.roomId);

          if (complete) {
            // Complete line - add to buffer and display
            this.appendToBuffer(message.roomId, line);
            this.setPartialLine(message.roomId, false);
            if (message.roomId === this.currentRoom) {
              if (hadPartial) {
                this.replaceLastLine(line);
              } else {
                this.ui.chatBox.pushLine(line);
              }
            }
          } else {
            // Partial line - store content for later and update display
            this.setPartialLine(message.roomId, line);
            if (message.roomId === this.currentRoom) {
              if (hadPartial) {
                this.replaceLastLine(line);
              } else {
                this.ui.chatBox.pushLine(line);
              }
            }
          }
        }

        if (message.roomId === this.currentRoom) {
          this.ui.chatBox.setScrollPerc(100);
          this.ui.screen.render();
        }
        break;

      case 'status':
        const statusRoom = this.rooms.get(message.roomId);
        if (statusRoom) {
          statusRoom.status = message.status;

          // Reset markdown renderer when starting a new response
          if (message.status === 'busy') {
            this.getMarkdownRenderer(message.roomId).reset();
            this.setPartialLine(message.roomId, false);
          } else if (message.status === 'ready') {
            // Response complete - finalize any partial line into the buffer
            this.finalizePartialLine(message.roomId);
          }

          // Update room list to reflect status indicator changes for all rooms
          this.updateRoomList();
          if (message.roomId === this.currentRoom) {
            if (message.status === 'busy') {
              this.ui.statusBar.setContent(
                ` {bold}Bob{/bold} | {yellow-fg}Agent thinking...{/yellow-fg} | Escape to cancel`
              );
              this.ui.screen.render();
            } else {
              this.updateStatus();
            }
          }
        }
        break;

      case 'activity':
        if (message.roomId === this.currentRoom && message.activity) {
          const activity = message.activity;
          const desc = activity.description || `Using ${activity.tool}`;

          // Show in status bar
          this.ui.statusBar.setContent(
            ` {bold}Bob{/bold} | {cyan-fg}${desc}...{/cyan-fg} | Escape to cancel`
          );

          // Also show inline in chat for better visibility
          const toolIcon = this.getToolIcon(activity.tool);
          const activityLine = `{gray-fg}${toolIcon} ${desc}{/gray-fg}`;
          this.appendToBuffer(message.roomId, activityLine);
          this.ui.chatBox.pushLine(activityLine);
          this.ui.chatBox.setScrollPerc(100);
          this.ui.screen.render();
        }
        break;

      case 'room_list':
        this.rooms.clear();
        for (const room of message.rooms) {
          this.rooms.set(room.id, room);
        }
        this.updateRoomList();
        break;

      case 'room_closed':
        // Clean up resources for the closed room (WebSocket client mode)
        this.rooms.delete(message.roomId);
        this.roomBuffers.delete(message.roomId);
        this.roomRenderers.delete(message.roomId);
        this.roomPartialLines.delete(message.roomId);
        if (this.currentRoom === message.roomId) {
          this.currentRoom = null;
          this.updateStatus();
        }
        this.updateRoomList();
        this.log('{yellow-fg}Room closed{/yellow-fg}');
        break;

      case 'error':
        this.log(`{red-fg}Error: ${message.error}{/red-fg}`);
        break;
    }
  }

  /**
   * Setup input handlers
   */
  setupInputHandlers() {
    this.ui.inputBox.on('submit', (value) => {
      this.handleInput(value);
      this.ui.inputBox.clearValue();
      this.ui.inputBox.focus();
      this.ui.screen.render();
    });

    // Input history
    this.ui.inputBox.key(['up'], () => {
      if (this.historyIndex < this.inputHistory.length - 1) {
        this.historyIndex++;
        this.ui.inputBox.setValue(
          this.inputHistory[this.inputHistory.length - 1 - this.historyIndex]
        );
        this.ui.screen.render();
      }
    });

    this.ui.inputBox.key(['down'], () => {
      if (this.historyIndex > 0) {
        this.historyIndex--;
        this.ui.inputBox.setValue(
          this.inputHistory[this.inputHistory.length - 1 - this.historyIndex]
        );
      } else {
        this.historyIndex = -1;
        this.ui.inputBox.clearValue();
      }
      this.ui.screen.render();
    });
  }

  /**
   * Setup keyboard shortcuts
   */
  setupKeyBindings() {
    const screen = this.ui.screen;
    const inputBox = this.ui.inputBox;

    // Alt+number to switch rooms (bind to both screen and inputBox)
    for (let i = 1; i <= 9; i++) {
      const handler = () => {
        this.switchRoom(String(i));
        inputBox.focus();
        screen.render();
      };
      screen.key([`M-${i}`, `A-${i}`], handler);
      inputBox.key([`M-${i}`, `A-${i}`], handler);
    }

    // Tab to switch between elements
    screen.key(['tab'], () => {
      if (this.ui.roomList.focused) {
        inputBox.focus();
      } else {
        this.ui.roomList.focus();
      }
      screen.render();
    });

    // Room list selection
    this.ui.roomList.on('select', (item, index) => {
      const roomIds = Array.from(this.rooms.keys());
      if (roomIds[index]) {
        this.switchRoom(roomIds[index]);
      }
      inputBox.focus();
      screen.render();
    });

    // Escape to cancel current request (bind to inputBox too)
    const cancelHandler = () => {
      if (this.currentRoom) {
        const ctx = this.createCommandContext();
        ctx.cancelRequest();
        screen.render();
      }
    };
    screen.key(['escape'], cancelHandler);
    inputBox.key(['escape'], cancelHandler);

    // Ctrl+R to reset room status (emergency)
    const resetHandler = () => {
      if (this.currentRoom) {
        const ctx = this.createCommandContext();
        ctx.resetRoom();
        screen.render();
      }
    };
    screen.key(['C-r'], resetHandler);
    inputBox.key(['C-r'], resetHandler);

    // Ctrl+N for next room
    const nextRoomHandler = () => {
      const roomIds = Array.from(this.rooms.keys());
      if (roomIds.length > 0) {
        const currentIndex = roomIds.indexOf(this.currentRoom);
        const nextIndex = (currentIndex + 1) % roomIds.length;
        this.switchRoom(roomIds[nextIndex]);
        screen.render();
      }
    };
    screen.key(['C-n'], nextRoomHandler);
    inputBox.key(['C-n'], nextRoomHandler);

    // Ctrl+P for previous room
    const prevRoomHandler = () => {
      const roomIds = Array.from(this.rooms.keys());
      if (roomIds.length > 0) {
        const currentIndex = roomIds.indexOf(this.currentRoom);
        const prevIndex = (currentIndex - 1 + roomIds.length) % roomIds.length;
        this.switchRoom(roomIds[prevIndex]);
        screen.render();
      }
    };
    screen.key(['C-p'], prevRoomHandler);
    inputBox.key(['C-p'], prevRoomHandler);
  }

  /**
   * Handle user input
   */
  handleInput(input) {
    if (!input.trim()) return;

    // Add to history
    this.inputHistory.push(input);
    if (this.inputHistory.length > 100) {
      this.inputHistory.shift();
    }
    this.historyIndex = -1;

    // Parse as command or message
    const result = this.commands.parse(input, this.createCommandContext());

    if (result.error) {
      this.log(`{red-fg}${result.error}{/red-fg}`);
    } else if (!result.isCommand) {
      // Send as message to current room
      this.sendMessage(result.content);
    }
  }

  /**
   * Create command context with handlers
   */
  createCommandContext() {
    return {
      log: (msg) => this.log(msg),

      createRoom: async (args, options = {}) => {
        const [agentType, directory, branch] = args;

        if (!agentType) {
          this.log('{red-fg}Usage: /create <agent> [directory] [branch]{/red-fg}');
          this.log('{gray-fg}Tip: Use /new <agent> to select directory with a picker{/gray-fg}');
          return;
        }

        // If browse option is set, show directory picker
        let targetDirectory = directory;
        if (options.browse && !directory) {
          targetDirectory = await this.showDirectoryPicker();
          if (!targetDirectory) {
            this.log('{yellow-fg}Room creation cancelled{/yellow-fg}');
            return;
          }
        }

        if (this.server) {
          const room = await this.server.roomManager.createRoom({
            agentType,
            directory: targetDirectory || process.cwd(),
            branch
          });
          this.rooms.set(room.id, room.toJSON());
          this.currentRoom = room.id;
          this.updateRoomList();
          this.updateStatus();
          this.log(`{green-fg}Created room: ${room.name} (${agentType}){/green-fg}`);

          // Setup room event handlers for local mode
          room.on('message', (msg) => {
            // Skip user messages (shown in sendMessage) and agent messages (shown via streaming)
            // Only show system messages
            if (msg.role === 'system') {
              const time = new Date(msg.timestamp).toLocaleTimeString('en-US', {
                hour12: false,
                hour: '2-digit',
                minute: '2-digit'
              });
              const formatted = `{gray-fg}${time}{/gray-fg} {yellow-fg}*{/yellow-fg} ${msg.content}`;

              // Always buffer for this room
              this.appendToBuffer(room.id, formatted);

              // Only display if current room
              if (this.currentRoom === room.id) {
                this.ui.chatBox.log(formatted);
                this.ui.screen.render();
              }
            }
          });

          // Handle streaming output with proper partial line support
          room.agent?.on('stream', (chunk) => {
            const renderer = this.getMarkdownRenderer(room.id);
            const results = renderer.processChunk(chunk);

            for (const { line, complete } of results) {
              const hadPartial = this.hasPartialLine(room.id);

              if (complete) {
                // Complete line - add to buffer and display
                this.appendToBuffer(room.id, line);
                this.setPartialLine(room.id, false);
                if (this.currentRoom === room.id) {
                  if (hadPartial) {
                    this.replaceLastLine(line);
                  } else {
                    this.ui.chatBox.pushLine(line);
                  }
                }
              } else {
                // Partial line - store content for later and update display
                this.setPartialLine(room.id, line);
                if (this.currentRoom === room.id) {
                  if (hadPartial) {
                    this.replaceLastLine(line);
                  } else {
                    this.ui.chatBox.pushLine(line);
                  }
                }
              }
            }

            if (this.currentRoom === room.id) {
              this.ui.chatBox.setScrollPerc(100);
              this.ui.screen.render();
            }
          });

          // Handle status changes for visual feedback
          room.agent?.on('status', (status) => {
            // Update the room's status in our local state
            const roomData = this.rooms.get(room.id);
            if (roomData) {
              roomData.status = status;
            }

            // Reset markdown renderer when starting a new response
            if (status === 'busy') {
              this.getMarkdownRenderer(room.id).reset();
              this.setPartialLine(room.id, false);
            } else if (status === 'ready') {
              // Response complete - finalize any partial line into the buffer
              this.finalizePartialLine(room.id);
            }

            // Update room list to reflect status indicator changes for all rooms
            this.updateRoomList();
            if (this.currentRoom === room.id) {
              if (status === 'busy') {
                this.ui.statusBar.setContent(
                  ` {bold}Bob{/bold} | {yellow-fg}Agent thinking...{/yellow-fg} | Escape to cancel`
                );
              } else {
                this.updateStatus();
              }
              this.ui.screen.render();
            }
          });

          // Handle activity events to show what the agent is doing
          room.agent?.on('activity', (activity) => {
            const desc = activity.description || `Using ${activity.tool}`;

            // Show inline in chat for better visibility
            const toolIcon = this.getToolIcon(activity.tool);
            const activityLine = `{gray-fg}${toolIcon} ${desc}{/gray-fg}`;
            this.appendToBuffer(room.id, activityLine);

            if (this.currentRoom === room.id) {
              this.ui.statusBar.setContent(
                ` {bold}Bob{/bold} | {cyan-fg}${desc}...{/cyan-fg} | Escape to cancel`
              );
              this.ui.chatBox.pushLine(activityLine);
              this.ui.chatBox.setScrollPerc(100);
              this.ui.screen.render();
            }
          });

        } else if (this.ws) {
          this.ws.send(JSON.stringify({
            type: 'create_room',
            agentType,
            directory: directory || process.cwd(),
            branch
          }));
        } else {
          this.log('{red-fg}Not connected to any server{/red-fg}');
        }
      },

      joinRoom: (roomIdentifier) => {
        if (this.ws) {
          this.ws.send(JSON.stringify({
            type: 'join_room',
            roomName: roomIdentifier
          }));
        } else {
          // Local mode - just switch
          this.switchRoom(roomIdentifier);
        }
      },

      leaveRoom: () => {
        if (this.ws && this.currentRoom) {
          this.ws.send(JSON.stringify({
            type: 'leave_room',
            roomId: this.currentRoom
          }));
        }
        this.currentRoom = null;
        this.updateStatus();
      },

      listRooms: () => {
        if (this.rooms.size === 0) {
          this.log('No rooms. Use {green-fg}/create <agent>{/green-fg} to create one.');
          return;
        }

        this.log('{bold}Active rooms:{/bold}');
        let i = 1;
        for (const [id, room] of this.rooms) {
          const marker = id === this.currentRoom ? '{green-fg}*{/green-fg}' : ' ';
          this.log(`${marker}${i}. ${room.name || id.slice(0, 8)} [${room.agentType}] - ${room.status}`);
          i++;
        }
      },

      closeRoom: async (roomIdentifier) => {
        const roomId = roomIdentifier || this.currentRoom;

        if (!roomId) {
          this.log('{red-fg}No room specified{/red-fg}');
          return;
        }

        if (this.server) {
          await this.server.roomManager.destroyRoom(roomId);
          this.rooms.delete(roomId);
          if (this.currentRoom === roomId) {
            this.currentRoom = null;
          }
          this.updateRoomList();
          this.updateStatus();
          this.log('{yellow-fg}Room closed{/yellow-fg}');
        } else if (this.ws) {
          this.ws.send(JSON.stringify({
            type: 'close_room',
            roomId
          }));
        }
      },

      switchRoom: (identifier) => this.switchRoom(identifier),

      showStatus: () => {
        if (!this.currentRoom) {
          this.log('No room selected');
          return;
        }

        const room = this.rooms.get(this.currentRoom);
        if (room) {
          this.log(`{bold}Room:{/bold} ${room.name}`);
          this.log(`{bold}Agent:{/bold} ${room.agentType}`);
          this.log(`{bold}Status:{/bold} ${room.status}`);
          this.log(`{bold}Directory:{/bold} ${room.directory}`);
          if (room.branch) {
            this.log(`{bold}Branch:{/bold} ${room.branch}`);
          }
        }
      },

      clearChat: () => {
        this.ui.chatBox.setContent('');
        this.ui.screen.render();
      },

      connect: (address) => this.connect(address),

      disconnect: () => this.disconnect(),

      quit: () => this.quit(),

      listAgents: () => {
        const types = listAgentTypes();
        this.log('{bold}Available agent types:{/bold}');
        for (const type of types) {
          this.log(`  - ${type}`);
        }
      },

      gitCommand: async (args) => {
        if (!this.currentRoom) {
          this.log('{red-fg}No room selected{/red-fg}');
          return;
        }

        const room = this.server?.roomManager.getRoom(this.currentRoom);
        if (!room) return;

        const { GitManager } = await import('../git/index.js');
        const git = new GitManager();

        try {
          const info = await git.getRepoInfo(room.directory);

          if (!info.isGitRepo) {
            this.log('Not a git repository');
            return;
          }

          this.log(`{bold}Branch:{/bold} ${info.currentBranch}`);
          this.log(`{bold}Modified:{/bold} ${info.status.modified.length} files`);
          this.log(`{bold}Staged:{/bold} ${info.status.staged.length} files`);

          if (info.status.ahead > 0) {
            this.log(`{green-fg}Ahead by ${info.status.ahead} commits{/green-fg}`);
          }
          if (info.status.behind > 0) {
            this.log(`{yellow-fg}Behind by ${info.status.behind} commits{/yellow-fg}`);
          }
        } catch (error) {
          this.log(`{red-fg}Git error: ${error.message}{/red-fg}`);
        }
      },

      setName: (name) => {
        if (!name) {
          this.log('{red-fg}Usage: /name <name>{/red-fg}');
          return;
        }
        this.userName = name;
        if (this.ws) {
          this.ws.send(JSON.stringify({
            type: 'set_name',
            name
          }));
        }
        this.log(`Name set to: ${name}`);
      },

      cancelRequest: () => {
        if (!this.currentRoom) {
          this.log('{red-fg}No room selected{/red-fg}');
          return;
        }

        if (this.server) {
          const room = this.server.roomManager.getRoom(this.currentRoom);
          if (room) {
            const cancelled = room.cancel();
            if (cancelled) {
              this.log('{yellow-fg}Request cancelled{/yellow-fg}');
            } else {
              this.log('{gray-fg}No active request to cancel{/gray-fg}');
            }
          }
        } else if (this.ws) {
          this.ws.send(JSON.stringify({
            type: 'cancel',
            roomId: this.currentRoom
          }));
        }
      },

      resetRoom: () => {
        if (!this.currentRoom) {
          this.log('{red-fg}No room selected{/red-fg}');
          return;
        }

        if (this.server) {
          const room = this.server.roomManager.getRoom(this.currentRoom);
          if (room) {
            room.resetStatus();
            this.log('{yellow-fg}Room status reset to ready{/yellow-fg}');
          }
        } else if (this.ws) {
          this.ws.send(JSON.stringify({
            type: 'reset',
            roomId: this.currentRoom
          }));
        }
      },

      setTimeout: (seconds) => {
        if (!this.currentRoom) {
          this.log('{red-fg}No room selected{/red-fg}');
          return;
        }

        const timeout = parseInt(seconds, 10);
        if (isNaN(timeout) || timeout < 1) {
          this.log('{red-fg}Usage: /timeout <seconds>{/red-fg}');
          return;
        }

        if (this.server) {
          const room = this.server.roomManager.getRoom(this.currentRoom);
          if (room) {
            room.requestTimeout = timeout * 1000;
            this.log(`Timeout set to ${timeout} seconds`);
          }
        } else {
          this.log('{yellow-fg}Timeout can only be set in server mode{/yellow-fg}');
        }
      },

      showWorktree: () => {
        if (!this.currentRoom) {
          this.log('{red-fg}No room selected{/red-fg}');
          return;
        }

        const room = this.rooms.get(this.currentRoom);
        if (!room) {
          this.log('{red-fg}Room not found{/red-fg}');
          return;
        }

        if (room.isWorktree || room.metadata?.worktree) {
          this.log('{bold}Worktree Information:{/bold}');
          this.log(`  {green-fg}Isolated:{/green-fg} Yes`);
          this.log(`  {bold}Worktree path:{/bold} ${room.directory}`);
          this.log(`  {bold}Original repo:{/bold} ${room.originalDirectory || room.metadata?.originalDirectory}`);
          this.log(`  {bold}Branch:{/bold} ${room.branch}`);
          this.log('');
          this.log('{gray-fg}Changes are isolated from the main repository.{/gray-fg}');
          this.log('{gray-fg}Worktree will be cleaned up when room is closed.{/gray-fg}');
        } else {
          this.log('{yellow-fg}This room is not using a worktree.{/yellow-fg}');
          this.log(`Working directly in: ${room.directory}`);
        }
      },

      createRoomWithBrowser: async (args) => {
        // Create room but show directory browser first
        const ctx = this.createCommandContext();
        await ctx.createRoom(args, { browse: true });
      },

      browseDirectory: async () => {
        const selected = await this.showDirectoryPicker();
        if (selected) {
          this.log(`{green-fg}Selected: ${selected}{/green-fg}`);
          this.log(`{gray-fg}Use /create <agent> "${selected}" to create a room here{/gray-fg}`);
        }
      }
    };
  }

  /**
   * Switch to a different room
   */
  switchRoom(identifier) {
    let targetRoom = null;

    // Check if it's a number (room index)
    const index = parseInt(identifier, 10);
    if (!isNaN(index) && index > 0) {
      const roomIds = Array.from(this.rooms.keys());
      if (roomIds[index - 1]) {
        targetRoom = roomIds[index - 1];
      }
    } else {
      // Search by name or ID
      for (const [id, room] of this.rooms) {
        if (id === identifier || room.name === identifier) {
          targetRoom = id;
          break;
        }
      }
    }

    if (targetRoom) {
      const previousRoom = this.currentRoom;
      this.currentRoom = targetRoom;
      this.updateRoomList();
      this.updateStatus();

      const room = this.rooms.get(targetRoom);

      // Clear chat and display room's buffered output
      this.ui.chatBox.setContent('');
      this.displayRoomBuffer(targetRoom);

      // Also display any current partial line that's being streamed
      const partialLine = this.getPartialLine(targetRoom);
      if (partialLine) {
        this.ui.chatBox.pushLine(partialLine);
      }

      // If no buffer exists and no partial line, show a welcome message
      const hasBuffer = this.roomBuffers.has(targetRoom) && this.roomBuffers.get(targetRoom).length > 0;
      if (!hasBuffer && !partialLine) {
        this.log(`{cyan-fg}Switched to: ${room.name || targetRoom.slice(0, 8)}{/cyan-fg}`);
      }

      this.ui.screen.render();
    } else {
      this.log('{red-fg}Room not found{/red-fg}');
    }
  }

  /**
   * Send a message to the current room
   */
  async sendMessage(content) {
    if (!this.currentRoom) {
      this.log('{yellow-fg}No room selected. Use /create or /join first.{/yellow-fg}');
      return;
    }

    // Show the user's message immediately
    const time = new Date().toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit'
    });
    this.log(`{gray-fg}${time}{/gray-fg} {green-fg}<you>{/green-fg} ${content}`);

    // Show thinking indicator
    this.ui.statusBar.setContent(
      ` {bold}Bob{/bold} | {yellow-fg}Agent thinking...{/yellow-fg} | Escape to cancel`
    );
    this.ui.screen.render();

    if (this.server) {
      const room = this.server.roomManager.getRoom(this.currentRoom);
      if (room) {
        try {
          this.log('{gray-fg}───────────────{/gray-fg}');
          await room.sendToAgent(content, 'local');
          this.log('{gray-fg}───────────────{/gray-fg}');
        } catch (error) {
          this.log(`{red-fg}Error: ${error.message}{/red-fg}`);
        }
        this.updateStatus();
      }
    } else if (this.ws) {
      this.ws.send(JSON.stringify({
        type: 'send_message',
        roomId: this.currentRoom,
        content
      }));
    }
  }

  /**
   * Display a message in the chat
   */
  displayMessage(msg) {
    const time = new Date(msg.timestamp).toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit'
    });

    let prefix = '';
    switch (msg.role) {
      case 'user':
        prefix = `{gray-fg}${time}{/gray-fg} {green-fg}<you>{/green-fg} `;
        break;
      case 'agent':
        prefix = `{gray-fg}${time}{/gray-fg} {cyan-fg}<agent>{/cyan-fg} `;
        break;
      case 'system':
        prefix = `{gray-fg}${time}{/gray-fg} {yellow-fg}*{/yellow-fg} `;
        break;
    }

    this.log(prefix + msg.content);
  }

  /**
   * Log a message to the chat box
   */
  log(message) {
    this.ui.chatBox.log(message);
    // Also buffer for current room
    if (this.currentRoom) {
      this.appendToBuffer(this.currentRoom, message);
    }
    this.ui.screen.render();
  }

  /**
   * Append a line to a room's buffer
   */
  appendToBuffer(roomId, line) {
    if (!this.roomBuffers.has(roomId)) {
      this.roomBuffers.set(roomId, []);
    }
    const buffer = this.roomBuffers.get(roomId);
    buffer.push(line);
    // Trim buffer if too large
    while (buffer.length > this.maxBufferLines) {
      buffer.shift();
    }
  }

  /**
   * Replace the last line in the chat box (for streaming partial lines)
   */
  replaceLastLine(newContent) {
    // blessed.log stores lines in _clines.fake
    const lines = this.ui.chatBox._clines?.fake;
    if (lines && lines.length > 0) {
      lines[lines.length - 1] = newContent;
      // Force re-render of the log widget
      this.ui.chatBox.setContent(lines.join('\n'));
      this.ui.chatBox.setScrollPerc(100);
    }
  }

  /**
   * Display a room's buffered output
   */
  displayRoomBuffer(roomId) {
    const buffer = this.roomBuffers.get(roomId);
    if (buffer && buffer.length > 0) {
      // Clear chat first
      this.ui.chatBox.setContent('');
      // Replay buffer
      for (const line of buffer) {
        this.ui.chatBox.log(line);
      }
      this.ui.chatBox.setScrollPerc(100);
    }
  }

  /**
   * Get or create a markdown renderer for a room
   */
  getMarkdownRenderer(roomId) {
    if (!this.roomRenderers.has(roomId)) {
      this.roomRenderers.set(roomId, new MarkdownRenderer());
    }
    return this.roomRenderers.get(roomId);
  }

  /**
   * Get an icon/symbol for a tool type
   */
  getToolIcon(toolName) {
    const icons = {
      'Read': '📖',
      'Write': '📝',
      'Edit': '✏️',
      'Bash': '⚡',
      'Grep': '🔍',
      'Glob': '📂',
      'Task': '🤖',
      'WebFetch': '🌐',
      'WebSearch': '🔎',
      'TodoWrite': '📋',
      'NotebookEdit': '📓'
    };
    return icons[toolName] || '🔧';
  }

  /**
   * Show directory picker popup and return selected directory
   * @param {string} startPath - Starting directory path
   * @returns {Promise<string|null>} - Selected directory path or null if cancelled
   */
  showDirectoryPicker(startPath = process.cwd()) {
    return new Promise((resolve) => {
      const picker = this.ui.directoryPicker;

      // Track current directory for selection
      let currentDir = startPath;

      // Refresh the file manager with the starting path
      picker.refresh(startPath, () => {
        picker.show();
        picker.focus();
        this.ui.screen.render();
      });

      // Handle file selection (navigating into directories)
      const onFile = (file) => {
        // Update current directory when navigating
        currentDir = picker.cwd;
      };

      // Handle Enter key to select current directory
      const onSelect = () => {
        cleanup();
        picker.hide();
        this.ui.inputBox.focus();
        this.ui.screen.render();
        resolve(picker.cwd);
      };

      // Handle Escape to cancel
      const onCancel = () => {
        cleanup();
        picker.hide();
        this.ui.inputBox.focus();
        this.ui.screen.render();
        resolve(null);
      };

      // Cleanup event listeners
      const cleanup = () => {
        picker.removeListener('file', onFile);
        picker.removeListener('cd', onFile);
        picker.key(['escape'], onCancel);
        picker.key(['enter'], onSelect);
      };

      picker.on('file', onFile);
      picker.on('cd', onFile);
      picker.key(['escape'], onCancel);

      // Use 's' key to select current directory (since Enter navigates)
      picker.key(['s', 'S'], onSelect);
    });
  }

  /**
   * Update the room list sidebar
   */
  updateRoomList() {
    const items = [];
    let i = 1;
    let currentIndex = 0;

    for (const [id, room] of this.rooms) {
      const marker = id === this.currentRoom ? '>' : ' ';
      const status = room.status === 'busy' ? '~' : room.status === 'error' ? '!' : '';
      items.push(`${marker}${i}.${status} ${room.name || id.slice(0, 6)}`);
      if (id === this.currentRoom) {
        currentIndex = i - 1;
      }
      i++;
    }

    this.ui.roomList.setItems(items);
    // Sync the blessed list's selection highlight with the current room
    if (this.currentRoom && items.length > 0) {
      this.ui.roomList.select(currentIndex);
    }
    this.ui.screen.render();
  }

  /**
   * Update the status panel
   */
  updateStatus() {
    if (!this.currentRoom) {
      this.ui.statusPanel.setContent('{center}No room{/center}');
    } else {
      const room = this.rooms.get(this.currentRoom);
      if (room) {
        const isWorktree = room.isWorktree || room.metadata?.worktree;
        const statusText = room.status === 'busy'
          ? '{yellow-fg}Thinking...{/yellow-fg}'
          : room.status === 'error'
            ? '{red-fg}Error{/red-fg}'
            : '{green-fg}Ready{/green-fg}';

        const lines = [
          `{bold}${room.name || room.id?.slice(0, 8)}{/bold}`,
          '',
          `Agent: ${room.agentType}`,
          `Status: ${statusText}`,
        ];

        if (isWorktree) {
          lines.push(`{cyan-fg}Isolated{/cyan-fg}`);
          if (room.branch) {
            lines.push(`Branch: ${room.branch}`);
          }
          // Show the worktree directory name
          lines.push(room.directory?.split('/').pop() || '');
        } else {
          // Show the working directory name for non-worktree rooms
          lines.push(room.directory?.split('/').pop() || '');
        }

        this.ui.statusPanel.setContent(lines.filter(Boolean).join('\n'));
      }
    }

    // Update status bar
    const stats = this.server ? this.server.getStats() : { roomCount: this.rooms.size };
    this.ui.statusBar.setContent(
      ` {bold}Bob{/bold} | Rooms: ${stats.roomCount} | ` +
      (this.currentRoom ? `Current: ${this.rooms.get(this.currentRoom)?.name || 'unknown'}` : 'No room') +
      ' | /help'
    );

    this.ui.screen.render();
  }

  /**
   * Handle room creation event
   */
  onRoomCreated(room) {
    this.rooms.set(room.id, room.toJSON());
    this.updateRoomList();
  }

  /**
   * Handle room destruction event
   */
  onRoomDestroyed(roomId) {
    this.rooms.delete(roomId);
    this.roomBuffers.delete(roomId); // Clean up buffer
    this.roomRenderers.delete(roomId); // Clean up markdown renderer
    this.roomPartialLines.delete(roomId); // Clean up partial line state
    if (this.currentRoom === roomId) {
      this.currentRoom = null;
      this.updateStatus();
    }
    this.updateRoomList();
  }

  /**
   * Quit the application
   */
  async quit() {
    if (this.server) {
      await this.server.stop();
    }
    if (this.ws) {
      this.ws.close();
    }
    process.exit(0);
  }
}
