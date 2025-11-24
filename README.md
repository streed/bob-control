# Bob Control

A multi-agent control system for managing AI coding assistants via WebSockets with an irssi-style terminal interface. Run and coordinate multiple AI agents (Claude, Codex, Gemini) simultaneously from a unified interface.

## Features

### Multi-Agent Orchestration
- **Multiple Agent Types**: Native support for Claude, OpenAI Codex/GPT, and Google Gemini
- **Parallel Sessions**: Run multiple agents simultaneously, each in isolated rooms
- **Extensible Framework**: Add custom agents by extending the BaseAgent class
- **Real-time Streaming**: Character-by-character response streaming with markdown rendering

### Room-Based Architecture
- **Isolated Workspaces**: Each agent runs in its own "room" with dedicated state
- **Multi-client Support**: Multiple clients can join and observe the same room
- **Message History**: Automatic conversation history with up to 1000 messages per room
- **Request Management**: Configurable timeouts, cancellation, and status recovery

### Git Worktree Isolation
- **Safe Experimentation**: Agents work in isolated git worktrees, protecting your main branch
- **Automatic Branch Management**: Create feature branches when starting sessions
- **Change Preservation**: Auto-stash uncommitted changes before switching contexts
- **Clean Teardown**: Worktrees are automatically cleaned up when rooms close

### WebSocket API
- **Open Protocol**: Build custom UIs, integrations, and automation
- **Real-time Events**: Stream responses, status changes, and activity updates
- **Full Control**: Create rooms, send messages, manage sessions programmatically

### Terminal UI
- **irssi-Style Interface**: Familiar layout for power users
- **Keyboard-Driven**: Alt+1-9 room switching, Escape to cancel, extensive shortcuts
- **Syntax Highlighting**: Markdown rendering with language-aware code blocks
- **Directory Browser**: Built-in file picker for project selection

## Installation

```bash
npm install
npm link  # Optional: install globally as 'bob'
```

## Quick Start

```bash
# Start with embedded server (default)
bob

# Or run directly
node src/index.js
```

Type `/help` once running to see available commands.

## Usage

### Creating Agent Rooms

```bash
/create claude                           # Claude in current directory
/create claude /path/to/project          # Claude in specified directory
/create claude /path/to/project feature  # Claude with git branch
/create codex ~/myproject new-feature    # Codex with git branch
/new gemini                              # Gemini with directory picker
```

### Room Management

| Command | Description |
|---------|-------------|
| `/list` | List all active rooms |
| `/join <id>` | Join a room by ID or name |
| `/switch <n>` | Switch to room by number |
| `/leave` | Leave current room |
| `/close` | Close room and stop agent |
| `/status` | Show current room status |
| `/worktree` | Show worktree isolation info |

### Agent Control

| Command | Description |
|---------|-------------|
| `/cancel` | Cancel current request (or press Escape) |
| `/reset` | Force reset stuck room status (or Ctrl+R) |
| `/timeout <s>` | Set request timeout in seconds |
| `/agents` | List available agent types |

### Git Commands

| Command | Description |
|---------|-------------|
| `/git status` | Show repository status |
| `/git branch` | Show current branch |
| `/git log` | Show recent commits |
| `/git diff` | Show uncommitted changes |

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| Alt+1-9 | Switch to room 1-9 |
| Ctrl+N/P | Next/previous room |
| Tab | Toggle focus between input and room list |
| Escape | Cancel current agent request |
| Ctrl+R | Force reset room status |
| PageUp/Down | Scroll chat history |
| Up/Down | Navigate input history |
| Ctrl+C | Quit |

## Server Modes

```bash
# Embedded server (default)
bob

# Server only (headless/remote)
bob server
bob --server-only

# Connect to remote server
bob connect hostname:8420
bob -c 192.168.1.100:8420
```

## Architecture

```
┌─────────────┐         ┌──────────────────────────────────────┐
│ Terminal UI │────────>│ Server                               │
└─────────────┘         │  └─ Room Manager                     │
       │                │      ├─ Room 1 ──> Claude CLI        │
       │ WebSocket      │      ├─ Room 2 ──> Codex CLI         │
       │                │      └─ Room 3 ──> Gemini CLI        │
┌──────┴──────┐         └──────────────────────────────────────┘
│ Custom      │                        │
│ Clients     │────────────────────────┘
└─────────────┘
```

## WebSocket API

Connect to `ws://localhost:8420` for programmatic control.

### Client → Server Messages

```javascript
// Room operations
{ type: 'create_room', agentType: 'claude', directory: '/path', branch: 'feature' }
{ type: 'join_room', roomId: 'uuid' }
{ type: 'join_room', roomName: 'room-name' }
{ type: 'leave_room', roomId: 'uuid' }
{ type: 'close_room', roomId: 'uuid' }
{ type: 'list_rooms' }

// Messaging
{ type: 'send_message', roomId: 'uuid', content: 'Hello agent' }
{ type: 'cancel', roomId: 'uuid' }
{ type: 'reset', roomId: 'uuid' }

// Client
{ type: 'set_name', name: 'my-client' }
{ type: 'ping' }
```

### Server → Client Messages

```javascript
// Connection
{ type: 'welcome', clientId: 'uuid', rooms: [...], serverVersion: '1.0.0' }

// Room events
{ type: 'room_joined', roomId: 'uuid', roomName: 'name', history: [...] }
{ type: 'room_left', roomId: 'uuid' }
{ type: 'room_list', rooms: [...] }

// Messages
{ type: 'message', roomId: 'uuid', message: { role: 'agent', content: '...' } }
{ type: 'stream', roomId: 'uuid', chunk: '...' }
{ type: 'status', roomId: 'uuid', status: 'busy' }
{ type: 'activity', roomId: 'uuid', activity: 'Using File Search' }

// Errors
{ type: 'error', error: 'message' }
```

See `examples/simple-client.js` for a complete client implementation.

## Adding Custom Agents

Create a new adapter in `src/agents/`:

```javascript
import { BaseAgent } from './base.js';

export class MyAgent extends BaseAgent {
  async start() {
    this.status = 'ready';
    this.emit('status', 'ready');
    return this;
  }

  async send(content) {
    this.status = 'busy';
    this.emit('status', 'busy');

    // Your agent logic here
    const response = await this.callMyAgent(content);

    this.status = 'ready';
    this.emit('message', response);
    return response;
  }
}
```

Register in `src/agents/index.js`:

```javascript
import { MyAgent } from './myagent.js';
agents['myagent'] = MyAgent;
```

## Configuration

Create `config.json` from the example:

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
  },
  "git": {
    "autoStash": true,
    "defaultBranch": "main"
  },
  "ui": {
    "historySize": 100
  }
}
```

## Security

- Error messages are sanitized to remove file paths and stack traces
- Worktree operations include path traversal protection
- System directories are blocked from worktree creation
- Optional token-based authentication for remote connections

## License

MIT
