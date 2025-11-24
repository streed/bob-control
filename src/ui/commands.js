/**
 * Command parser and handler for irssi-style commands
 */

export class CommandParser {
  constructor() {
    this.commands = new Map();
    this.aliases = new Map();
    this.registerBuiltins();
  }

  /**
   * Register built-in commands
   */
  registerBuiltins() {
    this.register('help', {
      description: 'Show help for commands',
      usage: '/help [command]',
      handler: (args, ctx) => this.helpCommand(args, ctx)
    });

    this.register('create', {
      description: 'Create a new agent room',
      usage: '/create <agent> [directory] [branch]',
      examples: [
        '/create claude',
        '/create claude /path/to/project',
        '/create claude /path/to/project feature-branch'
      ],
      handler: (args, ctx) => ctx.createRoom(args)
    });

    this.register('new', {
      description: 'Create a new agent room with directory picker',
      usage: '/new <agent>',
      examples: [
        '/new claude',
        '/new codex'
      ],
      handler: (args, ctx) => ctx.createRoomWithBrowser(args)
    });

    this.register('browse', {
      description: 'Browse and select a directory',
      usage: '/browse',
      handler: (args, ctx) => ctx.browseDirectory()
    });

    this.register('join', {
      description: 'Join an existing room',
      usage: '/join <room-name-or-id>',
      handler: (args, ctx) => ctx.joinRoom(args[0])
    });

    this.register('leave', {
      description: 'Leave the current room',
      usage: '/leave',
      handler: (args, ctx) => ctx.leaveRoom()
    });

    this.register('list', {
      description: 'List all rooms',
      usage: '/list',
      handler: (args, ctx) => ctx.listRooms()
    });

    this.register('rooms', {
      description: 'Alias for /list',
      usage: '/rooms',
      handler: (args, ctx) => ctx.listRooms()
    });

    this.register('close', {
      description: 'Close a room and stop its agent',
      usage: '/close [room-name-or-id]',
      handler: (args, ctx) => ctx.closeRoom(args[0])
    });

    this.register('switch', {
      description: 'Switch to a different room',
      usage: '/switch <room-name-or-number>',
      handler: (args, ctx) => ctx.switchRoom(args[0])
    });

    this.register('status', {
      description: 'Show current room status',
      usage: '/status',
      handler: (args, ctx) => ctx.showStatus()
    });

    this.register('clear', {
      description: 'Clear the chat window',
      usage: '/clear',
      handler: (args, ctx) => ctx.clearChat()
    });

    this.register('connect', {
      description: 'Connect to a bob-control server',
      usage: '/connect <host:port>',
      handler: (args, ctx) => ctx.connect(args[0])
    });

    this.register('disconnect', {
      description: 'Disconnect from the server',
      usage: '/disconnect',
      handler: (args, ctx) => ctx.disconnect()
    });

    this.register('quit', {
      description: 'Quit bob-control',
      usage: '/quit',
      handler: (args, ctx) => ctx.quit()
    });

    this.register('agents', {
      description: 'List available agent types',
      usage: '/agents',
      handler: (args, ctx) => ctx.listAgents()
    });

    this.register('git', {
      description: 'Show git status for current room',
      usage: '/git [status|branch|log]',
      handler: (args, ctx) => ctx.gitCommand(args)
    });

    this.register('name', {
      description: 'Set your display name',
      usage: '/name <name>',
      handler: (args, ctx) => ctx.setName(args.join(' '))
    });

    this.register('cancel', {
      description: 'Cancel the current agent request',
      usage: '/cancel',
      handler: (args, ctx) => ctx.cancelRequest()
    });

    this.register('reset', {
      description: 'Force reset room status (emergency recovery)',
      usage: '/reset',
      handler: (args, ctx) => ctx.resetRoom()
    });

    this.register('timeout', {
      description: 'Set request timeout in seconds',
      usage: '/timeout <seconds>',
      handler: (args, ctx) => ctx.setTimeout(args[0])
    });

    this.register('worktree', {
      description: 'Show worktree info for current room',
      usage: '/worktree',
      handler: (args, ctx) => ctx.showWorktree()
    });

    // Number shortcuts for switching rooms (like irssi)
    for (let i = 1; i <= 9; i++) {
      this.aliases.set(String(i), `switch ${i}`);
    }

    // Common aliases
    this.aliases.set('c', 'create');
    this.aliases.set('n', 'new');
    this.aliases.set('j', 'join');
    this.aliases.set('l', 'list');
    this.aliases.set('q', 'quit');
    this.aliases.set('s', 'switch');
    this.aliases.set('w', 'switch');  // irssi style
    this.aliases.set('x', 'cancel');  // Quick cancel
    this.aliases.set('stop', 'cancel');
    this.aliases.set('b', 'browse');
  }

  /**
   * Register a command
   */
  register(name, config) {
    this.commands.set(name.toLowerCase(), config);
  }

  /**
   * Parse and execute a command
   */
  parse(input, ctx) {
    if (!input.startsWith('/')) {
      return { isCommand: false, content: input };
    }

    const parts = input.slice(1).split(/\s+/);
    let commandName = parts[0].toLowerCase();
    let args = parts.slice(1);

    // Check aliases
    if (this.aliases.has(commandName)) {
      const aliased = this.aliases.get(commandName).split(/\s+/);
      commandName = aliased[0];
      args = [...aliased.slice(1), ...args];
    }

    const command = this.commands.get(commandName);

    if (!command) {
      return {
        isCommand: true,
        error: `Unknown command: /${commandName}. Type /help for available commands.`
      };
    }

    try {
      const result = command.handler(args, ctx);
      return { isCommand: true, result };
    } catch (error) {
      return { isCommand: true, error: error.message };
    }
  }

  /**
   * Help command handler
   */
  helpCommand(args, ctx) {
    if (args.length > 0) {
      const cmdName = args[0].replace(/^\//, '').toLowerCase();
      const cmd = this.commands.get(cmdName);

      if (cmd) {
        ctx.log(`{bold}/${cmdName}{/bold} - ${cmd.description}`);
        ctx.log(`  Usage: ${cmd.usage}`);
        if (cmd.examples) {
          ctx.log('  Examples:');
          for (const ex of cmd.examples) {
            ctx.log(`    ${ex}`);
          }
        }
      } else {
        ctx.log(`Unknown command: ${cmdName}`);
      }
      return;
    }

    ctx.log('{bold}Available commands:{/bold}');
    ctx.log('');

    const categories = {
      'Room Management': ['create', 'new', 'join', 'leave', 'list', 'close', 'switch'],
      'Agent Control': ['cancel', 'reset', 'timeout'],
      'Information': ['help', 'status', 'agents', 'git', 'worktree'],
      'Connection': ['connect', 'disconnect'],
      'Other': ['clear', 'name', 'browse', 'quit']
    };

    for (const [category, cmds] of Object.entries(categories)) {
      ctx.log(`{bold}{cyan-fg}${category}:{/cyan-fg}{/bold}`);
      for (const cmdName of cmds) {
        const cmd = this.commands.get(cmdName);
        if (cmd) {
          ctx.log(`  /{green-fg}${cmdName.padEnd(12)}{/green-fg} ${cmd.description}`);
        }
      }
      ctx.log('');
    }

    ctx.log('{bold}Shortcuts:{/bold}');
    ctx.log('  Alt+1-9    Switch to room 1-9');
    ctx.log('  Ctrl+N/P   Next/Previous room');
    ctx.log('  Escape     Cancel current request');
    ctx.log('  Ctrl+R     Force reset room status');
    ctx.log('  PageUp/Dn  Scroll chat');
    ctx.log('  Tab        Switch focus');
    ctx.log('  Ctrl+C     Quit');
  }

  /**
   * Get command completions for tab completion
   */
  getCompletions(partial) {
    const completions = [];
    const search = partial.toLowerCase().replace(/^\//, '');

    for (const cmd of this.commands.keys()) {
      if (cmd.startsWith(search)) {
        completions.push('/' + cmd);
      }
    }

    return completions;
  }
}
