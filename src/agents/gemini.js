import { BaseAgent } from './base.js';
import { spawn } from 'child_process';
import { v4 as uuidv4 } from 'uuid';

/**
 * Google Gemini CLI adapter
 * Runs Gemini in interactive streaming mode for full interactivity
 *
 * Supports the official Google Gemini CLI (google-gemini/gemini-cli)
 * Install: npm install -g @google/gemini-cli
 */
export class GeminiAgent extends BaseAgent {
  constructor(options = {}) {
    super(options);
    this.model = options.model || null; // Use CLI default if not specified
    this.autoAccept = options.autoAccept !== false; // Default to true (yolo mode)
    this.process = null;
    this.isInteractive = options.interactive !== false; // Default to interactive
    this.sessionId = options.sessionId || uuidv4();
    this.buffer = '';
    this.currentResolve = null;
    this.currentReject = null;
    this.streaming = false;
    this.sandbox = options.sandbox !== false; // Default sandbox on with yolo
    this.checkpointing = options.checkpointing !== false; // Enable checkpointing
  }

  async start() {
    // Verify gemini CLI is available before starting
    BaseAgent.verifyCommand('gemini',
      'Install Gemini CLI: npm install -g @google/gemini-cli\n' +
      'Or visit: https://github.com/google-gemini/gemini-cli');

    if (this.isInteractive) {
      await this.startInteractive();
    }
    this.status = 'ready';
    this.emit('status', 'ready');
    return this;
  }

  /**
   * Start Gemini in interactive streaming mode
   */
  async startInteractive() {
    const args = this.buildInteractiveArgs();

    return new Promise((resolve, reject) => {
      this.process = spawn('gemini', args, {
        cwd: this.directory,
        env: { ...process.env },
        stdio: ['pipe', 'pipe', 'pipe']
      });

      this.process.stdout.on('data', (data) => {
        this.handleStreamData(data.toString());
      });

      this.process.stderr.on('data', (data) => {
        const text = data.toString();
        // Filter out non-error stderr (progress info, spinners, etc.)
        if (text.toLowerCase().includes('error') || text.toLowerCase().includes('failed')) {
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
   * Build args for interactive mode
   */
  buildInteractiveArgs() {
    const args = [];

    // Output format for structured streaming
    args.push('--output-format', 'json');

    // Auto-approve tool calls if autoAccept is enabled
    if (this.autoAccept) {
      args.push('--yolo');
    }

    // Enable sandbox when in yolo mode (recommended for safety)
    if (this.sandbox && this.autoAccept) {
      args.push('--sandbox');
    }

    // Enable checkpointing for session recovery
    if (this.checkpointing) {
      args.push('--checkpointing');
    }

    // Model selection
    if (this.model) {
      args.push('--model', this.model);
    }

    return args;
  }

  /**
   * Handle streaming data from Gemini
   */
  handleStreamData(data) {
    this.buffer += data;

    // Process complete JSON lines (newline-delimited JSON)
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || ''; // Keep incomplete line in buffer

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const event = JSON.parse(line);
        this.handleEvent(event);
      } catch (e) {
        // Not valid JSON, emit as raw text
        // This handles plain text output from Gemini
        this.emit('stream', line + '\n');
      }
    }
  }

  /**
   * Handle parsed events from Gemini
   */
  handleEvent(event) {
    // Gemini CLI may emit different event types
    // Handle common patterns based on observed behavior

    switch (event.type) {
      case 'system':
        this.emit('system', event);
        break;

      case 'message':
      case 'assistant':
        // Handle message content
        if (event.content || event.text) {
          const text = event.content || event.text;
          if (typeof text === 'string') {
            this.emit('stream', text);
          } else if (Array.isArray(text)) {
            // Content blocks
            for (const block of text) {
              if (block.type === 'text') {
                this.emit('stream', block.text);
              } else if (block.type === 'tool_use') {
                this.emit('tool_use', {
                  id: block.id,
                  name: block.name,
                  input: block.input
                });
              }
            }
          }
        }
        break;

      case 'tool_start':
      case 'tool_use':
        // Emit activity event for UI to show what's happening
        this.emit('activity', {
          type: 'tool_start',
          tool: event.tool || event.name,
          description: this.getToolDescription(event.tool || event.name)
        });
        break;

      case 'tool_end':
      case 'tool_result':
        this.emit('activity', {
          type: 'tool_end',
          tool: event.tool || event.name
        });
        break;

      case 'delta':
      case 'content_delta':
        // Streaming text delta
        if (event.text || event.delta?.text) {
          this.emit('stream', event.text || event.delta.text);
        }
        break;

      case 'done':
      case 'result':
      case 'complete':
        // Final result - resolve the promise
        this.streaming = false;
        this.status = 'ready';
        this.emit('status', 'ready');

        const resultText = event.result || event.text || event.content || '';
        this.emit('message', resultText);

        if (this.currentResolve) {
          this.currentResolve(resultText);
          this.currentResolve = null;
          this.currentReject = null;
        }
        break;

      case 'error':
        this.emit('error', new Error(event.error?.message || event.message || 'Unknown error'));
        if (this.currentReject) {
          this.currentReject(new Error(event.error?.message || event.message || 'Unknown error'));
          this.currentResolve = null;
          this.currentReject = null;
        }
        break;

      default:
        // Unknown event type - check for text content and stream it
        if (event.text) {
          this.emit('stream', event.text);
        } else if (event.content && typeof event.content === 'string') {
          this.emit('stream', event.content);
        }
        // Emit raw event for debugging
        this.emit('event', event);
    }
  }

  /**
   * Send a message to Gemini
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

      // Write the prompt to stdin
      // Gemini CLI accepts plain text input in interactive mode
      this.process.stdin.write(content + '\n');

      // Set a timeout for response
      const timeout = setTimeout(() => {
        if (this.streaming && this.currentReject) {
          // Don't reject, just log - Gemini might still be processing
          this.emit('stderr', 'Response taking longer than expected...');
        }
      }, 60000); // 1 minute warning

      // Clear timeout when resolved
      const originalResolve = this.currentResolve;
      this.currentResolve = (result) => {
        clearTimeout(timeout);
        originalResolve(result);
      };
    });
  }

  /**
   * Send message in one-shot mode (non-interactive)
   */
  sendOneShot(content) {
    return new Promise((resolve, reject) => {
      let fullResponse = '';
      let stderrOutput = '';

      const args = [];

      // Non-interactive prompt
      args.push('-p', content);

      // Output format
      args.push('--output-format', 'json');

      // Auto-approve in yolo mode
      if (this.autoAccept) {
        args.push('--yolo');
        if (this.sandbox) {
          args.push('--sandbox');
        }
      }

      // Model selection
      if (this.model) {
        args.push('--model', this.model);
      }

      const proc = spawn('gemini', args, {
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

        // Try to parse as JSON for structured events
        const lines = text.split('\n');
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line);
            this.handleEvent(event);
          } catch (e) {
            // Plain text, emit as stream
            this.emit('stream', line + '\n');
          }
        }
      });

      proc.stderr.on('data', (data) => {
        const text = data.toString();
        stderrOutput += text;
        if (text.toLowerCase().includes('error') || text.toLowerCase().includes('failed')) {
          this.emit('stderr', text);
        }
      });

      proc.on('close', (code) => {
        this.process = null;
        this.status = 'ready';
        this.emit('status', 'ready');

        if (code === 0 || fullResponse.trim()) {
          // Try to extract the final result from JSON
          let result = fullResponse.trim();
          try {
            // Look for final result in last JSON line
            const lines = fullResponse.trim().split('\n').reverse();
            for (const line of lines) {
              if (!line.trim()) continue;
              const parsed = JSON.parse(line);
              if (parsed.result || parsed.text || parsed.content) {
                result = parsed.result || parsed.text || parsed.content;
                break;
              }
            }
          } catch (e) {
            // Use raw response
          }
          this.emit('message', result);
          resolve(result);
        } else {
          const errorMsg = stderrOutput || `Gemini exited with code ${code}`;
          reject(new Error(errorMsg));
        }
      });

      proc.on('error', (error) => {
        this.process = null;
        this.status = 'error';
        this.emit('status', 'error');

        if (error.code === 'ENOENT') {
          reject(new Error('Gemini CLI not found. Install with: npm install -g @google/gemini-cli'));
        } else {
          reject(error);
        }
      });
    });
  }

  /**
   * Resume from checkpoint/session
   */
  async resumeSession() {
    if (!this.isInteractive) {
      throw new Error('Cannot resume session in non-interactive mode');
    }

    // Stop current process if running
    await this.stop();

    const args = this.buildInteractiveArgs();
    // Gemini CLI will auto-resume if checkpointing is enabled

    return new Promise((resolve, reject) => {
      this.process = spawn('gemini', args, {
        cwd: this.directory,
        env: { ...process.env },
        stdio: ['pipe', 'pipe', 'pipe']
      });

      this.process.stdout.on('data', (data) => {
        this.handleStreamData(data.toString());
      });

      this.process.stderr.on('data', (data) => {
        const text = data.toString();
        if (text.toLowerCase().includes('error') || text.toLowerCase().includes('failed')) {
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
      // Try to close stdin gracefully first
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
      // Gemini built-in tools
      'read_file': 'Reading file',
      'write_file': 'Writing file',
      'replace': 'Editing file',
      'shell': 'Running command',
      'search_files': 'Searching files',
      'list_directory': 'Listing directory',
      'google_search': 'Searching Google',
      'web_fetch': 'Fetching URL',
      // Common tool name patterns
      'read': 'Reading file',
      'write': 'Writing file',
      'edit': 'Editing file',
      'bash': 'Running command',
      'grep': 'Searching code',
      'glob': 'Finding files',
      'search': 'Searching'
    };
    const lowerName = (toolName || '').toLowerCase();
    return descriptions[lowerName] || `Using ${toolName}`;
  }

  getInfo() {
    return {
      ...super.getInfo(),
      type: 'gemini',
      model: this.model || 'default',
      interactive: this.isInteractive,
      sessionId: this.sessionId,
      autoAccept: this.autoAccept,
      sandbox: this.sandbox,
      checkpointing: this.checkpointing
    };
  }
}
