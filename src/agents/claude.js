import { BaseAgent } from './base.js';
import { spawn } from 'child_process';
import { v4 as uuidv4 } from 'uuid';

/**
 * Claude Code adapter
 * Runs Claude in interactive streaming mode for full interactivity
 */
export class ClaudeAgent extends BaseAgent {
  constructor(options = {}) {
    super(options);
    this.model = options.model || null;
    this.autoAccept = options.autoAccept !== false;
    this.process = null;
    this.isInteractive = options.interactive !== false; // Default to interactive
    this.sessionId = options.sessionId || uuidv4();
    this.buffer = '';
    this.currentResolve = null;
    this.currentReject = null;
    this.streaming = false;
  }

  async start() {
    // Verify claude CLI is available before starting
    BaseAgent.verifyCommand('claude',
      'Install Claude Code CLI from https://claude.ai/download');

    if (this.isInteractive) {
      await this.startInteractive();
    }
    this.status = 'ready';
    this.emit('status', 'ready');
    return this;
  }

  /**
   * Start Claude in interactive streaming mode
   */
  async startInteractive() {
    const args = [
      '--print',  // Required for streaming modes
      '--output-format', 'stream-json',
      '--input-format', 'stream-json',
      '--verbose',  // Required for stream-json output
      '--session-id', this.sessionId
    ];

    if (this.autoAccept) {
      args.push('--dangerously-skip-permissions');
    }

    if (this.model) {
      args.push('--model', this.model);
    }

    return new Promise((resolve, reject) => {
      this.process = spawn('claude', args, {
        cwd: this.directory,
        env: { ...process.env },
        stdio: ['pipe', 'pipe', 'pipe']
      });

      this.process.stdout.on('data', (data) => {
        this.handleStreamData(data.toString());
      });

      this.process.stderr.on('data', (data) => {
        const text = data.toString();
        // Filter out non-error stderr (progress info, etc.)
        if (text.toLowerCase().includes('error')) {
          this.emit('stderr', text);
        }
      });

      this.process.on('close', (code) => {
        this.status = 'stopped';
        this.emit('status', 'stopped');
        this.emit('exit', code);

        if (this.currentReject) {
          this.currentReject(new Error(`Process exited with code ${code}`));
          this.currentResolve = null;
          this.currentReject = null;
        }
      });

      this.process.on('error', (error) => {
        this.status = 'error';
        this.emit('error', error);
        reject(error);
      });

      // Give it a moment to start
      setTimeout(() => {
        if (this.process && !this.process.killed) {
          resolve();
        }
      }, 500);
    });
  }

  /**
   * Handle streaming JSON data from Claude
   */
  handleStreamData(data) {
    this.buffer += data;

    // Process complete JSON lines
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || ''; // Keep incomplete line in buffer

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const event = JSON.parse(line);
        this.handleEvent(event);
      } catch (e) {
        // Not valid JSON, might be partial - emit as raw
        this.emit('stream', line + '\n');
      }
    }
  }

  /**
   * Handle parsed events from Claude
   */
  handleEvent(event) {
    switch (event.type) {
      case 'system':
        this.emit('system', event);
        break;

      case 'assistant':
        // Assistant message with content blocks
        if (event.message?.content) {
          for (const block of event.message.content) {
            if (block.type === 'text') {
              this.emit('stream', block.text);
            } else if (block.type === 'tool_use') {
              // Emit tool_use event for tracking, but don't clutter the stream
              this.emit('tool_use', {
                id: block.id,
                name: block.name,
                input: block.input
              });
            }
          }
        }
        break;

      case 'content_block_start':
        // Emit activity event for tool use so UI can show what's happening
        if (event.content_block?.type === 'tool_use') {
          const toolName = event.content_block.name;
          this.emit('activity', {
            type: 'tool_start',
            tool: toolName,
            description: this.getToolDescription(toolName)
          });
        }
        break;

      case 'content_block_delta':
        if (event.delta?.text) {
          this.emit('stream', event.delta.text);
        }
        // Don't stream partial_json (tool inputs) - too noisy
        break;

      case 'content_block_stop':
        // Block finished
        break;

      case 'result':
        // Final result - resolve the promise
        this.streaming = false;
        this.status = 'ready';
        this.emit('status', 'ready');

        const resultText = event.result || '';
        this.emit('message', resultText);

        if (this.currentResolve) {
          this.currentResolve(resultText);
          this.currentResolve = null;
          this.currentReject = null;
        }
        break;

      case 'error':
        this.emit('error', new Error(event.error?.message || 'Unknown error'));
        if (this.currentReject) {
          this.currentReject(new Error(event.error?.message || 'Unknown error'));
          this.currentResolve = null;
          this.currentReject = null;
        }
        break;

      default:
        // Unknown event type - emit for debugging
        this.emit('event', event);
    }
  }

  /**
   * Send a message to Claude
   */
  async send(content) {
    if (this.isInteractive && this.process && !this.process.killed) {
      return this.sendInteractive(content);
    } else {
      return this.sendOneShot(content);
    }
  }

  /**
   * Send message in interactive mode
   */
  sendInteractive(content) {
    return new Promise((resolve, reject) => {
      if (!this.process || this.process.killed) {
        reject(new Error('Process not running'));
        return;
      }

      this.currentResolve = resolve;
      this.currentReject = reject;
      this.streaming = true;
      this.status = 'busy';
      this.emit('status', 'busy');

      // Send message as JSON in the correct format for Claude streaming input
      const message = {
        type: 'user',
        message: {
          role: 'user',
          content: content
        }
      };

      this.process.stdin.write(JSON.stringify(message) + '\n');
    });
  }

  /**
   * Send message in one-shot mode (fallback)
   */
  sendOneShot(content) {
    return new Promise((resolve, reject) => {
      let fullResponse = '';
      let stderrOutput = '';

      const args = ['-p'];

      if (this.autoAccept) {
        args.push('--dangerously-skip-permissions');
      }

      if (this.model) {
        args.push('--model', this.model);
      }

      args.push('--', content);

      const proc = spawn('claude', args, {
        cwd: this.directory,
        env: { ...process.env },
        stdio: ['ignore', 'pipe', 'pipe']
      });

      this.process = proc;
      this.status = 'busy';
      this.emit('status', 'busy');

      proc.stdout.on('data', (data) => {
        const text = data.toString();
        fullResponse += text;
        this.emit('stream', text);
      });

      proc.stderr.on('data', (data) => {
        const text = data.toString();
        stderrOutput += text;
        if (text.toLowerCase().includes('error')) {
          this.emit('stderr', text);
        }
      });

      proc.on('close', (code) => {
        this.process = null;
        this.status = 'ready';
        this.emit('status', 'ready');

        if (code === 0 || fullResponse.trim()) {
          this.emit('message', fullResponse.trim());
          resolve(fullResponse.trim());
        } else {
          const errorMsg = stderrOutput || `Claude exited with code ${code}`;
          reject(new Error(errorMsg));
        }
      });

      proc.on('error', (error) => {
        this.process = null;
        this.status = 'error';
        this.emit('status', 'error');

        if (error.code === 'ENOENT') {
          reject(new Error('Claude CLI not found. Make sure "claude" is installed and in your PATH.'));
        } else {
          reject(error);
        }
      });
    });
  }

  /**
   * Continue conversation from previous session
   */
  async continueSession() {
    if (!this.isInteractive) {
      throw new Error('Cannot continue session in non-interactive mode');
    }

    // Stop current process if running
    await this.stop();

    const args = [
      '--print',
      '--output-format', 'stream-json',
      '--input-format', 'stream-json',
      '--verbose',
      '--continue'  // Resume from last session
    ];

    if (this.autoAccept) {
      args.push('--dangerously-skip-permissions');
    }

    if (this.model) {
      args.push('--model', this.model);
    }

    return new Promise((resolve, reject) => {
      this.process = spawn('claude', args, {
        cwd: this.directory,
        env: { ...process.env },
        stdio: ['pipe', 'pipe', 'pipe']
      });

      this.process.stdout.on('data', (data) => {
        this.handleStreamData(data.toString());
      });

      this.process.stderr.on('data', (data) => {
        const text = data.toString();
        if (text.toLowerCase().includes('error')) {
          this.emit('stderr', text);
        }
      });

      this.process.on('close', (code) => {
        this.status = 'stopped';
        this.emit('status', 'stopped');
        this.emit('exit', code);

        if (this.currentReject) {
          this.currentReject(new Error(`Process exited with code ${code}`));
          this.currentResolve = null;
          this.currentReject = null;
        }
      });

      this.process.on('error', (error) => {
        this.status = 'error';
        this.emit('error', error);
        reject(error);
      });

      // Give it a moment to start
      setTimeout(() => {
        if (this.process && !this.process.killed) {
          this.status = 'ready';
          this.emit('status', 'ready');
          resolve();
        }
      }, 500);
    });
  }

  async stop() {
    if (this.process) {
      // Send exit signal via stdin if possible
      try {
        this.process.stdin.end();
      } catch (e) {
        // Ignore
      }

      this.process.kill('SIGTERM');

      // Force kill after timeout
      setTimeout(() => {
        if (this.process && !this.process.killed) {
          this.process.kill('SIGKILL');
        }
      }, 2000);

      this.process = null;
    }
    this.status = 'stopped';
    this.emit('status', 'stopped');
  }

  /**
   * Get a user-friendly description of what a tool does
   */
  getToolDescription(toolName) {
    const descriptions = {
      'Read': 'Reading file',
      'Write': 'Writing file',
      'Edit': 'Editing file',
      'Bash': 'Running command',
      'Grep': 'Searching code',
      'Glob': 'Finding files',
      'Task': 'Running sub-agent',
      'WebFetch': 'Fetching URL',
      'WebSearch': 'Searching web',
      'TodoWrite': 'Updating tasks',
      'NotebookEdit': 'Editing notebook'
    };
    return descriptions[toolName] || `Using ${toolName}`;
  }

  getInfo() {
    return {
      ...super.getInfo(),
      type: 'claude',
      model: this.model || 'default',
      interactive: this.isInteractive,
      sessionId: this.sessionId
    };
  }
}
