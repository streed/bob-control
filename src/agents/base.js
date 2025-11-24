import { EventEmitter } from 'events';
import { spawn, execSync } from 'child_process';

/**
 * Base agent adapter class
 * All agent adapters should extend this class
 */
export class BaseAgent extends EventEmitter {
  constructor(options = {}) {
    super();
    this.directory = options.directory || process.cwd();
    this.process = null;
    this.status = 'idle';
    this.buffer = '';
  }

  /**
   * Check if a CLI command is available in PATH
   * @param {string} command - The command to check
   * @returns {boolean} - True if command exists
   */
  static isCommandAvailable(command) {
    try {
      // Use 'which' on Unix-like systems, 'where' on Windows
      const checkCmd = process.platform === 'win32' ? 'where' : 'which';
      execSync(`${checkCmd} ${command}`, { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Verify a CLI command is available, throw helpful error if not
   * @param {string} command - The command to verify
   * @param {string} installHint - Installation instructions
   * @throws {Error} If command is not available
   */
  static verifyCommand(command, installHint = '') {
    if (!BaseAgent.isCommandAvailable(command)) {
      const hint = installHint ? ` ${installHint}` : '';
      throw new Error(
        `Command '${command}' not found in PATH.${hint}\n` +
        `Make sure '${command}' is installed and accessible from your terminal.`
      );
    }
  }

  /**
   * Send a message to the agent
   * @param {string} content - The message content
   * @returns {Promise<string>} - The agent's response
   */
  async send(content) {
    throw new Error('send() must be implemented by subclass');
  }

  /**
   * Start the agent process
   */
  async start() {
    throw new Error('start() must be implemented by subclass');
  }

  /**
   * Stop the agent process
   */
  async stop() {
    if (this.process) {
      this.process.kill('SIGTERM');
      this.process = null;
    }
    this.status = 'stopped';
    this.emit('status', 'stopped');
  }

  /**
   * Spawn a subprocess and handle its I/O
   */
  spawnProcess(command, args, options = {}) {
    return new Promise((resolve, reject) => {
      this.process = spawn(command, args, {
        cwd: this.directory,
        stdio: ['pipe', 'pipe', 'pipe'],
        ...options
      });

      this.process.on('spawn', () => {
        this.status = 'ready';
        this.emit('status', 'ready');
        resolve(this.process);
      });

      this.process.on('error', (error) => {
        this.status = 'error';
        this.emit('error', error);
        reject(error);
      });

      this.process.on('exit', (code) => {
        this.status = 'stopped';
        this.emit('status', 'stopped');
        this.emit('exit', code);
      });

      this.process.stdout.on('data', (data) => {
        const text = data.toString();
        this.buffer += text;
        this.emit('stream', text);
      });

      this.process.stderr.on('data', (data) => {
        const text = data.toString();
        this.emit('stderr', text);
      });
    });
  }

  /**
   * Write to the process stdin
   */
  write(content) {
    if (this.process && this.process.stdin) {
      this.process.stdin.write(content);
    }
  }

  /**
   * Get agent info
   */
  getInfo() {
    return {
      type: this.constructor.name,
      directory: this.directory,
      status: this.status
    };
  }
}
