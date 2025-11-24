# Bob Control

Multi-agent control system via WebSockets with an irssi-style terminal UI. Run and manage multiple AI agents (Claude, Codex, Gemini, etc.) simultaneously from a single interface.

## Features

- **Multi-Agent Support**: Run Claude, OpenAI Codex, Gemini, and other agents
- **Room-Based Architecture**: Each agent runs in its own "room" that you can switch between
- **WebSocket API**: Open API allows building custom UIs and integrations
- **Git Integration**: Automatically create branches when starting agent sessions
- **irssi-Style UI**: Familiar terminal interface for power users

## Installation

```bash
npm install
npm link  # Optional: install globally as 'bob'
```

## Quick Start

```bash
# Start the UI (includes embedded server)
node src/index.js

# Or if linked globally
bob
```

Once running, type `/help` to see available commands.

## Usage

### Creating Agent Rooms

```bash
# In the UI
/create claude                           # Create a Claude room in current directory
/create claude /path/to/project          # Specify directory
/create claude /path/to/project feature  # Specify directory and git branch
/create codex ~/myproject new-branch     # Create Codex room with git branch
```

### Room Commands

```
/list       - List all active rooms
/join <id>  - Join a room
/switch <n> - Switch to room by number (Alt+1-9 also works)
/leave      - Leave current room
/close      - Close current room and stop agent
/status     - Show current room status
```

### Agent Control

```
/cancel     - Cancel the current agent request (or press Escape)
/reset      - Force reset room status if stuck (or press Ctrl+R)
/timeout <s> - Set request timeout in seconds (default: 300)
```

These commands help recover from stuck agents:
- If an agent is taking too long, use `/cancel` or press **Escape**
- If the room is stuck in "busy" state, use `/reset` or press **Ctrl+R**
- Adjust timeout with `/timeout 600` for long-running tasks

### Server Modes

```bash
# Run with built-in server (default)
bob

# Run server only (no UI) - for headless/remote
bob server
bob --server-only

# Connect to remote server
bob connect 192.168.1.100:8420
bob -c hostname:8420
```

## Architecture

```
┌─────────────┐         ┌──────────────────────────────────────┐
│ Terminal UI │────────>│ Server                               │
└─────────────┘         │  └─ Room Manager                     │
       │                │      ├─ Room 1 ──> claude CLI        │
       │ WebSocket      │      ├─ Room 2 ──> codex CLI         │
       │                │      └─ Room 3 ──> gemini CLI        │
┌──────┴──────┐         └──────────────────────────────────────┘
│ Custom      │                        │
│ Clients     │────────────────────────┘
└─────────────┘
```

## WebSocket API

The server exposes a WebSocket API for building custom clients.

### Connection

```javascript
const ws = new WebSocket('ws://localhost:8420');
```

### Message Types

#### Client → Server

```javascript
// Set display name
{ type: 'set_name', name: 'my-client' }

// Create a room
{ type: 'create_room', agentType: 'claude', directory: '/path', branch: 'feature' }

// Join existing room
{ type: 'join_room', roomId: 'uuid' }
{ type: 'join_room', roomName: 'room-name' }

// Leave room
{ type: 'leave_room', roomId: 'uuid' }

// Send message to agent
{ type: 'send_message', roomId: 'uuid', content: 'Hello agent' }

// List rooms
{ type: 'list_rooms' }

// Close room
{ type: 'close_room', roomId: 'uuid' }

// Ping
{ type: 'ping' }
```

#### Server → Client

```javascript
// Welcome (on connect)
{ type: 'welcome', clientId: 'uuid', rooms: [...], serverVersion: '1.0.0' }

// Room joined
{ type: 'room_joined', roomId: 'uuid', roomName: 'name', history: [...] }

// Message from room
{ type: 'message', roomId: 'uuid', message: { role: 'agent', content: '...' } }

// Streaming response
{ type: 'stream', roomId: 'uuid', chunk: '...' }

// Status change
{ type: 'status', roomId: 'uuid', status: 'busy' }

// Room list
{ type: 'room_list', rooms: [...] }

// Error
{ type: 'error', error: 'message' }
```

### Example Client

See `examples/simple-client.js` for a complete example.

## Adding Custom Agents

Create a new adapter in `src/agents/`:

```javascript
import { BaseAgent } from './base.js';

export class MyAgent extends BaseAgent {
  async start() {
    // Initialize agent
    this.status = 'ready';
    this.emit('status', 'ready');
    return this;
  }

  async send(content) {
    // Send message to agent and return response
    this.status = 'busy';
    this.emit('status', 'busy');

    // Your agent logic here...
    const response = await this.callMyAgent(content);

    this.status = 'ready';
    this.emit('message', response);
    return response;
  }
}
```

Register it in `src/agents/index.js`:

```javascript
import { MyAgent } from './myagent.js';
agents['myagent'] = MyAgent;
```

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| Alt+1-9 | Switch to room 1-9 |
| Escape | Cancel current agent request |
| Ctrl+R | Force reset room status |
| Tab | Switch focus between input and room list |
| PageUp/Down | Scroll chat |
| Up/Down | Input history |
| Ctrl+C | Quit |

## Configuration

Copy `config.example.json` to `config.json` and customize:

```json
{
  "server": {
    "port": 8420,
    "host": "127.0.0.1"
  },
  "agents": {
    "claude": {
      "model": "sonnet"
    }
  }
}
```

## License

MIT
